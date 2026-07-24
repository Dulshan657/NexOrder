-- =============================================================================
-- Putaway — two stages: assign at the desk, place on the floor
-- Migration: 00080_putaway_two_stage.sql
-- =============================================================================
-- Until now, accepting a putaway recommendation WAS the putaway:
-- wie_decide_putaway_tx (mig 00071) claimed the row, optionally split it, and
-- ran inv_transfer_stock root -> bin in one transaction. So the moment someone
-- clicked Accept at a desk, the database asserted the pallet was in the bin --
-- while it was still physically sitting on the dock. There was no state for
-- "assigned but not yet carried there", and nothing for the person carrying it.
--
-- This migration splits that into two moves of the same single ledger leg:
--
--   suggested --assign--> assigned --complete--> accepted | overridden
--                (no stock move)        (inv_transfer_stock fires HERE)
--
-- Un-placed goods therefore read as being at the warehouse root, which is where
-- they actually are, for as long as they are actually there.
--
-- Contents:
--   1. 'assigned' status + assigned_location_id / assigned_at / assigned_by
--   2. inv_transfer_stock gains p_handling_unit_id (plate-targeted movement)
--   3. wie_assign_putaway_tx      -- claim + optional split, NO stock move
--   4. wie_complete_putaway_tx    -- claim + optional split + the transfer
--   5. wie_unassign_putaway_tx    -- assigned -> suggested, for abandoned runs
--   6. wie_putaway_stops          -- assigned rows as routable walk stops
--
-- wie_decide_putaway_tx is deliberately UNTOUCHED: it stays the one-step
-- "place it now" path that desk/bulk work (and the CSV opening-stock importer's
-- follow-up putaway) still uses, so nothing that exists today changes behaviour.
--
-- Additive, service-role only. Idempotent.
-- Apply via the Management API (see CLAUDE.md); do not run interactively.
-- =============================================================================

BEGIN;

-- ── 1. The 'assigned' state ──────────────────────────────────────────────────
-- The CHECK was declared inline in 00045, so it carries Postgres's generated
-- name. Dropping IF EXISTS keeps this idempotent and survives a re-run.
ALTER TABLE public.wie_putaway_recommendations
    DROP CONSTRAINT IF EXISTS wie_putaway_recommendations_status_check;
ALTER TABLE public.wie_putaway_recommendations
    ADD CONSTRAINT wie_putaway_recommendations_status_check
    CHECK (status IN ('suggested','assigned','accepted','overridden','expired'));

-- Where the desk said it should go, kept separate from:
--   * recommended_location_id -- what the ENGINE said (never overwritten), and
--   * chosen_location_id      -- where it ACTUALLY landed (written on complete).
-- Keeping all three is what lets the audit trail answer "did the floor put it
-- where the desk said, and did the desk follow the engine?" independently.
ALTER TABLE public.wie_putaway_recommendations
    ADD COLUMN IF NOT EXISTS assigned_location_id INT REFERENCES public.locations(id),
    ADD COLUMN IF NOT EXISTS assigned_at          TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS assigned_by          UUID REFERENCES public.profiles(id);

COMMENT ON COLUMN public.wie_putaway_recommendations.assigned_location_id IS
    'Bin the desk assigned this line to (mig 00080). Stock has NOT moved yet -- '
    'it is still at the warehouse root until wie_complete_putaway_tx runs.';

-- The walk view reads exactly this slice, per warehouse.
CREATE INDEX IF NOT EXISTS idx_wie_putaway_recs_assigned
    ON public.wie_putaway_recommendations(warehouse_id, assigned_location_id)
    WHERE status = 'assigned';

