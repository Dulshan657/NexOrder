-- =============================================================================
-- Warehouse Intelligence Engine — pick-stop order_item fan-out fix (Phase 5)
-- Migration: 00051_wie_pick_stops_dedupe.sql
-- =============================================================================
-- 00050's wie_order_pick_stops joined order_items on (order_id, product_id), but a
-- product can legitimately appear on TWO order lines in one order (a unit line and
-- a carton line — place-order aggregates the cart by product+pack_size). That
-- fanned each netted (product, bin) allocation into duplicate stops with inflated
-- qty. Allocation is per-PRODUCT (not per line), so a single order_item_id is
-- inherently ambiguous; take one deterministically via a LATERAL LIMIT 1 so each
-- (product, bin) yields exactly one stop. CREATE OR REPLACE (same return type).
-- Idempotent.
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
    LEFT JOIN LATERAL (
        SELECT oi.id FROM public.order_items oi
        WHERE oi.order_id = p_order_id AND oi.product_id = a.product_id
        ORDER BY oi.id
        LIMIT 1
    ) oi ON true
$$;

REVOKE ALL ON FUNCTION public.wie_order_pick_stops(TEXT,INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wie_order_pick_stops(TEXT,INT) TO service_role;

COMMIT;

-- Verify: a product on 2 order lines must yield ONE stop per bin (not two):
--   SELECT location_id, count(*) FROM public.wie_order_pick_stops('<order>', <wh>) GROUP BY 1;
