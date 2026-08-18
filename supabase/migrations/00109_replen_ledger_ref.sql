-- =============================================================================
-- Replenishment ledger legs name the task that moved the stock
-- Migration: 00109_replen_ledger_ref.sql
-- =============================================================================
-- WHY THIS EXISTS. `complete-replenishment` moves stock through
-- inv_transfer_stock, which has always written its two legs as
-- ref_type = 'transfer', ref_id = NULL (00080 §2). So inventory_movements can
-- say a quantity left a reserve bay and arrived in a pick slot, but not WHICH
-- replenishment task did it -- the only way to answer that was to correlate on
-- product, from, to, quantity and time and hope no two tasks overlapped.
-- Registered as O13.
--
-- THE FIX IS A PASSTHROUGH, NOT A NEW BEHAVIOUR. inv_transfer_stock gains
-- p_ref_type / p_ref_id with defaults that reproduce today's values exactly, so
-- every other caller -- wie_complete_putaway_tx, wie_decide_putaway_tx, 00060's
-- reslot, 00101's quarantine moves -- keeps writing ('transfer', NULL) with no
-- edit and no re-verification. One changed behaviour per migration.
--
-- !! DROP FIRST. This changes the ARITY (7 -> 9), and CREATE OR REPLACE at a
-- !! different arity creates an OVERLOAD rather than replacing: the mig 00037 /
-- !! 00074 trap, which has already bitten inv_transfer_stock once and is called
-- !! out in 00080's own header. Two resident signatures make every 7-arg call
-- !! either ambiguous or silently bound to the stale body. The pg_proc
-- !! assertion at the bottom of this file is how you check it took.
--
-- WHICH ID IS STAMPED. wie_complete_replen_tx's v_completed, not p_task_id.
-- They are the same row on a full completion; on a PARTIAL, 00082 leaves the
-- original task holding the remainder and inserts a new row carrying the
-- quantity that actually moved. v_completed is always that second row, so the
-- ledger leg points at the record whose quantity equals the quantity in the
-- leg. Stamping p_task_id would name a row claiming a quantity that did not
-- move -- which is the same class of wrong answer this migration exists to fix.
--
-- ref_id is TEXT (00027), so the id is cast rather than needing a new column,
-- and idx_inventory_movements_ref already indexes (ref_type, ref_id) -- the new
-- rows are queryable the moment they are written.
--
-- Contents:
--   1. inv_transfer_stock  -- gains p_ref_type / p_ref_id (DROP first)
--   2. wie_complete_replen_tx -- stamps ('replen_task', v_completed)
-- =============================================================================

BEGIN;

-- ── 1. inv_transfer_stock -- the legs carry whatever the caller names ────────
-- Body is 00080 §2 verbatim apart from the two inv_apply_leg calls, which now
-- forward p_ref_type / p_ref_id in place of the literal 'transfer', NULL.
DROP FUNCTION IF EXISTS public.inv_transfer_stock(INT,INT,INT,NUMERIC,UUID,TEXT,BIGINT);