-- ── 2. inv_transfer_stock -- plate-targeted movement ─────────────────────────
-- 00078 left this deliberately plate-blind: it moves a QUANTITY expiry-ordered,
-- "carrying whatever plate each row has", and noted that making the NAMED plate
-- the one that physically moves was "a separate change". Scan-verified putaway
-- is what justifies making it: without this, the walker scans plate A while the
-- ledger relocates plate B, and the scan evidence is theatre.
--
-- p_handling_unit_id NULL == today's behaviour exactly (unconstrained,
-- expiry-ordered), which is what all three existing callers get via the default.
--
-- !! DROP FIRST. CREATE OR REPLACE at a DIFFERENT ARG COUNT creates an
-- !! OVERLOAD, not a replacement -- the mig 00037 / 00074 trap. Leaving both
-- !! signatures resident makes every 6-arg call ambiguous or silently bind to
-- !! the stale body. Verify with the pg_proc count at the bottom of this file.
DROP FUNCTION IF EXISTS public.inv_transfer_stock(INT,INT,INT,NUMERIC,UUID,TEXT);

CREATE OR REPLACE FUNCTION public.inv_transfer_stock(
    p_product_id       INT,
    p_from_loc         INT,
    p_to_loc           INT,
    p_qty              NUMERIC,
    p_actor            UUID   DEFAULT NULL,
    p_reason           TEXT   DEFAULT NULL,
    p_handling_unit_id BIGINT DEFAULT NULL   -- NULL = any plate (legacy behaviour)
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
        PERFORM public.inv_apply_leg(
            p_product_id, p_from_loc, v_row.batch_id, -v_take, 0,
            'transfer_out', p_actor, 'transfer', NULL, p_reason,
            NULL, v_row.handling_unit_id);
        PERFORM public.inv_apply_leg(
            p_product_id, p_to_loc, v_row.batch_id, v_take, 0,
            'transfer_in', p_actor, 'transfer', NULL, p_reason,
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

REVOKE ALL ON FUNCTION public.inv_transfer_stock(INT,INT,INT,NUMERIC,UUID,TEXT,BIGINT)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.inv_transfer_stock(INT,INT,INT,NUMERIC,UUID,TEXT,BIGINT)
    TO service_role;

-- ── 3. wie_assign_putaway_tx -- decide the bin, move nothing ─────────────────
-- Mirrors wie_decide_putaway_tx's claim + split semantics exactly, minus the
-- transfer. Partial assignment leaves the ORIGINAL row 'suggested' holding the
-- remainder (so the Assign queue keeps showing what is still undecided) and
-- inserts an 'assigned' copy for the portion being carried.
CREATE OR REPLACE FUNCTION public.wie_assign_putaway_tx(
    p_rec_id   BIGINT,
    p_chosen   INT,
    p_qty      NUMERIC DEFAULT NULL,   -- NULL = the whole remaining quantity
    p_actor    UUID    DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_rec         public.wie_putaway_recommendations%ROWTYPE;
    v_qty         NUMERIC;
    v_remainder   NUMERIC;
    v_assigned_id BIGINT;
BEGIN
    IF p_chosen IS NULL THEN
        RAISE EXCEPTION 'INVALID_INPUT: a chosen location is required'
            USING ERRCODE = 'P0001';
    END IF;

    SELECT * INTO v_rec
    FROM public.wie_putaway_recommendations
    WHERE id = p_rec_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'NOT_FOUND: recommendation % not found', p_rec_id
            USING ERRCODE = 'P0001';
    END IF;
    IF v_rec.status <> 'suggested' THEN
        RAISE EXCEPTION 'CONFLICT: recommendation already %', v_rec.status
            USING ERRCODE = 'P0001';
    END IF;

    v_qty := COALESCE(p_qty, v_rec.quantity);
    IF v_qty <= 0 THEN
        RAISE EXCEPTION 'INVALID_QTY: assigned quantity must be positive'
            USING ERRCODE = 'P0001';
    END IF;
    IF v_qty > v_rec.quantity THEN
        RAISE EXCEPTION 'INVALID_QTY: % exceeds the % left on this recommendation',
            v_qty, v_rec.quantity USING ERRCODE = 'P0001';
    END IF;

    v_remainder := v_rec.quantity - v_qty;

    IF v_remainder = 0 THEN
        UPDATE public.wie_putaway_recommendations
        SET status               = 'assigned',
            assigned_location_id = p_chosen,
            assigned_at          = now(),
            assigned_by          = p_actor
        WHERE id = p_rec_id;
        v_assigned_id := p_rec_id;
    ELSE
        UPDATE public.wie_putaway_recommendations
        SET quantity = v_remainder
        WHERE id = p_rec_id;

        INSERT INTO public.wie_putaway_recommendations
            (warehouse_id, layout_id, product_id, quantity, goods_receipt_id,
             recommended_location_id, alternatives, explanation, engine_version,
             status, assigned_location_id, assigned_at, assigned_by,
             handling_unit_id, created_at)
        VALUES
            (v_rec.warehouse_id, v_rec.layout_id, v_rec.product_id, v_qty,
             v_rec.goods_receipt_id, v_rec.recommended_location_id,
             v_rec.alternatives, v_rec.explanation, v_rec.engine_version,
             'assigned', p_chosen, now(), p_actor,
             v_rec.handling_unit_id, v_rec.created_at)
        RETURNING id INTO v_assigned_id;
    END IF;

    RETURN jsonb_build_object(
        'assigned_id',   v_assigned_id,
        'remainder_id',  CASE WHEN v_remainder > 0 THEN p_rec_id ELSE NULL END,
        'remainder_qty', v_remainder);
END;
$$;

REVOKE ALL ON FUNCTION public.wie_assign_putaway_tx(BIGINT,INT,NUMERIC,UUID)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wie_assign_putaway_tx(BIGINT,INT,NUMERIC,UUID)
    TO service_role;

-- ── 4. wie_complete_putaway_tx -- the stock actually moves here ──────────────
-- p_actual is where the walker PUT it, which is not necessarily where the desk
-- said. A mismatch is not an error (an assigned bay is often found full or
-- blocked); it is recorded as 'overridden' with chosen_location_id naming the
-- real bin, so the discrepancy is reportable rather than invisible.
--
-- A partial completion leaves the ORIGINAL row 'assigned' with the remainder,
-- still pointed at the same bin: those units are still on the dock and still on
-- the walker's run.
CREATE OR REPLACE FUNCTION public.wie_complete_putaway_tx(
    p_rec_id   BIGINT,
    p_actual   INT,
    p_qty      NUMERIC DEFAULT NULL,   -- NULL = the whole assigned quantity
    p_actor    UUID    DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_rec         public.wie_putaway_recommendations%ROWTYPE;
    v_qty         NUMERIC;
    v_remainder   NUMERIC;
    v_status      TEXT;
    v_placed_id   BIGINT;
    v_moved       JSONB;
BEGIN
    IF p_actual IS NULL THEN
        RAISE EXCEPTION 'INVALID_INPUT: the bin it was placed in is required'
            USING ERRCODE = 'P0001';
    END IF;

    SELECT * INTO v_rec
    FROM public.wie_putaway_recommendations
    WHERE id = p_rec_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'NOT_FOUND: recommendation % not found', p_rec_id
            USING ERRCODE = 'P0001';
    END IF;
    -- Two walkers reaching for the same task: the loser lands here.
    IF v_rec.status <> 'assigned' THEN
        RAISE EXCEPTION 'CONFLICT: recommendation already %', v_rec.status
            USING ERRCODE = 'P0001';
    END IF;

    v_qty := COALESCE(p_qty, v_rec.quantity);
    IF v_qty <= 0 THEN
        RAISE EXCEPTION 'INVALID_QTY: placed quantity must be positive'
            USING ERRCODE = 'P0001';
    END IF;
    IF v_qty > v_rec.quantity THEN
        RAISE EXCEPTION 'INVALID_QTY: % exceeds the % assigned on this task',
            v_qty, v_rec.quantity USING ERRCODE = 'P0001';
    END IF;

    v_status := CASE WHEN p_actual = v_rec.assigned_location_id
                     THEN 'accepted' ELSE 'overridden' END;
    v_remainder := v_rec.quantity - v_qty;

    IF v_remainder = 0 THEN
        UPDATE public.wie_putaway_recommendations
        SET status             = v_status,
            chosen_location_id = p_actual,
            decided_at         = now(),
            actor_id           = p_actor
        WHERE id = p_rec_id;
        v_placed_id := p_rec_id;
    ELSE
        UPDATE public.wie_putaway_recommendations
        SET quantity = v_remainder
        WHERE id = p_rec_id;

        INSERT INTO public.wie_putaway_recommendations
            (warehouse_id, layout_id, product_id, quantity, goods_receipt_id,
             recommended_location_id, alternatives, explanation, engine_version,
             status, assigned_location_id, assigned_at, assigned_by,
             chosen_location_id, handling_unit_id, actor_id, created_at, decided_at)
        VALUES
            (v_rec.warehouse_id, v_rec.layout_id, v_rec.product_id, v_qty,
             v_rec.goods_receipt_id, v_rec.recommended_location_id,
             v_rec.alternatives, v_rec.explanation, v_rec.engine_version,
             v_status, v_rec.assigned_location_id, v_rec.assigned_at, v_rec.assigned_by,
             p_actual, v_rec.handling_unit_id, p_actor, v_rec.created_at, now())
        RETURNING id INTO v_placed_id;
    END IF;

    -- Same transaction: a failed move rolls the completion back with it, so a
    -- task can never read as placed without a matching ledger leg.
    --
    -- The plate named on the recommendation is the one that moves. The walker
    -- scanned it (that is what complete-putaway validates), so the ledger and
    -- the physical world agree about WHICH pallet went where -- not merely how
    -- many units did.
    v_moved := public.inv_transfer_stock(
        v_rec.product_id, v_rec.warehouse_id, p_actual, v_qty, p_actor,
        'putaway:' || v_status, v_rec.handling_unit_id);

    RETURN jsonb_build_object(
        'placed_id',     v_placed_id,
        'status',        v_status,
        'remainder_id',  CASE WHEN v_remainder > 0 THEN p_rec_id ELSE NULL END,
        'remainder_qty', v_remainder,
        'moved',         v_moved);
END;
$$;

REVOKE ALL ON FUNCTION public.wie_complete_putaway_tx(BIGINT,INT,NUMERIC,UUID)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wie_complete_putaway_tx(BIGINT,INT,NUMERIC,UUID)
    TO service_role;

-- ── 5. wie_unassign_putaway_tx -- put it back on the queue ───────────────────
-- For a run someone starts and abandons. No stock has moved, so this is a pure
-- state reversal; the line returns to the Assign queue exactly as it was.
CREATE OR REPLACE FUNCTION public.wie_unassign_putaway_tx(
    p_rec_id BIGINT,
    p_actor  UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_rec public.wie_putaway_recommendations%ROWTYPE;
BEGIN
    SELECT * INTO v_rec
    FROM public.wie_putaway_recommendations
    WHERE id = p_rec_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'NOT_FOUND: recommendation % not found', p_rec_id
            USING ERRCODE = 'P0001';
    END IF;
    IF v_rec.status <> 'assigned' THEN
        RAISE EXCEPTION 'CONFLICT: recommendation is %, not assigned', v_rec.status
            USING ERRCODE = 'P0001';
    END IF;

    UPDATE public.wie_putaway_recommendations
    SET status               = 'suggested',
        assigned_location_id = NULL,
        assigned_at          = NULL,
        assigned_by          = NULL
    WHERE id = p_rec_id;

    RETURN jsonb_build_object('unassigned_id', p_rec_id);
END;
$$;

REVOKE ALL ON FUNCTION public.wie_unassign_putaway_tx(BIGINT,UUID)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wie_unassign_putaway_tx(BIGINT,UUID)
    TO service_role;

-- ── 6. wie_putaway_stops -- the walk, as routable stops ──────────────────────
-- Shape deliberately mirrors wie_order_pick_stops (mig 00064) so
-- recommend-putaway-route can feed _shared/wie/picking.ts sequencePickRoute
-- with no adapter: graph_node_id + access_offset_m come from the warehouse's
-- ACTIVE layout placement, and a bin missing from that layout returns NULL,
-- which the sequencer already treats as "unreachable, append without a leg".
CREATE OR REPLACE FUNCTION public.wie_putaway_stops(p_warehouse_id INT)
RETURNS TABLE(
    rec_id          BIGINT,
    product_id      INT,
    location_id     INT,
    code            TEXT,
    graph_node_id   INT,
    access_offset_m NUMERIC,
    qty_base        NUMERIC,
    hu_code         TEXT,
    hu_type         TEXT,
    sku             TEXT,
    product_name    TEXT
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
    SELECT
        r.id,
        r.product_id,
        r.assigned_location_id,
        l.code,
        pl.graph_node_id,
        COALESCE(pl.access_offset_m, 0),
        r.quantity,
        hu.code,
        hu.hu_type,
        p.sku,
        p.name
    FROM public.wie_putaway_recommendations r
    JOIN public.locations l  ON l.id = r.assigned_location_id
    JOIN public.locations wh ON wh.id = r.warehouse_id
    LEFT JOIN public.layout_placements pl
        ON pl.location_id = r.assigned_location_id
       AND pl.layout_id = wh.active_layout_id
    LEFT JOIN public.handling_units hu ON hu.id = r.handling_unit_id
    LEFT JOIN public.products p ON p.id = r.product_id
    WHERE r.warehouse_id = p_warehouse_id
      AND r.status = 'assigned'
    ORDER BY r.created_at, r.id
$$;

REVOKE ALL ON FUNCTION public.wie_putaway_stops(INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wie_putaway_stops(INT) TO service_role;

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
--   -- b. assign moves NO stock.
--   BEGIN;
--     SELECT on_hand FROM inventory_balances
--      WHERE product_id = <p> AND location_id = <warehouse root>;      -- before
--     SELECT public.wie_assign_putaway_tx(<rec_id>, <bin_id>, NULL, NULL);
--     SELECT status, assigned_location_id FROM wie_putaway_recommendations
--      WHERE id = <rec_id>;                        -- expect 'assigned', <bin_id>
--     SELECT on_hand FROM inventory_balances
--      WHERE product_id = <p> AND location_id = <warehouse root>;      -- UNCHANGED
--   ROLLBACK;
--
--   -- c. complete moves it, and a different bin is recorded as overridden.
--   BEGIN;
--     SELECT public.wie_assign_putaway_tx(<rec_id>, <bin_a>, NULL, NULL);
--     SELECT public.wie_complete_putaway_tx(<rec_id>, <bin_b>, NULL, NULL);
--     SELECT status, assigned_location_id, chosen_location_id
--       FROM wie_putaway_recommendations WHERE id = <rec_id>;
--     -- expect 'overridden', <bin_a>, <bin_b>
--     SELECT location_id, on_hand FROM inventory_balances
--      WHERE product_id = <p>;                     -- stock now sits in <bin_b>
--   ROLLBACK;
--
--   -- d. partial completion leaves the remainder ASSIGNED, not suggested.
--   BEGIN;
--     SELECT public.wie_assign_putaway_tx(<rec_id>, <bin_a>, NULL, NULL);
--     SELECT public.wie_complete_putaway_tx(<rec_id>, <bin_a>, 5, NULL);
--     SELECT id, status, quantity FROM wie_putaway_recommendations
--      WHERE id = <rec_id> OR chosen_location_id = <bin_a>;
--     -- expect the original 'assigned' with quantity - 5, plus an 'accepted' copy of 5
--   ROLLBACK;
-- =============================================================================
