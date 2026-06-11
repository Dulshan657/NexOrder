-- =============================================================================
-- Directed WMS — bin-aware reservation + warehouse resolution
-- Migration: 00040_wms_directed.sql
-- =============================================================================
-- Lets RACKED warehouses participate in order fulfilment. Reservation draws from
-- a warehouse's BINS (and its root, for not-yet-put-away stock) instead of only
-- the warehouse root; allocations land on the specific bin so picking can be
-- directed there. Per-warehouse fulfilment is preserved by resolving any bin
-- back to its root warehouse.
--
-- ADDITIVE & BULK-SAFE: for a BULK warehouse, inv_warehouse_draw_locations
-- returns exactly [warehouse_id], so inv_reserve_order behaves identically to
-- before (allocate at the warehouse root). Only racked warehouses take the new
-- multi-bin path. Idempotent. Apply via the Management API.
-- =============================================================================

BEGIN;

-- ── 1. inv_root_warehouse(loc) — walk up to the WAREHOUSE row ─────────────────
CREATE OR REPLACE FUNCTION public.inv_root_warehouse(p_location_id INT)
RETURNS INT
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
    v_cur    INT := p_location_id;
    v_kind   TEXT;
    v_parent INT;
BEGIN
    FOR i IN 1..16 LOOP
        SELECT kind, parent_id INTO v_kind, v_parent FROM public.locations WHERE id = v_cur;
        IF NOT FOUND THEN RETURN NULL; END IF;
        IF v_kind = 'WAREHOUSE' THEN RETURN v_cur; END IF;
        IF v_parent IS NULL THEN RETURN NULL; END IF;
        v_cur := v_parent;
    END LOOP;
    RETURN NULL;
END;
$$;

-- ── 2. inv_warehouse_draw_locations(wh) — where to draw stock from ────────────
-- bulk  -> [warehouse]; racked -> warehouse root (un-put-away stock) + active bins.
CREATE OR REPLACE FUNCTION public.inv_warehouse_draw_locations(p_warehouse_id INT)
RETURNS TABLE(location_id INT)
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
    v_type TEXT;
    v_path TEXT;
BEGIN
    SELECT location_type, materialized_path INTO v_type, v_path
    FROM public.locations WHERE id = p_warehouse_id;

    IF v_type = 'racked' THEN
        RETURN QUERY
            SELECT p_warehouse_id
            UNION
            SELECT l.id FROM public.locations l
            WHERE l.materialized_path LIKE v_path || '/%' AND l.is_active;
    ELSE
        RETURN QUERY SELECT p_warehouse_id;
    END IF;
END;
$$;

