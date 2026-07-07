-- =============================================================================
-- Warehouse Intelligence Engine — SKU attributes + category compatibility (Phase 3)
-- Migration: 00048_wie_sku_attributes.sql
-- =============================================================================
-- Gives the optimizer real product intelligence (hazard/temp/shelf-life/handling)
-- and a global category-compatibility matrix used as an implicit hard/soft gate
-- during candidate filtering — a bin is rejected (forbidden) or penalized
-- (restricted) when the incoming SKU's category conflicts with a category already
-- stored in the bin. The candidate loader is extended to return each bin's current
-- occupant categories so the engine can evaluate the matrix.
--
-- Additive & safe: attributes and the matrix are optional (empty ⇒ no gating), the
-- product attributes live in their own table (products' shared adapter untouched),
-- and wie_putaway_candidates is DROPped + recreated (return-type change). Backward
-- compatible with the deployed recommend-putaway (it reads a subset of columns).
-- Idempotent.
-- =============================================================================

BEGIN;

-- ── 1. product_wms_attributes — per-SKU physical/handling attributes ─────────
CREATE TABLE IF NOT EXISTS public.product_wms_attributes (
    product_id        INT PRIMARY KEY REFERENCES public.products(id) ON DELETE CASCADE,
    hazard_class      TEXT,
    temp_min          NUMERIC(6,2),
    temp_max          NUMERIC(6,2),
    shelf_life_policy TEXT CHECK (shelf_life_policy IN ('FEFO','FIFO')),
    stackable         BOOLEAN,
    handling_type     TEXT,
    weight_kg         NUMERIC(10,3),
    volume_l          NUMERIC(10,3),
    dims              JSONB,
    custom            JSONB NOT NULL DEFAULT '{}',
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── 2. category_compatibility — normalized (a<=b) global matrix ──────────────
CREATE TABLE IF NOT EXISTS public.category_compatibility (
    category_a TEXT NOT NULL,
    category_b TEXT NOT NULL,
    level      TEXT NOT NULL CHECK (level IN ('forbidden','restricted','allowed')),
    note       TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (category_a, category_b),
    -- Byte-order (COLLATE "C") so the CHECK matches the edge fn's JS normalization
    -- (UTF-16 code-unit order); a linguistic collation would disagree on mixed case.
    CONSTRAINT category_compatibility_normalized CHECK ((category_a COLLATE "C") <= (category_b COLLATE "C"))
);
-- Seeded empty: with no rows every pairing defaults to 'allowed', so nothing is
-- blocked until an admin adds forbidden/restricted pairs.

-- ── 3. Extend the candidate loader with the bin's occupant categories ────────
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
    bin_categories           JSONB
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
        COALESCE(bc.cats, '[]'::jsonb)
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
    WHERE p.layout_id = p_layout_id AND l.is_active
    ORDER BY ndd.dist NULLS LAST, p.location_id
    LIMIT p_limit;
$$;

REVOKE ALL ON FUNCTION public.wie_putaway_candidates(INT,INT,INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wie_putaway_candidates(INT,INT,INT) TO service_role;

-- ── 4. RLS — read-only for ops; writes via edge functions ────────────────────
ALTER TABLE public.product_wms_attributes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.category_compatibility ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "product_wms_attributes_select_ops" ON public.product_wms_attributes;
CREATE POLICY "product_wms_attributes_select_ops" ON public.product_wms_attributes FOR SELECT TO authenticated
    USING ((SELECT public.user_role()) IN ('Admin','Manager','Warehouse'));
DROP POLICY IF EXISTS "category_compatibility_select_ops" ON public.category_compatibility;
CREATE POLICY "category_compatibility_select_ops" ON public.category_compatibility FOR SELECT TO authenticated
    USING ((SELECT public.user_role()) IN ('Admin','Manager','Warehouse'));

GRANT SELECT ON public.product_wms_attributes TO authenticated;
GRANT SELECT ON public.category_compatibility TO authenticated;

COMMIT;

-- Verify:
--   SELECT to_regclass('public.product_wms_attributes'), to_regclass('public.category_compatibility');
--   SELECT bin_categories FROM public.wie_putaway_candidates(1, 1, 3);
