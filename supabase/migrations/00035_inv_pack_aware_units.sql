-- 00035_inv_pack_aware_units.sql
-- =============================================================================
-- Make the inventory ledger pack-size aware so carton order lines deplete the
-- correct number of BASE units.
--
-- Canonical unit model (applies to every order_items row):
--     base_units(line) = quantity * COALESCE(pack_size, 1)
--   * `quantity`  is in LINE units (number of cartons for a carton line, number
--     of units for a single-unit line).
--   * `pack_size` is the pack FACTOR (units per carton); NULL/1 means no scaling.
--   * inventory_balances.on_hand / allocated and products.inventory are always in
--     BASE units.
--
-- THE BUG THIS FIXES: previously inv_pick_order_line / inv_release_reservation
-- (and place-order's reservation) treated a carton line's `quantity` as base
-- units, so ordering 5 cartons of 12 reserved/depleted 5 units instead of 60 —
-- silent overselling. place-order now passes BASE units to inv_reserve_order
-- (TS change); this migration makes pick + release scale by pack_size to match.
--
-- WHAT STAYS IN LINE UNITS (unchanged): the OVER_PICK guard, pick_progress rows,
-- and the line_fully_picked / order_fully_picked flags all compare picked LINE
-- units against order_items.quantity. Only the physical on_hand/allocated
-- draw-down (pick) and the released remainder (release) are scaled to base units.
-- The pick UI therefore needs no change — it still picks in line units (cartons).
--
-- NOTE on approve-po (PO-inbox): that path stores `quantity` already in selling
-- units with pack_size as descriptive metadata. It is updated (in the edge
-- function) to write pack_size = NULL into order_items, so base = quantity * 1
-- and these RPCs do not mis-scale it.
--
-- RECONCILIATION: pre-fix reservations recorded `allocated` in LINE (carton)
-- units, so it is now understated for open orders. We reset all soft
-- reservations and rebuild them in base units from orders that are placed but
-- not yet picked (status 'processing'/'processed' — on_hand is still intact for
-- these). Mid-fulfilment ('picked'/'packed') and finished orders are left as-is;
-- inv_pick_order_line (00033) already tolerates allocated drift by clamping, so
-- this never drives a CHECK violation. Acceptable for the current low-volume /
-- demo dataset.
-- =============================================================================

BEGIN;

-- ── pick: scale the physical draw-down to base units ─────────────────────────
CREATE OR REPLACE FUNCTION public.inv_pick_order_line(
    p_order_item_id INT,
    p_picked_qty    NUMERIC,   -- in LINE units (cartons for a carton line)
    p_actor         UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_loc           INT := public.inv_default_location();
    v_item          RECORD;
    v_factor        NUMERIC;
    v_already       NUMERIC;
    v_remaining     NUMERIC;
    v_take          NUMERIC;
    v_dealloc       NUMERIC;
    v_row           RECORD;
    v_last_batch    INT;
    v_order_done    BOOLEAN;
BEGIN
    IF p_picked_qty <= 0 THEN
        RAISE EXCEPTION 'INVALID_QTY: picked_qty must be positive' USING ERRCODE = 'P0001';
    END IF;

    SELECT oi.id, oi.order_id, oi.product_id, oi.quantity, oi.pack_size
    INTO v_item
    FROM public.order_items oi
    WHERE oi.id = p_order_item_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'ORDER_ITEM_NOT_FOUND: %', p_order_item_id USING ERRCODE = 'P0001';
    END IF;

    v_factor := COALESCE(v_item.pack_size, 1);

    -- OVER_PICK guard + progress stay in LINE units (compare against quantity).
    SELECT COALESCE(SUM(picked_qty), 0) INTO v_already
    FROM public.pick_progress WHERE order_item_id = p_order_item_id;

    IF v_already + p_picked_qty > v_item.quantity THEN
        RAISE EXCEPTION 'OVER_PICK: line % would exceed ordered qty', p_order_item_id
            USING ERRCODE = 'P0001';
    END IF;

    -- Draw down physical stock FIFO in BASE units (picked line units * pack).
    -- Release any reservation that exists, but never require one and never push
    -- allocated below zero — unreserved (legacy) orders pick straight from on_hand.
    v_remaining := p_picked_qty * v_factor;
    FOR v_row IN
        SELECT b.id, b.batch_id, b.allocated, b.on_hand
        FROM public.inventory_balances b
        LEFT JOIN public.batches bt ON bt.id = b.batch_id
        WHERE b.product_id = v_item.product_id AND b.location_id = v_loc AND b.on_hand > 0
        ORDER BY bt.expiry_date NULLS LAST, bt.received_at NULLS FIRST, b.id
        FOR UPDATE OF b
    LOOP
        EXIT WHEN v_remaining <= 0;
        v_take := LEAST(v_remaining, v_row.on_hand);
        CONTINUE WHEN v_take <= 0;
        v_dealloc := LEAST(v_take, v_row.allocated);   -- release only real holds
        PERFORM public.inv_apply_leg(
            v_item.product_id, v_loc, v_row.batch_id, -v_take, -v_dealloc,
            'pick', p_actor, 'order', v_item.order_id, NULL);
        v_last_batch := v_row.batch_id;
        v_remaining := v_remaining - v_take;
    END LOOP;

    IF v_remaining > 0 THEN
        RAISE EXCEPTION 'INSUFFICIENT_STOCK: product % short by % at pick',
            v_item.product_id, v_remaining USING ERRCODE = 'P0001';
    END IF;

    -- pick_progress is recorded in LINE units (cartons), matching order_items.quantity.
    INSERT INTO public.pick_progress
        (order_id, order_item_id, location_id, batch_id, picked_qty, picked_by)
    VALUES
        (v_item.order_id, p_order_item_id, v_loc, v_last_batch, p_picked_qty::INT, p_actor);

    -- Is every line of the order now fully picked? (LINE units.)
    SELECT NOT EXISTS (
        SELECT 1 FROM public.order_items oi
        WHERE oi.order_id = v_item.order_id
          AND oi.quantity > COALESCE((
              SELECT SUM(pp.picked_qty) FROM public.pick_progress pp
              WHERE pp.order_item_id = oi.id), 0)
    ) INTO v_order_done;

    RETURN jsonb_build_object(
        'line_fully_picked',  (v_already + p_picked_qty) >= v_item.quantity,
        'order_fully_picked', v_order_done
    );
END;
$$;

REVOKE ALL ON FUNCTION public.inv_pick_order_line(INT,NUMERIC,UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.inv_pick_order_line(INT,NUMERIC,UUID) TO service_role;

-- ── release: scale the released remainder to base units ──────────────────────
CREATE OR REPLACE FUNCTION public.inv_release_reservation(
    p_order_id  TEXT,
    p_actor     UUID DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_loc       INT := public.inv_default_location();
    v_line      RECORD;
    v_remaining NUMERIC;
    v_take      NUMERIC;
    v_row       RECORD;
BEGIN
    FOR v_line IN
        SELECT oi.product_id,
               -- reserved remainder in LINE units, scaled to BASE units
               (oi.quantity
                  - COALESCE((SELECT SUM(pp.picked_qty) FROM public.pick_progress pp
                              WHERE pp.order_item_id = oi.id), 0))
                 * COALESCE(oi.pack_size, 1) AS reserved_remaining
        FROM public.order_items oi
        WHERE oi.order_id = p_order_id
    LOOP
        v_remaining := GREATEST(v_line.reserved_remaining, 0);
        CONTINUE WHEN v_remaining <= 0;

        FOR v_row IN
            SELECT id, batch_id, allocated
            FROM public.inventory_balances
            WHERE product_id = v_line.product_id AND location_id = v_loc AND allocated > 0
            ORDER BY id
            FOR UPDATE
        LOOP
            EXIT WHEN v_remaining <= 0;
            v_take := LEAST(v_remaining, v_row.allocated);
            PERFORM public.inv_apply_leg(
                v_line.product_id, v_loc, v_row.batch_id, 0, -v_take,
                'deallocate', p_actor, 'order', p_order_id, 'reservation released');
            v_remaining := v_remaining - v_take;
        END LOOP;
    END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.inv_release_reservation(TEXT,UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.inv_release_reservation(TEXT,UUID) TO service_role;

-- ── reconciliation: rebuild soft reservations in base units ──────────────────
-- Clear every existing hold (was recorded in line units), then re-reserve open,
-- not-yet-picked orders in base units. allow_partial=true so a short product
-- never aborts the rebuild.
UPDATE public.inventory_balances SET allocated = 0 WHERE allocated <> 0;

DO $$
DECLARE
    v_order RECORD;
    v_items JSONB;
BEGIN
    FOR v_order IN
        SELECT id FROM public.orders WHERE status IN ('processing', 'processed')
    LOOP
        SELECT jsonb_agg(jsonb_build_object(
                   'product_id', oi.product_id,
                   'quantity',   oi.quantity * COALESCE(oi.pack_size, 1)))
        INTO v_items
        FROM public.order_items oi
        WHERE oi.order_id = v_order.id;

        IF v_items IS NOT NULL THEN
            PERFORM public.inv_reserve_order(v_order.id, v_items, NULL, true);
        END IF;
    END LOOP;
END $$;

COMMIT;