-- ── 3. inv_reserve_order — draw across a warehouse's locations, allocate per-bin
-- Same contract as 00036 (closest-first split, p_allow_partial), but the inner
-- FIFO sweep spans every draw-location of each preferred warehouse and the
-- allocate leg is written at the ACTUAL balance row's location (bin), so racked
-- picks can be directed. For bulk warehouses the draw set is just the warehouse,
-- so behaviour is unchanged.
CREATE OR REPLACE FUNCTION public.inv_reserve_order(
    p_order_id      TEXT,
    p_items         JSONB,
    p_location_pref INT[]   DEFAULT NULL,
    p_actor         UUID    DEFAULT NULL,
    p_allow_partial BOOLEAN DEFAULT false
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_pref      INT[];
    v_item      JSONB;
    v_pid       INT;
    v_qty       NUMERIC;
    v_remaining NUMERIC;
    v_take      NUMERIC;
    v_loc       INT;
    v_row       RECORD;
BEGIN
    v_pref := NULLIF(p_location_pref, '{}');
    IF v_pref IS NULL THEN
        v_pref := ARRAY[public.inv_default_location()];
    END IF;
    IF v_pref IS NULL OR array_length(v_pref, 1) IS NULL OR v_pref[1] IS NULL THEN
        RAISE EXCEPTION 'NO_WAREHOUSE: no active warehouse configured' USING ERRCODE = 'P0001';
    END IF;

    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
        v_pid := (v_item->>'product_id')::INT;
        v_qty := (v_item->>'quantity')::NUMERIC;
        v_remaining := v_qty;

        FOREACH v_loc IN ARRAY v_pref
        LOOP
            EXIT WHEN v_remaining <= 0;
            FOR v_row IN
                SELECT b.id, b.location_id, b.batch_id, b.available
                FROM public.inventory_balances b
                LEFT JOIN public.batches bt ON bt.id = b.batch_id
                WHERE b.product_id = v_pid
                  AND b.location_id IN (SELECT location_id FROM public.inv_warehouse_draw_locations(v_loc))
                  AND b.available > 0
                ORDER BY bt.expiry_date NULLS LAST, bt.received_at NULLS FIRST, b.id
                FOR UPDATE OF b
            LOOP
                EXIT WHEN v_remaining <= 0;
                v_take := LEAST(v_remaining, v_row.available);
                PERFORM public.inv_apply_leg(
                    v_pid, v_row.location_id, v_row.batch_id, 0, v_take,
                    'allocate', p_actor, 'order', p_order_id, NULL);
                v_remaining := v_remaining - v_take;
            END LOOP;
        END LOOP;

        IF v_remaining > 0 AND NOT p_allow_partial THEN
            RAISE EXCEPTION 'INSUFFICIENT_STOCK: product % short by %', v_pid, v_remaining
                USING ERRCODE = 'P0001';
        END IF;
    END LOOP;
END;
$$;

-- ── 4. inv_order_fulfilment_warehouses(order) — distinct root warehouses ──────
CREATE OR REPLACE FUNCTION public.inv_order_fulfilment_warehouses(p_order_id TEXT)
RETURNS TABLE(warehouse_id INT)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
    SELECT DISTINCT public.inv_root_warehouse(m.location_id)
    FROM public.inventory_movements m
    WHERE m.ref_type = 'order' AND m.ref_id = p_order_id AND m.movement_type = 'allocate'
      AND public.inv_root_warehouse(m.location_id) IS NOT NULL;
$$;

-- ── 5. inv_warehouse_pick_complete(order, wh) — fully picked at this site? ─────
-- Compares base units reserved at the warehouse (allocate − deallocate, resolved
-- bin→warehouse) against base units picked there (pick_progress × pack_size).
CREATE OR REPLACE FUNCTION public.inv_warehouse_pick_complete(p_order_id TEXT, p_warehouse_id INT)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN
        SELECT res.product_id, res.reserved, COALESCE(pk.picked, 0) AS picked
        FROM (
            SELECT m.product_id, SUM(m.qty_delta) AS reserved
            FROM public.inventory_movements m
            WHERE m.ref_type = 'order' AND m.ref_id = p_order_id
              AND m.movement_type IN ('allocate', 'deallocate')
              AND public.inv_root_warehouse(m.location_id) = p_warehouse_id
            GROUP BY m.product_id
        ) res
        LEFT JOIN (
            SELECT oi.product_id, SUM(pp.picked_qty * COALESCE(oi.pack_size, 1)) AS picked
            FROM public.pick_progress pp
            JOIN public.order_items oi ON oi.id = pp.order_item_id
            WHERE pp.order_id = p_order_id
              AND public.inv_root_warehouse(pp.location_id) = p_warehouse_id
            GROUP BY oi.product_id
        ) pk ON pk.product_id = res.product_id
    LOOP
        IF r.reserved > 0.000001 AND r.picked < r.reserved - 0.000001 THEN
            RETURN FALSE;
        END IF;
    END LOOP;
    RETURN TRUE;
END;
$$;

-- ── 6. Grants — reserve stays service_role; resolution helpers readable by ops
REVOKE ALL ON FUNCTION public.inv_reserve_order(TEXT,JSONB,INT[],UUID,BOOLEAN) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.inv_reserve_order(TEXT,JSONB,INT[],UUID,BOOLEAN) TO service_role;
GRANT EXECUTE ON FUNCTION public.inv_warehouse_draw_locations(INT) TO service_role;
GRANT EXECUTE ON FUNCTION public.inv_root_warehouse(INT) TO service_role, authenticated;
GRANT EXECUTE ON FUNCTION public.inv_order_fulfilment_warehouses(TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.inv_warehouse_pick_complete(TEXT,INT) TO service_role;

COMMIT;

-- Verify (bulk regression — should reserve at MAIN exactly as before):
--   SELECT public.inv_reserve_order('ORD-T', '[{"product_id":1,"quantity":3}]', ARRAY[public.inv_default_location()]);
--   SELECT public.inv_root_warehouse(public.inv_default_location()); -- = itself
