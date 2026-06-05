-- =============================================================================
-- inv_reserve_order: add p_allow_partial for inbound-PO approval
-- Migration: 00030_inv_reserve_allow_partial.sql
-- =============================================================================
-- Web orders (place-order) reserve all-or-nothing: a short line must fail so the
-- customer never places an unfulfillable order. Inbound POs (approve-po, human
-- mode) may knowingly be approved while short — there we reserve what's
-- available and backorder the rest so the pick flow can still draw the on-hand
-- portion (inv_pick_order_line needs allocated > 0).
--
-- Adding a parameter changes the function's identity, so DROP the old 3-arg
-- version and CREATE the 4-arg one (a bare CREATE OR REPLACE would leave both
-- and make PostgREST overload resolution ambiguous). place-order calls it with
-- named args {p_order_id, p_items, p_actor}; p_allow_partial defaults to false,
-- so that call keeps its strict all-or-nothing behavior.
-- =============================================================================

BEGIN;

DROP FUNCTION IF EXISTS public.inv_reserve_order(TEXT, JSONB, UUID);

CREATE OR REPLACE FUNCTION public.inv_reserve_order(
    p_order_id      TEXT,
    p_items         JSONB,
    p_actor         UUID DEFAULT NULL,
    p_allow_partial BOOLEAN DEFAULT false
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

        IF v_remaining > 0 AND NOT p_allow_partial THEN
            RAISE EXCEPTION 'INSUFFICIENT_STOCK: product % short by %', v_pid, v_remaining
                USING ERRCODE = 'P0001';
        END IF;
    END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.inv_reserve_order(TEXT,JSONB,UUID,BOOLEAN) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.inv_reserve_order(TEXT,JSONB,UUID,BOOLEAN) TO service_role;

COMMIT;
