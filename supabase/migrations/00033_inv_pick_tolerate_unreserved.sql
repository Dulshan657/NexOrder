-- 00033_inv_pick_tolerate_unreserved.sql
-- =============================================================================
-- Make picking robust to orders that carry no reservation.
--
-- The original inv_pick_order_line (00027, lock-fixed in 00028) only drew from
-- inventory_balances rows where allocated > 0 and required the full picked qty
-- to be covered by allocation, otherwise it raised INSUFFICIENT_ALLOCATED.
--
-- That assumes every pickable order was reserved via inv_reserve_order. Orders
-- created BEFORE the inventory system shipped (and any order whose reservation
-- never ran) have allocated = 0, so every pick attempt 409'd.
--
-- Picking is the PHYSICAL removal of stock: it must decrement on_hand whether or
-- not a soft reservation exists, and release the reservation only to the extent
-- one is actually held (clamped at 0 so allocated never goes negative). A true
-- physical shortage now raises INSUFFICIENT_STOCK.
--
-- Safety: subtracting `take` from on_hand and min(take, allocated) from allocated
-- preserves both CHECK invariants (on_hand >= 0 AND allocated >= 0 AND
-- allocated <= on_hand). The per-line OVER_PICK guard still prevents picking more
-- than the ordered quantity, so there is no over-pick / over-sell path.
-- =============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.inv_pick_order_line(
    p_order_item_id INT,
    p_picked_qty    NUMERIC,
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

    SELECT oi.id, oi.order_id, oi.product_id, oi.quantity
    INTO v_item
    FROM public.order_items oi
    WHERE oi.id = p_order_item_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'ORDER_ITEM_NOT_FOUND: %', p_order_item_id USING ERRCODE = 'P0001';
    END IF;

    SELECT COALESCE(SUM(picked_qty), 0) INTO v_already
    FROM public.pick_progress WHERE order_item_id = p_order_item_id;

    IF v_already + p_picked_qty > v_item.quantity THEN
        RAISE EXCEPTION 'OVER_PICK: line % would exceed ordered qty', p_order_item_id
            USING ERRCODE = 'P0001';
    END IF;

    -- Draw down physical stock FIFO. Release any reservation that exists, but
    -- never require one and never push allocated below zero — unreserved
    -- (legacy) orders pick straight out of on_hand.
    v_remaining := p_picked_qty;
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

    INSERT INTO public.pick_progress
        (order_id, order_item_id, location_id, batch_id, picked_qty, picked_by)
    VALUES
        (v_item.order_id, p_order_item_id, v_loc, v_last_batch, p_picked_qty::INT, p_actor);

    -- Is every line of the order now fully picked?
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

-- EXECUTE grants survive CREATE OR REPLACE (same signature) but re-assert defensively.
REVOKE ALL ON FUNCTION public.inv_pick_order_line(INT,NUMERIC,UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.inv_pick_order_line(INT,NUMERIC,UUID) TO service_role;

COMMIT;
