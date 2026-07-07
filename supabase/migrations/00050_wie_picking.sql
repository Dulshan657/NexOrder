-- =============================================================================
-- Warehouse Intelligence Engine — pick-route stop loader (Phase 5)
-- Migration: 00050_wie_picking.sql
-- =============================================================================
-- The one query the picking layer needs and that didn't exist: an order's
-- ALLOCATED bins at a given warehouse. Allocation-to-bin lives only implicitly in
-- inventory_movements (allocate/deallocate legs written at the actual bin by
-- inv_reserve_order, mig 00040). This function nets those legs per (product, bin),
-- resolves each bin to the warehouse's active-layout graph node, and returns the
-- stops the engine's picking.ts sequences into a shortest walk.
--
-- Read-only, additive, service-role only. Idempotent.
-- =============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.wie_order_pick_stops(
    p_order_id     TEXT,
    p_warehouse_id INT
)
RETURNS TABLE(
    order_item_id   INT,
    product_id      INT,
    location_id     INT,
    code            TEXT,
    graph_node_id   INT,
    access_offset_m NUMERIC,
    qty_base        NUMERIC
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
    WITH v_layout AS (
        SELECT active_layout_id FROM public.locations WHERE id = p_warehouse_id
    ),
    alloc AS (
        SELECT m.product_id, m.location_id, SUM(m.qty_delta) AS qty_base
        FROM public.inventory_movements m
        WHERE m.ref_type = 'order' AND m.ref_id = p_order_id
          AND m.movement_type IN ('allocate', 'deallocate')
          AND public.inv_root_warehouse(m.location_id) = p_warehouse_id
        GROUP BY m.product_id, m.location_id
        HAVING SUM(m.qty_delta) > 0
    )
    SELECT
        oi.id,
        a.product_id,
        a.location_id,
        l.code,
        pl.graph_node_id,
        COALESCE(pl.access_offset_m, 0),
        a.qty_base
    FROM alloc a
    JOIN public.locations l ON l.id = a.location_id
    LEFT JOIN public.layout_placements pl
        ON pl.location_id = a.location_id
       AND pl.layout_id = (SELECT active_layout_id FROM v_layout)
    LEFT JOIN public.order_items oi
        ON oi.order_id = p_order_id AND oi.product_id = a.product_id
$$;

REVOKE ALL ON FUNCTION public.wie_order_pick_stops(TEXT,INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wie_order_pick_stops(TEXT,INT) TO service_role;

COMMIT;

-- Verify:
--   SELECT * FROM public.wie_order_pick_stops('SOME-ORDER-ID', <warehouse_id>);
