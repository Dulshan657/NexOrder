-- =============================================================================
-- Pallet break-down at putaway
-- Migration: 00126_pallet_break_down.sql
-- =============================================================================
-- ONE function. No new table, no new column, no widened CHECK.
--
--   wie_break_down_putaway_tx -- mint plates, re-plate at the root, fan the
--                                task out into one assigned task per portion.
--
-- -- THE BUG THIS EXISTS TO NOT HAVE ------------------------------------------
--
-- Partial putaway looks like it already breaks a pallet down and does not.
-- `p_qty` on wie_assign_putaway_tx / wie_complete_putaway_tx splits the TASK; it
-- never splits the PLATE. inv_transfer_stock copies each balance row's
-- handling_unit_id onto both legs (00080 section 2), so placing part of a plate
-- leaves ONE handling_units row with stock in two locations. hu_recompute (00075
-- section 3) sees v_locs > 1, deliberately declines to pick a winner, and leaves
-- location_id stale -- and v_bin_fill (00122) then charges a pallet position in
-- BOTH bays. A broken-down pallet today is a plate that lies about where it is.
--
-- Breaking a pallet down is therefore not a quantity operation. It is a
-- CONTAINER operation: some of the units stop being on that pallet and start
-- being on a new one.
--
-- -- WHY NO STOCK LEAVES THE ROOT ---------------------------------------------
--
-- Two-stage putaway (00080) moves no stock at assign, for the reason its own
-- header gives: "un-placed goods read as sitting at the warehouse root, which is
-- where they actually are". A break-down keeps that promise. It re-plates the
-- units WHERE THEY ALREADY ARE and creates one 'assigned' task per portion; each
-- new plate then rides the existing walk as an ordinary stop and is completed by
-- complete-putaway with the plate + bin scan that already exists. That scan is
-- also what verifies the freshly-printed sticker went onto the right stack.
--
-- It also makes 00123 work for free: v_bin_pending_putaway charges one position
-- per DISTINCT plate on open tasks, so the moment the child tasks exist their
-- bays are correctly spoken for, with no change to that view.
--
-- -- WHY THE LEGS ARE transfer_out / transfer_in ------------------------------
--
-- A re-plate is two legs at the SAME location with different handling_unit_ids
-- -- legal since 00075 rebuilt the slot key as
-- (product, location, COALESCE(batch,0), COALESCE(hu,0)). The movement_type
-- CHECK (00027) is read by every stock-history surface in the app, and adding a
-- 'replate' verb would render blank in each of them until they all learned it.
-- ref_type = 'hu_split' answers "why" without teaching anyone a new word, and
-- ref_id names the parent plate, so the two halves of a split are joinable.
--
-- -- FEFO, AND available NOT on_hand ------------------------------------------
--
-- The parent's balance rows are consumed earliest-expiry-first, in the SAME
-- ORDER BY inv_transfer_stock uses, so FEFO means exactly one thing in this
-- codebase. Units are taken from `available`: reserved stock cannot change
-- container any more than it can change bin, and letting it would silently move
-- somebody's allocated units onto a plate that is about to walk to a pick face.
--
-- Additive, service-role only. Idempotent.
-- Apply via the Management API /database/query (the direct DB host is
-- unreachable from this box -- see supabase/apply-sql.mjs).
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- wie_break_down_putaway_tx
-- ---------------------------------------------------------------------------
-- p_portions is a JSONB array; each element is
--   { "qty": <numeric>, "hu_type": "pallet"|"carton", "location_id": <int>,
--     "recommended_location_id": <int|null>, "alternatives": <jsonb array>,
--     "explanation": <jsonb> }
--
-- The caller (break-down-putaway) has already scored each portion through the
-- putaway engine AS THE CONTAINER IT WILL BECOME and had the operator confirm a
-- bin, so this transaction re-decides nothing. It is deliberately dumb for the
-- same reason wie_update_layout_tx is: the maths is not restated in PL/pgSQL,
-- and what it adds is atomicity -- a half-broken pallet is a corrupt pallet.
CREATE OR REPLACE FUNCTION public.wie_break_down_putaway_tx(
    p_rec_id   BIGINT,
    p_portions JSONB,
    p_actor    UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_rec        public.wie_putaway_recommendations%ROWTYPE;
    v_portion    JSONB;
    v_total      NUMERIC := 0;
    v_qty        NUMERIC;
    v_hu_type    TEXT;
    v_loc        INT;
    v_new_hu     BIGINT;
    v_new_code   TEXT;
    v_new_rec    BIGINT;
    v_remaining  NUMERIC;
    v_take       NUMERIC;
    v_row        RECORD;
    v_plates     JSONB := '[]'::JSONB;
BEGIN
    IF p_portions IS NULL OR jsonb_typeof(p_portions) <> 'array'
       OR jsonb_array_length(p_portions) = 0 THEN
        RAISE EXCEPTION 'INVALID_INPUT: at least one portion is required'
            USING ERRCODE = 'P0001';
    END IF;

    -- The row lock is what stops two walkers breaking the same pallet down
    -- twice, and it is what makes the quantity check below true rather than
    -- merely true a moment ago.
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
    -- Loose stock has no plate to break. The units are already unattached; the
    -- operator wants a partial putaway, which complete-putaway already does.
    IF v_rec.handling_unit_id IS NULL THEN
        RAISE EXCEPTION
            'INVALID_INPUT: this line is not on a plate -- place part of it instead'
            USING ERRCODE = 'P0001';
    END IF;

    -- -- Validate the whole sheet BEFORE minting anything --------------------
    -- A refused break-down must leave no orphan handling_units rows behind. The
    -- transaction rolls those back anyway, but handling_unit_code_seq is a
    -- SEQUENCE and sequences do not roll back, so validating first is what keeps
    -- the plate codes on a site contiguous rather than pocked with gaps from
    -- attempts that never happened.
    FOR v_portion IN SELECT * FROM jsonb_array_elements(p_portions)
    LOOP
        v_qty     := (v_portion->>'qty')::NUMERIC;
        v_hu_type := v_portion->>'hu_type';
        v_loc     := (v_portion->>'location_id')::INT;

        IF v_qty IS NULL OR v_qty <= 0 THEN
            RAISE EXCEPTION 'INVALID_QTY: every portion needs a positive quantity'
                USING ERRCODE = 'P0001';
        END IF;
        IF v_hu_type IS NULL OR v_hu_type NOT IN ('pallet', 'carton') THEN
            RAISE EXCEPTION 'INVALID_INPUT: portion hu_type must be pallet or carton'
                USING ERRCODE = 'P0001';
        END IF;
        IF v_loc IS NULL THEN
            RAISE EXCEPTION 'INVALID_INPUT: every portion needs a destination bin'
                USING ERRCODE = 'P0001';
        END IF;

        v_total := v_total + v_qty;
    END LOOP;

    IF v_total > v_rec.quantity THEN
        RAISE EXCEPTION
            'INVALID_QTY: % exceeds the % on this task', v_total, v_rec.quantity
            USING ERRCODE = 'P0001';
    END IF;

    -- -- Mint, re-plate, and fan out -----------------------------------------
    FOR v_portion IN SELECT * FROM jsonb_array_elements(p_portions)
    LOOP
        v_qty     := (v_portion->>'qty')::NUMERIC;
        v_hu_type := v_portion->>'hu_type';
        v_loc     := (v_portion->>'location_id')::INT;

        -- `code` comes from the column DEFAULT (hu_next_code(), mig 00077) --
        -- never composed here, so there is one minting rule. status and
        -- location_id are left alone: hu_recompute derives both from the balance
        -- rows the legs below are about to write, which is what stops a plate
        -- ever disagreeing with the stock it describes.
        INSERT INTO public.handling_units
            (hu_type, warehouse_id, goods_receipt_id, created_by)
        VALUES
            (v_hu_type, v_rec.warehouse_id, v_rec.goods_receipt_id, p_actor)
        RETURNING id, code INTO v_new_hu, v_new_code;

        -- Re-plate at the root, FEFO. Same ORDER BY as inv_transfer_stock.
        v_remaining := v_qty;
        FOR v_row IN
            SELECT b.id, b.batch_id, b.available
            FROM public.inventory_balances b
            LEFT JOIN public.batches bt ON bt.id = b.batch_id
            WHERE b.product_id       = v_rec.product_id
              AND b.location_id      = v_rec.warehouse_id
              AND b.handling_unit_id = v_rec.handling_unit_id
              AND b.available > 0
            ORDER BY bt.expiry_date NULLS LAST, bt.received_at NULLS FIRST, b.id
            FOR UPDATE OF b
        LOOP
            EXIT WHEN v_remaining <= 0;
            v_take := LEAST(v_remaining, v_row.available);
            CONTINUE WHEN v_take <= 0;

            PERFORM public.inv_apply_leg(
                v_rec.product_id, v_rec.warehouse_id, v_row.batch_id, -v_take, 0,
                'transfer_out', p_actor, 'hu_split', v_rec.handling_unit_id::TEXT,
                'break down ' || v_new_code, NULL, v_rec.handling_unit_id);
            PERFORM public.inv_apply_leg(
                v_rec.product_id, v_rec.warehouse_id, v_row.batch_id, v_take, 0,
                'transfer_in', p_actor, 'hu_split', v_rec.handling_unit_id::TEXT,
                'break down ' || v_new_code, NULL, v_new_hu);

            v_remaining := v_remaining - v_take;
        END LOOP;

        IF v_remaining > 0 THEN
            -- The gap between assigning a task and walking it is minutes or
            -- hours, so an order can reserve this stock while the pallet stands
            -- on the dock. Name the plate: the operator is holding it.
            RAISE EXCEPTION
                'INSUFFICIENT_STOCK: plate % is short by % of product % at the dock',
                v_rec.handling_unit_id, v_remaining, v_rec.product_id
                USING ERRCODE = 'P0001';
        END IF;

        -- One assigned task per portion. recommended_location_id keeps what the
        -- ENGINE said for THIS portion (scored as the container it became), so
        -- "did the floor follow the engine" stays answerable per plate rather
        -- than being inherited from a decision made about a whole pallet.
        INSERT INTO public.wie_putaway_recommendations
            (warehouse_id, layout_id, product_id, quantity, goods_receipt_id,
             recommended_location_id, alternatives, explanation, engine_version,
             status, assigned_location_id, assigned_at, assigned_by,
             handling_unit_id, created_at)
        VALUES
            (v_rec.warehouse_id, v_rec.layout_id, v_rec.product_id, v_qty,
             v_rec.goods_receipt_id,
             NULLIF(v_portion->>'recommended_location_id', '')::INT,
             COALESCE(v_portion->'alternatives', '[]'::JSONB),
             COALESCE(v_portion->'explanation', '{}'::JSONB),
             v_rec.engine_version,
             'assigned', v_loc, now(), p_actor,
             v_new_hu, now())
        RETURNING id INTO v_new_rec;

        v_plates := v_plates || jsonb_build_object(
            'recommendation_id', v_new_rec,
            'handling_unit_id',  v_new_hu,
            'code',              v_new_code,
            'hu_type',           v_hu_type,
            'quantity',          v_qty,
            'location_id',       v_loc);
    END LOOP;

    -- -- What is left of the parent ------------------------------------------
    -- At zero the task is over: 'expired' is the status this table already uses
    -- for a task that no longer exists, and 00123's pending view excludes it, so
    -- the bay it was holding stops being spoken for in the same statement. The
    -- parent PLATE needs no update -- it now has no balance rows, and
    -- hu_recompute has already marked it 'empty'.
    IF v_rec.quantity - v_total = 0 THEN
        UPDATE public.wie_putaway_recommendations
        SET quantity   = 0,
            status     = 'expired',
            decided_at = now(),
            actor_id   = p_actor
        WHERE id = p_rec_id;
    ELSE
        UPDATE public.wie_putaway_recommendations
        SET quantity = v_rec.quantity - v_total
        WHERE id = p_rec_id;
    END IF;

    RETURN jsonb_build_object(
        'parent_id',        p_rec_id,
        'parent_remaining', v_rec.quantity - v_total,
        'parent_closed',    (v_rec.quantity - v_total) = 0,
        'plates',           v_plates);
END;
$$;

COMMENT ON FUNCTION public.wie_break_down_putaway_tx(BIGINT,JSONB,UUID) IS
    'Break an assigned putaway task apart into one new labelled handling unit '
    'per portion, re-plating at the warehouse root and creating one assigned '
    'task per plate. Moves nothing to a bay -- complete-putaway still does that, '
    'per plate, with a scan. Mig 00126.';

REVOKE ALL ON FUNCTION public.wie_break_down_putaway_tx(BIGINT,JSONB,UUID)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wie_break_down_putaway_tx(BIGINT,JSONB,UUID)
    TO service_role;

COMMIT;

-- =============================================================================
-- Verify with:
--
--   -- a. Exactly ONE overload. A second row means CREATE OR REPLACE made an
--   --    overload rather than replacing (the 00037 / 00074 trap).
--   SELECT count(*) FROM pg_proc WHERE proname = 'wie_break_down_putaway_tx';
--
--   -- b. No plate may hold stock in more than one place. This is the invariant
--   --    the whole migration exists to preserve; expect ZERO rows, before and
--   --    after any break-down.
--   SELECT handling_unit_id, count(DISTINCT location_id) AS places
--     FROM public.inventory_balances
--    WHERE handling_unit_id IS NOT NULL AND on_hand > 0
--    GROUP BY 1 HAVING count(DISTINCT location_id) > 1;
--
--   -- c. Every split nets to zero at the root. Expect ZERO rows.
--   SELECT ref_id, product_id, sum(qty_delta) AS net
--     FROM public.inventory_movements
--    WHERE ref_type = 'hu_split'
--    GROUP BY 1, 2 HAVING sum(qty_delta) <> 0;
--
--   -- d. Nothing went negative.
--   SELECT * FROM public.inventory_balances WHERE on_hand < 0 OR allocated < 0;
--
--   -- e. Rehearse against a real dev task inside BEGIN ... ROLLBACK via
--   --    scripts/lib/managementApi.mjs runSqlRolledBack.
-- =============================================================================
