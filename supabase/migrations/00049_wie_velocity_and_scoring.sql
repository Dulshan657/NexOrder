-- =============================================================================
-- Warehouse Intelligence Engine — velocity, congestion, weights, re-slotting (Phase 4)
-- Migration: 00049_wie_velocity_and_scoring.sql
-- =============================================================================
-- Demand-aware slotting inputs + per-warehouse tuning + overnight re-slotting:
--   * wie_product_velocity   — pick frequency + ABC class per (warehouse, product)
--   * wie_location_traffic   — pick visits per graph node (congestion signal)
--   * wie_scoring_profiles   — per-warehouse factor weights (override defaults)
--   * wie_slotting_suggestions — reviewed re-slotting recommendations (never auto-moves)
--   * wie_refresh_velocity() / wie_refresh_location_traffic() — nightly rollups
-- and extends wie_putaway_candidates with each bin's pick_visits_30d (congestion).
--
-- Additive & safe: all new tables, the candidate loader is DROPped + recreated
-- (return-type change), refreshes are idempotent recomputes, nothing touches the
-- inv_* mutation path. Idempotent; apply via the Management API.
-- =============================================================================

BEGIN;

-- ── 1. wie_product_velocity ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.wie_product_velocity (
    warehouse_id   INT NOT NULL REFERENCES public.locations(id) ON DELETE CASCADE,
    product_id     INT NOT NULL REFERENCES public.products(id)  ON DELETE CASCADE,
    picks_7d       INT NOT NULL DEFAULT 0,
    picks_30d      INT NOT NULL DEFAULT 0,
    picks_90d      INT NOT NULL DEFAULT 0,
    qty_30d        NUMERIC(16,3) NOT NULL DEFAULT 0,
    velocity_class TEXT CHECK (velocity_class IN ('A','B','C')),
    computed_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (warehouse_id, product_id)
);

-- ── 2. wie_location_traffic ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.wie_location_traffic (
    layout_id       INT NOT NULL REFERENCES public.warehouse_layouts(id) ON DELETE CASCADE,
    graph_node_id   INT NOT NULL REFERENCES public.layout_graph_nodes(id) ON DELETE CASCADE,
    pick_visits_30d INT NOT NULL DEFAULT 0,
    computed_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (layout_id, graph_node_id)
);

-- ── 3. wie_scoring_profiles — per-warehouse factor weights ───────────────────
CREATE TABLE IF NOT EXISTS public.wie_scoring_profiles (
    warehouse_id INT PRIMARY KEY REFERENCES public.locations(id) ON DELETE CASCADE,
    weights      JSONB NOT NULL,   -- {travelDistance,capacityFit,grouping,zonePreference,congestion,velocityMatch}
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by   UUID REFERENCES public.profiles(id)
);

