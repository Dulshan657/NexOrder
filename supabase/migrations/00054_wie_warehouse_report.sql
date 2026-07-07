-- =============================================================================
-- Warehouse Intelligence Engine — reporting rollup (Phase 7)
-- Migration: 00054_wie_warehouse_report.sql
-- =============================================================================
-- One read that powers the WIE analytics dashboard: putaway acceptance, slotting
-- suggestion status, ABC velocity mix, current space utilization, top congested
-- nodes, empty/placed bin counts, and the latest simulation, for a warehouse.
-- STABLE (runs with the caller's rights) so the existing ops SELECT policies on
-- the WIE + inventory tables apply; granted to authenticated. Additive & idempotent.
-- =============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.wie_warehouse_report(p_warehouse_id INT)
RETURNS JSONB
LANGUAGE sql
STABLE
SET search_path = public
AS $$
    WITH v_layout AS (
        SELECT active_layout_id FROM public.locations WHERE id = p_warehouse_id
    ),
    placed_bins AS (
        SELECT l.id AS location_id, l.capacity_slots
        FROM public.layout_placements pl
        JOIN public.locations l ON l.id = pl.location_id
        WHERE pl.layout_id = (SELECT active_layout_id FROM v_layout) AND l.is_active
    ),
    bin_fill AS (
        SELECT b.location_id, SUM(b.on_hand * COALESCE(pr.size_factor, 1)) AS used_slots
        FROM public.inventory_balances b
        JOIN public.products pr ON pr.id = b.product_id
        WHERE b.on_hand > 0 AND b.location_id IN (SELECT location_id FROM placed_bins)
        GROUP BY b.location_id
    )
    SELECT jsonb_build_object(
        'putaway', COALESCE((
            SELECT jsonb_object_agg(status, cnt) FROM (
                SELECT status, COUNT(*) cnt FROM public.wie_putaway_recommendations
                WHERE warehouse_id = p_warehouse_id AND created_at >= now() - INTERVAL '30 days'
                GROUP BY status
            ) s
        ), '{}'::jsonb),
        'slotting', COALESCE((
            SELECT jsonb_object_agg(status, cnt) FROM (
                SELECT status, COUNT(*) cnt FROM public.wie_slotting_suggestions
                WHERE warehouse_id = p_warehouse_id GROUP BY status
            ) s
        ), '{}'::jsonb),
        'velocity', COALESCE((
            SELECT jsonb_object_agg(COALESCE(velocity_class, 'C'), cnt) FROM (
                SELECT velocity_class, COUNT(*) cnt FROM public.wie_product_velocity
                WHERE warehouse_id = p_warehouse_id GROUP BY velocity_class
            ) v
        ), '{}'::jsonb),
        'binCount', (SELECT COUNT(*) FROM placed_bins),
        'emptyBins', (SELECT COUNT(*) FROM placed_bins pb WHERE NOT EXISTS (
            SELECT 1 FROM bin_fill bf WHERE bf.location_id = pb.location_id)),
        'utilizationPct', (
            SELECT CASE WHEN SUM(pb.capacity_slots) > 0
                        THEN ROUND(LEAST(SUM(COALESCE(bf.used_slots, 0)), SUM(pb.capacity_slots)) / SUM(pb.capacity_slots), 4)
                        ELSE NULL END
            FROM placed_bins pb LEFT JOIN bin_fill bf ON bf.location_id = pb.location_id
            WHERE pb.capacity_slots IS NOT NULL
        ),
        'congestion', COALESCE((
            SELECT jsonb_agg(jsonb_build_object('node', graph_node_id, 'visits', pick_visits_30d))
            FROM (
                SELECT graph_node_id, pick_visits_30d FROM public.wie_location_traffic
                WHERE layout_id = (SELECT active_layout_id FROM v_layout)
                ORDER BY pick_visits_30d DESC LIMIT 10
            ) c
        ), '[]'::jsonb),
        'latestSimulation', (
            SELECT jsonb_build_object('id', id, 'kpis', kpis, 'diff', diff, 'params', params, 'createdAt', created_at)
            FROM public.wie_simulations WHERE warehouse_id = p_warehouse_id
            ORDER BY created_at DESC LIMIT 1
        )
    );
$$;

REVOKE ALL ON FUNCTION public.wie_warehouse_report(INT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.wie_warehouse_report(INT) TO authenticated, service_role;

COMMIT;

-- Verify:
--   SELECT public.wie_warehouse_report(<warehouse_id>);
