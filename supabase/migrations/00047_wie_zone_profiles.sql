-- =============================================================================
-- Warehouse Intelligence Engine — zone semantics (Phase 2)
-- Migration: 00047_wie_zone_profiles.sql
-- =============================================================================
-- Turns ZONE locations into first-class operational concepts. A zone_profile
-- carries the zone's TYPE (fast/slow/cold/hazardous/…), a priority weight the
-- optimizer prefers toward, an optional allowed-category allow-list (a hard
-- compatibility gate), and a soft max-utilization target. A ZONE location points
-- at a profile via locations.zone_profile_id; bins inherit their zone's profile
-- through the materialized-path ancestry the candidate loader already walks.
--
-- Additive & safe: profiles are optional (a ZONE with none behaves as before),
-- eight standard profiles are seeded as global rows, and wie_putaway_candidates
-- is extended (CREATE OR REPLACE) with the new columns appended. Idempotent.
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.zone_profiles (
    id                  SERIAL PRIMARY KEY,
    name                TEXT NOT NULL,
    zone_type           TEXT NOT NULL CHECK (zone_type IN (
                            'fast_moving','slow_moving','hazardous','cold',
                            'bulk','returns','quarantine','overflow')),
    /** Higher = the optimizer prefers this zone (0..1). */
    priority_weight     NUMERIC(4,3) NOT NULL DEFAULT 0.5,
    /** NULL = any category allowed; otherwise a hard allow-list of product categories. */
    allowed_categories  JSONB,
    /** Soft fill-fraction target (0..1); reserved for the Phase-4 congestion/
     *  utilization scoring pass. Carried through the engine but not yet applied. */
    max_utilization_pct NUMERIC(4,3),
    is_active           BOOLEAN NOT NULL DEFAULT true,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_zone_profiles_name_type ON public.zone_profiles(name, zone_type);

ALTER TABLE public.locations
    ADD COLUMN IF NOT EXISTS zone_profile_id INT REFERENCES public.zone_profiles(id) ON DELETE SET NULL;

-- Standard global profiles (idempotent seed keyed on the natural (name,zone_type)).
INSERT INTO public.zone_profiles (name, zone_type, priority_weight)
SELECT * FROM (VALUES
    ('Fast Moving',  'fast_moving', 1.000),
    ('Cold Storage', 'cold',        0.700),
    ('Bulk Storage', 'bulk',        0.650),
    ('Hazardous',    'hazardous',   0.550),
    ('Slow Moving',  'slow_moving', 0.450),
    ('Overflow',     'overflow',    0.350),
    ('Returns',      'returns',     0.200),
    ('Quarantine',   'quarantine',  0.100)
) AS v(name, zone_type, priority_weight)
WHERE NOT EXISTS (
    SELECT 1 FROM public.zone_profiles z WHERE z.name = v.name AND z.zone_type = v.zone_type
);

-- ── Extend the candidate loader with the bin's zone profile ──────────────────
-- 00045 already created this function; CREATE OR REPLACE cannot change a return
-- type, so drop it first (only the recommend-putaway edge fn calls it, via rpc).
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
    zone_max_utilization_pct NUMERIC
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
        zp.max_utilization_pct
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
    LEFT JOIN same_prod      sp  ON sp.location_id = p.location_id
    WHERE p.layout_id = p_layout_id AND l.is_active
    ORDER BY ndd.dist NULLS LAST, p.location_id
    LIMIT p_limit;
$$;

REVOKE ALL ON FUNCTION public.wie_putaway_candidates(INT,INT,INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wie_putaway_candidates(INT,INT,INT) TO service_role;

-- RLS: read-only for ops; profiles are seeded/managed via service role.
ALTER TABLE public.zone_profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "zone_profiles_select_ops" ON public.zone_profiles;
CREATE POLICY "zone_profiles_select_ops" ON public.zone_profiles FOR SELECT TO authenticated
    USING ((SELECT public.user_role()) IN ('Admin','Manager','Warehouse'));
GRANT SELECT ON public.zone_profiles TO authenticated;

COMMIT;

-- Verify:
--   SELECT zone_type, priority_weight FROM public.zone_profiles ORDER BY priority_weight DESC;
--   SELECT * FROM public.wie_putaway_candidates(1, 1, 5);
