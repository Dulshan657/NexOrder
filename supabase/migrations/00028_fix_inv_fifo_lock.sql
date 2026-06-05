-- =============================================================================
-- Fix: FIFO row-lock cannot lock the nullable side of the batches LEFT JOIN
-- Migration: 00028_fix_inv_fifo_lock.sql
-- =============================================================================
-- inv_reserve_order and inv_pick_order_line select balance rows with a
-- LEFT JOIN to batches (only to ORDER BY expiry/received for FIFO) and lock
-- them FOR UPDATE. Postgres rejects `FOR UPDATE` over an outer join's nullable
-- side ("FOR UPDATE cannot be applied to the nullable side of an outer join").
-- The lock only needs the inventory_balances rows, so scope it: FOR UPDATE OF b.
--
-- Idempotent CREATE OR REPLACE — on a fresh DB that already ran the corrected
-- 00027 these are no-op replaces. EXECUTE grants from 00027 are preserved
-- across CREATE OR REPLACE, so no re-grant is needed.
-- =============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.inv_reserve_order(
    p_order_id  TEXT,
    p_items     JSONB,
    p_actor     UUID DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_loc       INT := public.inv_default_location();
    v_item      JSONB;
    v_pid       INT;
    v_qty       NUMERIC;
    v_remaining NUMERIC;
    v_take      NUMERIC;
    v_row       RECORD;
BEGIN
    IF v_loc IS NULL THEN
        RAISE EXCEPTION 'NO_WAREHOUSE: no active warehouse configured' USING ERRCODE = 'P0001';
    END IF;

    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
        v_pid := (v_item->>'product_id')::INT;
        v_qty := (v_item->>'quantity')::NUMERIC;
        v_remaining := v_qty;

        FOR v_row IN
            SELECT b.id, b.batch_id, b.available
            FROM public.inventory_balances b
            LEFT JOIN public.batches bt ON bt.id = b.batch_id
            WHERE b.product_id = v_pid AND b.location_id = v_loc AND b.available > 0
            ORDER BY bt.expiry_date NULLS LAST, bt.received_at NULLS FIRST, b.id
            FOR UPDATE OF b
        LOOP
            EXIT WHEN v_remaining <= 0;
            v_take := LEAST(v_remaining, v_row.available);
            PERFORM public.inv_apply_leg(
                v_pid, v_loc, v_row.batch_id, 0, v_take,
                'allocate', p_actor, 'order', p_order_id, NULL);
            v_remaining := v_remaining - v_take;
        END LOOP;

        IF v_remaining > 0 THEN
            RAISE EXCEPTION 'INSUFFICIENT_STOCK: product % short by %', v_pid, v_remaining
                USING ERRCODE = 'P0001';
        END IF;
    END LOOP;
END;
$$;

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

    v_remaining := p_picked_qty;
    FOR v_row IN
        SELECT b.id, b.batch_id, b.allocated, b.on_hand
        FROM public.inventory_balances b
        LEFT JOIN public.batches bt ON bt.id = b.batch_id
        WHERE b.product_id = v_item.product_id AND b.location_id = v_loc AND b.allocated > 0
        ORDER BY bt.expiry_date NULLS LAST, bt.received_at NULLS FIRST, b.id
        FOR UPDATE OF b
    LOOP
        EXIT WHEN v_remaining <= 0;
        v_take := LEAST(v_remaining, v_row.allocated, v_row.on_hand);
        CONTINUE WHEN v_take <= 0;
        PERFORM public.inv_apply_leg(
            v_item.product_id, v_loc, v_row.batch_id, -v_take, -v_take,
            'pick', p_actor, 'order', v_item.order_id, NULL);
        v_last_batch := v_row.batch_id;
        v_remaining := v_remaining - v_take;
    END LOOP;

    IF v_remaining > 0 THEN
        RAISE EXCEPTION 'INSUFFICIENT_ALLOCATED: product % short by % at pick',
            v_item.product_id, v_remaining USING ERRCODE = 'P0001';
    END IF;

    INSERT INTO public.pick_progress
        (order_id, order_item_id, location_id, batch_id, picked_qty, picked_by)
    VALUES
        (v_item.order_id, p_order_item_id, v_loc, v_last_batch, p_picked_qty::INT, p_actor);

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

COMMIT;