-- ── 4. wie_slotting_suggestions — reviewed re-slotting recommendations ───────
CREATE TABLE IF NOT EXISTS public.wie_slotting_suggestions (
    id               BIGSERIAL PRIMARY KEY,
    warehouse_id     INT NOT NULL REFERENCES public.locations(id) ON DELETE CASCADE,
    product_id       INT NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
    from_location_id INT NOT NULL REFERENCES public.locations(id),
    to_location_id   INT NOT NULL REFERENCES public.locations(id),
    qty              NUMERIC(14,3) NOT NULL,
    expected_gain_m  NUMERIC(12,2) NOT NULL DEFAULT 0,
    reason           JSONB NOT NULL DEFAULT '{}',
    status           TEXT NOT NULL DEFAULT 'suggested'
                         CHECK (status IN ('suggested','accepted','rejected','expired')),
    actor_id         UUID REFERENCES public.profiles(id),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    decided_at       TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_wie_slotting_suggestions_wh
    ON public.wie_slotting_suggestions(warehouse_id, status, created_at DESC);
-- At most one open suggestion per (warehouse, product, from, to) to avoid dupes.
CREATE UNIQUE INDEX IF NOT EXISTS uq_wie_slotting_open
    ON public.wie_slotting_suggestions(warehouse_id, product_id, from_location_id, to_location_id)
    WHERE status = 'suggested';

-- ── 5. wie_refresh_velocity() — rebuild pick-frequency + ABC class ───────────
-- Picks are resolved to their root warehouse (inv_root_warehouse) and grouped by
-- product. ABC class is assigned per warehouse by 30-day pick share: top 20% by
-- picks_30d = A, next 30% = B, remainder (and zero-pick) = C.
CREATE OR REPLACE FUNCTION public.wie_refresh_velocity()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    TRUNCATE public.wie_product_velocity;
    INSERT INTO public.wie_product_velocity
        (warehouse_id, product_id, picks_7d, picks_30d, picks_90d, qty_30d, velocity_class, computed_at)
    WITH picks AS (
        SELECT public.inv_root_warehouse(m.location_id) AS warehouse_id,
               m.product_id,
               m.created_at,
               ABS(m.qty_delta) AS qty
        FROM public.inventory_movements m
        WHERE m.movement_type = 'pick'
          AND public.inv_root_warehouse(m.location_id) IS NOT NULL
          AND m.created_at >= now() - INTERVAL '90 days'
    ),
    agg AS (
        SELECT warehouse_id, product_id,
               COUNT(*) FILTER (WHERE created_at >= now() - INTERVAL '7 days')  AS picks_7d,
               COUNT(*) FILTER (WHERE created_at >= now() - INTERVAL '30 days') AS picks_30d,
               COUNT(*)                                                          AS picks_90d,
               COALESCE(SUM(qty) FILTER (WHERE created_at >= now() - INTERVAL '30 days'), 0) AS qty_30d
        FROM picks
        GROUP BY warehouse_id, product_id
    ),
    ranked AS (
        SELECT *,
               PERCENT_RANK() OVER (PARTITION BY warehouse_id ORDER BY picks_30d DESC) AS pr
        FROM agg
    )
    SELECT warehouse_id, product_id, picks_7d, picks_30d, picks_90d, qty_30d,
           CASE WHEN picks_30d = 0 THEN 'C'
                WHEN pr <= 0.2 THEN 'A'
                WHEN pr <= 0.5 THEN 'B'
                ELSE 'C' END AS velocity_class,
           now()
    FROM ranked;
END;
$$;

-- ── 6. wie_refresh_location_traffic() — pick visits per graph node ───────────
-- Counts 30-day pick movements landing in a bin, mapped to the bin's snapped
-- graph node in the warehouse's ACTIVE layout.
CREATE OR REPLACE FUNCTION public.wie_refresh_location_traffic()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    TRUNCATE public.wie_location_traffic;
    INSERT INTO public.wie_location_traffic (layout_id, graph_node_id, pick_visits_30d, computed_at)
    SELECT pl.layout_id, pl.graph_node_id, COUNT(*), now()
    FROM public.inventory_movements m
    JOIN public.locations wh_root ON wh_root.id = public.inv_root_warehouse(m.location_id)
    JOIN public.layout_placements pl
      ON pl.location_id = m.location_id
     AND pl.layout_id = wh_root.active_layout_id
     AND pl.graph_node_id IS NOT NULL
    WHERE m.movement_type = 'pick'
      AND m.created_at >= now() - INTERVAL '30 days'
    GROUP BY pl.layout_id, pl.graph_node_id;
END;
$$;

REVOKE ALL ON FUNCTION public.wie_refresh_velocity()          FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.wie_refresh_location_traffic()  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wie_refresh_velocity()         TO service_role;
GRANT EXECUTE ON FUNCTION public.wie_refresh_location_traffic() TO service_role;

-- ── 7. Nightly cron (pg_cron in use since mig 00020/00026) ───────────────────
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
        PERFORM cron.unschedule('wie_refresh_velocity')          WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'wie_refresh_velocity');
        PERFORM cron.unschedule('wie_refresh_location_traffic')  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'wie_refresh_location_traffic');
        PERFORM cron.schedule('wie_refresh_velocity',         '15 2 * * *', 'SELECT public.wie_refresh_velocity()');
        PERFORM cron.schedule('wie_refresh_location_traffic', '20 2 * * *', 'SELECT public.wie_refresh_location_traffic()');
    END IF;
END $$;