CREATE OR REPLACE FUNCTION public.inv_transfer_stock(
    p_product_id       INT,
    p_from_loc         INT,
    p_to_loc           INT,
    p_qty              NUMERIC,
    p_actor            UUID   DEFAULT NULL,
    p_reason           TEXT   DEFAULT NULL,
    p_handling_unit_id BIGINT DEFAULT NULL,   -- NULL = any plate (legacy behaviour)
    p_ref_type         TEXT   DEFAULT 'transfer',  -- defaults reproduce 00080 exactly
    p_ref_id           TEXT   DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_remaining NUMERIC := p_qty;
    v_take      NUMERIC;
    v_row       RECORD;
BEGIN
    IF p_qty <= 0 THEN
        RAISE EXCEPTION 'INVALID_QTY: transfer quantity must be positive' USING ERRCODE = 'P0001';
    END IF;
    IF p_from_loc = p_to_loc THEN
        RAISE EXCEPTION 'INVALID_TRANSFER: source and destination are the same' USING ERRCODE = 'P0001';
    END IF;

    FOR v_row IN
        SELECT b.id, b.batch_id, b.handling_unit_id, b.available
        FROM public.inventory_balances b
        LEFT JOIN public.batches bt ON bt.id = b.batch_id
        WHERE b.product_id = p_product_id
          AND b.location_id = p_from_loc
          AND b.available > 0
          -- Written as (IS NULL OR =) rather than a negated compound: a NULL
          -- inside NOT(...) yields NULL, not TRUE, and would silently drop rows.
          AND (p_handling_unit_id IS NULL OR b.handling_unit_id = p_handling_unit_id)
        ORDER BY bt.expiry_date NULLS LAST, bt.received_at NULLS FIRST, b.id
        FOR UPDATE OF b
    LOOP
        EXIT WHEN v_remaining <= 0;
        v_take := LEAST(v_remaining, v_row.available);
        CONTINUE WHEN v_take <= 0;
        -- Both legs carry the SAME plate: moving a pallet does not change which
        -- pallet it is. This is also exactly what whole-plate putaway needs --
        -- transferring the plate's stock relocates the plate, and hu_recompute
        -- then follows its balance rows to the destination.
        --
        -- Both legs also carry the same ref: the movement is ONE act, and a
        -- query that finds only half of it is worse than one that finds none.
        PERFORM public.inv_apply_leg(
            p_product_id, p_from_loc, v_row.batch_id, -v_take, 0,
            'transfer_out', p_actor, p_ref_type, p_ref_id, p_reason,
            NULL, v_row.handling_unit_id);
        PERFORM public.inv_apply_leg(
            p_product_id, p_to_loc, v_row.batch_id, v_take, 0,
            'transfer_in', p_actor, p_ref_type, p_ref_id, p_reason,
            NULL, v_row.handling_unit_id);
        v_remaining := v_remaining - v_take;
    END LOOP;

    IF v_remaining > 0 THEN
        IF p_handling_unit_id IS NOT NULL THEN
            RAISE EXCEPTION
                'INSUFFICIENT_STOCK: plate % is short by % of product % at the source',
                p_handling_unit_id, v_remaining, p_product_id USING ERRCODE = 'P0001';
        END IF;
        RAISE EXCEPTION 'INSUFFICIENT_STOCK: product % short by % for transfer',
            p_product_id, v_remaining USING ERRCODE = 'P0001';
    END IF;

    RETURN jsonb_build_object('product_id', p_product_id, 'qty', p_qty,
                              'from_location_id', p_from_loc, 'to_location_id', p_to_loc,
                              'handling_unit_id', p_handling_unit_id);
END;
$$;

REVOKE ALL ON FUNCTION public.inv_transfer_stock(INT,INT,INT,NUMERIC,UUID,TEXT,BIGINT,TEXT,TEXT)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.inv_transfer_stock(INT,INT,INT,NUMERIC,UUID,TEXT,BIGINT,TEXT,TEXT)
    TO service_role;

-- ── 2. wie_complete_replen_tx -- stamp the completion record on the legs ─────
-- 00082 §5 verbatim apart from the inv_transfer_stock call at the end. SAME
-- signature, so this one is a genuine replacement and needs no DROP -- unlike
-- §1 above, and the difference is worth noticing rather than copying the DROP
-- around out of caution.
CREATE OR REPLACE FUNCTION public.wie_complete_replen_tx(
    p_task_id          BIGINT,
    p_actual_from      INT,
    p_actual_to        INT,
    p_qty              NUMERIC DEFAULT NULL,   -- NULL = the whole assigned quantity
    p_handling_unit_id BIGINT  DEFAULT NULL,   -- the plate actually scanned
    p_actor            UUID    DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_task        public.wie_replen_tasks%ROWTYPE;
    v_qty         NUMERIC;
    v_remainder   NUMERIC;
    v_status      TEXT;
    v_warn        BOOLEAN;
    v_completed   BIGINT;
    v_moved       JSONB;
BEGIN
    IF p_actual_from IS NULL OR p_actual_to IS NULL THEN
        RAISE EXCEPTION 'INVALID_INPUT: both the source and the destination bin are required'
            USING ERRCODE = 'P0001';
    END IF;
    IF p_actual_from = p_actual_to THEN
        RAISE EXCEPTION 'INVALID_TRANSFER: the source and destination cannot be the same location'
            USING ERRCODE = 'P0001';
    END IF;

    SELECT * INTO v_task FROM public.wie_replen_tasks WHERE id = p_task_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'NOT_FOUND: replenishment task % not found', p_task_id USING ERRCODE = 'P0001';
    END IF;
    -- Two walkers reaching for the same task: the loser lands here.
    IF v_task.status <> 'assigned' THEN
        RAISE EXCEPTION 'CONFLICT: replenishment task already %', v_task.status USING ERRCODE = 'P0001';
    END IF;

    -- HARD guard. The whole point of the task is to refill a pick zone; letting
    -- a mis-scan drop the stock into a bulk level would silently leave the slot
    -- it was meant to fix still empty. Do NOT soften this to allow a NULL role.
    IF NOT EXISTS (
        SELECT 1 FROM public.locations l
        JOIN public.level_roles r ON r.key = l.level_role
        WHERE l.id = p_actual_to AND r.is_pick_zone AND r.is_active
    ) THEN
        RAISE EXCEPTION 'INVALID_DESTINATION: location % is not a pick-zone level', p_actual_to
            USING ERRCODE = 'P0001';
    END IF;

    -- SOFT guard. A source outside the configured replen roles is RECORDED, not
    -- refused: pick-to-pick top-ups and root pulls are legitimate. Written as
    -- NOT EXISTS rather than a negated compound so a NULL level_role yields a
    -- warning rather than silently skipping the branch.
    v_warn := NOT EXISTS (
        SELECT 1 FROM public.locations l
        JOIN public.level_roles r ON r.key = l.level_role
        WHERE l.id = p_actual_from AND r.replen_source_rank IS NOT NULL AND r.is_active);

    v_qty := COALESCE(p_qty, v_task.quantity);
    IF v_qty <= 0 THEN
        RAISE EXCEPTION 'INVALID_QTY: moved quantity must be positive' USING ERRCODE = 'P0001';
    END IF;
    IF v_qty > v_task.quantity THEN
        RAISE EXCEPTION 'INVALID_QTY: % exceeds the % assigned on this task', v_qty, v_task.quantity
            USING ERRCODE = 'P0001';
    END IF;

    -- Status resolves across BOTH axes: the walker followed the desk only if the
    -- source AND the destination match.
    v_status := CASE
        WHEN p_actual_from = v_task.assigned_from_location_id
         AND p_actual_to   = v_task.to_location_id THEN 'accepted'
        ELSE 'overridden' END;
    v_remainder := v_task.quantity - v_qty;

    IF v_remainder = 0 THEN
        UPDATE public.wie_replen_tasks
        SET status = v_status,
            chosen_from_location_id = p_actual_from,
            chosen_to_location_id   = p_actual_to,
            chosen_handling_unit_id = p_handling_unit_id,
            decided_at = now(), actor_id = p_actor
        WHERE id = p_task_id;
        v_completed := p_task_id;
    ELSE
        UPDATE public.wie_replen_tasks SET quantity = v_remainder WHERE id = p_task_id;

        INSERT INTO public.wie_replen_tasks
            (warehouse_id, layout_id, product_id, to_location_id, chosen_to_location_id,
             recommended_from_location_id, assigned_from_location_id, chosen_from_location_id,
             quantity, handling_unit_id, chosen_handling_unit_id, trigger_kind,
             min_qty, max_qty, slot_on_hand, explanation, engine_version,
             status, assigned_at, assigned_by, actor_id, created_at, decided_at)
        VALUES
            (v_task.warehouse_id, v_task.layout_id, v_task.product_id, v_task.to_location_id, p_actual_to,
             v_task.recommended_from_location_id, v_task.assigned_from_location_id, p_actual_from,
             v_qty, v_task.handling_unit_id, p_handling_unit_id, v_task.trigger_kind,
             v_task.min_qty, v_task.max_qty, v_task.slot_on_hand, v_task.explanation, v_task.engine_version,
             v_status, v_task.assigned_at, v_task.assigned_by, p_actor, v_task.created_at, now())
        RETURNING id INTO v_completed;
    END IF;

    -- Same transaction: a failed move rolls the completion back with it, so a
    -- task can never read as done without a matching ledger leg.
    --
    -- inv_transfer_stock is AVAILABLE-only. That is the guarantee enforced at
    -- the last possible moment: a task sized from stale availability fails
    -- loudly (INSUFFICIENT_STOCK) rather than silently under-moving. Callers
    -- must map that to CONFLICT, not INTERNAL -- the walker is at the rack and
    -- can reduce the quantity or pick another source.
    v_moved := public.inv_transfer_stock(
        v_task.product_id, p_actual_from, p_actual_to, v_qty, p_actor,
        'replen:' || v_status, p_handling_unit_id,
        -- O13. The leg names the COMPLETION record (v_completed), which is
        -- p_task_id on a full completion and the split row on a partial -- i.e.
        -- always the row whose quantity is the quantity in this leg.
        'replen_task', v_completed::TEXT);

    RETURN jsonb_build_object(
        'completed_id',  v_completed,
        'status',        v_status,
        'source_warning', v_warn,
        'remainder_id',  CASE WHEN v_remainder > 0 THEN p_task_id ELSE NULL END,
        'remainder_qty', v_remainder,
        'moved',         v_moved);
END;
$$;

REVOKE ALL ON FUNCTION public.wie_complete_replen_tx(BIGINT,INT,INT,NUMERIC,BIGINT,UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wie_complete_replen_tx(BIGINT,INT,INT,NUMERIC,BIGINT,UUID) TO service_role;

COMMIT;

-- =============================================================================
-- Verify (rollback-isolated -- the SELECTs return pre-ROLLBACK state):
--
--   -- a. EXACTLY ONE inv_transfer_stock signature must survive the drop.
--   SELECT count(*) FROM pg_proc p
--     JOIN pg_namespace n ON n.oid = p.pronamespace
--    WHERE n.nspname = 'public' AND p.proname = 'inv_transfer_stock';
--   -- expect 1  (2 means the DROP missed and an overload is resident)
--
--   -- b. every other caller is unchanged: a putaway still writes ('transfer',NULL).
--   SELECT ref_type, ref_id, movement_type FROM inventory_movements
--    WHERE reason LIKE 'putaway:%' ORDER BY created_at DESC LIMIT 4;
--   -- expect ref_type='transfer', ref_id IS NULL
--
--   -- c. a completed replenishment names its task on BOTH legs.
--   SELECT m.movement_type, m.ref_type, m.ref_id, m.qty_delta
--     FROM inventory_movements m
--    WHERE m.ref_type = 'replen_task'
--    ORDER BY m.created_at DESC LIMIT 4;
--   -- expect two rows per completion (transfer_out / transfer_in), same ref_id,
--   -- and that ref_id present in wie_replen_tasks with status accepted|overridden:
--   SELECT id, status, quantity FROM wie_replen_tasks WHERE id = <ref_id>::BIGINT;
--
-- Rollback: re-run 00080 §2 (restoring the 7-arg signature, DROPping the 9-arg
-- one first) and 00082 §5. Nothing here changes a table, so no data is at risk.
-- =============================================================================
