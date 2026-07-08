-- =============================================================================
-- Directed Picking — tie the pick to the recorded bin (P2)
-- Migration: 00064_wie_pick_tasks.sql
-- =============================================================================
-- ONBOARDING-AUDIT.md: picking is advisory, not directed — the WIE route, the
-- pick-panel suggestion, and the pick slip each computed "where to pick"
-- independently and could disagree. This migration extracts the ONE netting
-- query all three should share.
--
-- wie_order_alloc_bins(order) — the `alloc` CTE from 00050/00051, minus the
-- per-warehouse filter, walked to warehouse_id via inv_root_warehouse and
-- joined to that bin's warehouse's active layout (NULL for bulk/no layout).
-- This is now the single source of truth for "what did this order allocate,
-- and where".
--
-- wie_order_pick_stops(order, warehouse) is CREATE OR REPLACE'd to select from
-- wie_order_alloc_bins filtered to p_warehouse_id, with the SAME order_item
-- fan-out fix as 00051 (LATERAL LIMIT 1). Signature and return type are
-- UNCHANGED, so recommend-pick-route and its route behavior are untouched —
-- this is a pure refactor of its data source. (Regression-check: results for a
-- seeded order must be byte-identical pre/post this migration; see -- Verify:.)
--
-- wie_order_pick_tasks(order) — the raw per-bin rows the new order-pick-tasks
-- Edge Function's pure TS helper (_shared/wie/pickTasks.ts) needs to build
-- per-bin pick tasks: adds warehouse_code, drops the order_item join (a
-- product's allocation spans possibly-several order_items with different
-- pack_size — that attribution split belongs in TS, not SQL). The Edge
-- Function loads this order's order_items and pick_progress with plain
-- companion selects.
--
-- Read-only, additive, service-role only. Idempotent (CREATE OR REPLACE).
-- Apply via the Management API (see CLAUDE.md); do not run interactively.
-- =============================================================================

BEGIN;

-- ── 1. wie_order_alloc_bins(order) — shared allocation netting ────────────────
CREATE OR REPLACE FUNCTION public.wie_order_alloc_bins(p_order_id TEXT)
RETURNS TABLE(
    product_id      INT,
    warehouse_id    INT,
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
    WITH alloc AS (
        SELECT
            m.product_id,
            m.location_id,
            public.inv_root_warehouse(m.location_id) AS warehouse_id,
            SUM(m.qty_delta) AS qty_base
        FROM public.inventory_movements m
        WHERE m.ref_type = 'order' AND m.ref_id = p_order_id
          AND m.movement_type IN ('allocate', 'deallocate')
        GROUP BY m.product_id, m.location_id
        HAVING SUM(m.qty_delta) > 0
    )
    SELECT
        a.product_id,
        a.warehouse_id,
        a.location_id,
        l.code,
        pl.graph_node_id,
        COALESCE(pl.access_offset_m, 0),
        a.qty_base
    FROM alloc a
    JOIN public.locations l ON l.id = a.location_id
    LEFT JOIN public.locations wh ON wh.id = a.warehouse_id
    LEFT JOIN public.layout_placements pl
        ON pl.location_id = a.location_id
       AND pl.layout_id = wh.active_layout_id
    WHERE a.warehouse_id IS NOT NULL
$$;

-- ── 2. wie_order_pick_stops(order, warehouse) — CREATE OR REPLACE, same shape ─
-- Same signature/return type as 00050/00051; now sourced from
-- wie_order_alloc_bins so the route, the panel tasks, and the pick slip all
-- read the same netting.
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
    SELECT
        oi.id,
        a.product_id,
        a.location_id,
        a.code,
        a.graph_node_id,
        a.access_offset_m,
        a.qty_base
    FROM public.wie_order_alloc_bins(p_order_id) a
    LEFT JOIN LATERAL (
        SELECT oi.id FROM public.order_items oi
        WHERE oi.order_id = p_order_id AND oi.product_id = a.product_id
        ORDER BY oi.id
        LIMIT 1
    ) oi ON true
    WHERE a.warehouse_id = p_warehouse_id
$$;

-- ── 3. wie_order_pick_tasks(order) — raw rows for the TS pick-task builder ────
-- product/warehouse/bin allocation, unattributed to any one order_item (a
-- product can span multiple lines with different pack_size — that split is
-- done in _shared/wie/pickTasks.ts, not here).
CREATE OR REPLACE FUNCTION public.wie_order_pick_tasks(p_order_id TEXT)
RETURNS TABLE(
    product_id      INT,
    warehouse_id    INT,
    warehouse_code  TEXT,
    location_id     INT,
    code            TEXT,
    graph_node_id   INT,
    qty_base        NUMERIC
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
    SELECT
        a.product_id,
        a.warehouse_id,
        wh.code,
        a.location_id,
        a.code,
        a.graph_node_id,
        a.qty_base
    FROM public.wie_order_alloc_bins(p_order_id) a
    JOIN public.locations wh ON wh.id = a.warehouse_id
$$;

-- ── 4. Grants — service_role only (Edge Functions call these, never the client)
REVOKE ALL ON FUNCTION public.wie_order_alloc_bins(TEXT)     FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.wie_order_pick_stops(TEXT,INT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.wie_order_pick_tasks(TEXT)     FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.wie_order_alloc_bins(TEXT)     TO service_role;
GRANT EXECUTE ON FUNCTION public.wie_order_pick_stops(TEXT,INT) TO service_role;
GRANT EXECUTE ON FUNCTION public.wie_order_pick_tasks(TEXT)     TO service_role;

COMMIT;

-- Verify:
--   -- Raw allocation netting for an order (all warehouses):
--   SELECT * FROM public.wie_order_alloc_bins('<order-id>');
--
--   -- Regression: wie_order_pick_stops must be byte-identical pre/post this
--   -- migration for the same (order, warehouse) — diff the two result sets:
--   SELECT * FROM public.wie_order_pick_stops('<order-id>', <warehouse_id>)
--   ORDER BY location_id;
--
--   -- Raw rows for the pick-task builder:
--   SELECT * FROM public.wie_order_pick_tasks('<order-id>');
--
--   -- A product on 2 order lines still yields ONE bin row (not two):
--   SELECT location_id, count(*) FROM public.wie_order_pick_tasks('<order-id>') GROUP BY 1;