-- ── 8. Extend the candidate loader with per-bin congestion (pick visits) ─────
DROP FUNCTION IF EXISTS public.wie_putaway_candidates(INT,INT,INT);
CREATE OR REPLACE FUNCTION public.wie_putaway_candidates(
    p_layout_id  INT,
    p_product_id INT,
    p_limit      INT DEFAULT 200
)
RETURNS TABLE(
    location_id              INT,
    code                     TEXT,
    zone_id                  INT,
    zone_tag                 TEXT,
    capacity_slots           NUMERIC,
    used_slots               NUMERIC,
    graph_node_id            INT,
    access_offset_m          NUMERIC,
    has_same_product         BOOLEAN,
    distance_from_dock_m     NUMERIC,
    zone_type                TEXT,
    zone_priority_weight     NUMERIC,
    zone_allowed_categories  JSONB,
    zone_max_utilization_pct NUMERIC,
    bin_categories           JSONB,
    pick_visits_30d          INT
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
    WITH dock_nodes AS (
        SELECT id FROM public.layout_graph_nodes
        WHERE layout_id = p_layout_id AND node_type = 'dock'
    ),
    node_dock_dist AS (
        SELECT to_node_id AS node_id, MIN(distance_m) AS dist
        FROM public.layout_travel_distances
        WHERE layout_id = p_layout_id AND from_node_id IN (SELECT id FROM dock_nodes)
        GROUP BY to_node_id
    ),
    bin_fill AS (
        SELECT b.location_id, SUM(b.on_hand * COALESCE(pr.size_factor, 1)) AS used_slots
        FROM public.inventory_balances b
        JOIN public.products pr ON pr.id = b.product_id
        WHERE b.on_hand > 0
        GROUP BY b.location_id
    ),
    bin_cats AS (
        SELECT b.location_id, jsonb_agg(DISTINCT pr.category) AS cats
        FROM public.inventory_balances b
        JOIN public.products pr ON pr.id = b.product_id
        WHERE b.on_hand > 0
        GROUP BY b.location_id
    ),
    same_prod AS (
        SELECT DISTINCT location_id FROM public.inventory_balances
        WHERE product_id = p_product_id AND on_hand > 0
    )
    SELECT
        p.location_id,
        l.code,
        zone.id,
        lower(zone.name),
        l.capacity_slots,
        COALESCE(bf.used_slots, 0),
        p.graph_node_id,
        COALESCE(p.access_offset_m, 0),
        (sp.location_id IS NOT NULL),
        ndd.dist,
        zp.zone_type,
        zp.priority_weight,
        zp.allowed_categories,
        zp.max_utilization_pct,
        COALESCE(bc.cats, '[]'::jsonb),
        COALESCE(tr.pick_visits_30d, 0)
    FROM public.layout_placements p
    JOIN public.locations l ON l.id = p.location_id
    LEFT JOIN LATERAL (
        SELECT z.id, z.name, z.zone_profile_id FROM public.locations z
        WHERE z.kind = 'ZONE' AND l.materialized_path LIKE z.materialized_path || '/%'
        ORDER BY length(z.materialized_path) DESC
        LIMIT 1
    ) zone ON true
    LEFT JOIN public.zone_profiles zp ON zp.id = zone.zone_profile_id
    LEFT JOIN node_dock_dist ndd ON ndd.node_id = p.graph_node_id
    LEFT JOIN bin_fill       bf  ON bf.location_id = p.location_id
    LEFT JOIN bin_cats       bc  ON bc.location_id = p.location_id
    LEFT JOIN same_prod      sp  ON sp.location_id = p.location_id
    LEFT JOIN public.wie_location_traffic tr ON tr.layout_id = p.layout_id AND tr.graph_node_id = p.graph_node_id
    WHERE p.layout_id = p_layout_id AND l.is_active
    ORDER BY ndd.dist NULLS LAST, p.location_id
    LIMIT p_limit;
$$;

REVOKE ALL ON FUNCTION public.wie_putaway_candidates(INT,INT,INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wie_putaway_candidates(INT,INT,INT) TO service_role;

-- ── 9. RLS — read-only for ops; writes service-role only ─────────────────────
DO $$
DECLARE v_table TEXT;
BEGIN
    FOREACH v_table IN ARRAY ARRAY['wie_product_velocity','wie_location_traffic','wie_scoring_profiles','wie_slotting_suggestions']
    LOOP
        EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', v_table);
        EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', v_table || '_select_ops', v_table);
        EXECUTE format(
            'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated '
            || 'USING ((SELECT public.user_role()) IN (''Admin'',''Manager'',''Warehouse''))',
            v_table || '_select_ops', v_table);
        EXECUTE format('GRANT SELECT ON public.%I TO authenticated', v_table);
    END LOOP;
END $$;

COMMIT;

-- Verify:
--   SELECT public.wie_refresh_velocity(); SELECT public.wie_refresh_location_traffic();
--   SELECT velocity_class, count(*) FROM wie_product_velocity GROUP BY 1;
--   SELECT pick_visits_30d FROM public.wie_putaway_candidates(1, 1, 3);
