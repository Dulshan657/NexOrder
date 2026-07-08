-- =============================================================================
-- Warehouse Intelligence Engine — richer storage FORMS (capacity + weight)
-- Migration: 00061_storage_forms_capacity.sql
-- =============================================================================
-- Extends the storage_types catalogue (00056) from a single default-slot number
-- into full "storage forms": structured capacity (levels × positions → derived
-- slots), physical dimensions, a WEIGHT capacity, a palette colour, and a
-- drawable flag so every form can be placed on the Layout Designer. Adds a
-- per-location weight limit inherited from the form. Extends the putaway
-- candidate loader to also expose each bin's weight capacity + current weight
-- fill so the engine can ENFORCE weight (parallel to the existing slot gate).
--
-- Additive, idempotent, safe: all new columns are nullable (weight fails OPEN —
-- null limit or null product weight ⇒ no weight gating), existing rows keep
-- working, and the RPC change is backward compatible (callers read columns by
-- name). No RLS change — columns land on already-locked tables.
-- =============================================================================

BEGIN;

-- ── 1. storage_types → storage FORMS: structured capacity, dims, weight, look ─
ALTER TABLE public.storage_types
    ADD COLUMN IF NOT EXISTS levels              INT,
    ADD COLUMN IF NOT EXISTS positions_per_level INT,
    ADD COLUMN IF NOT EXISTS weight_capacity_kg  NUMERIC(12,3),   -- NULL = no limit
    ADD COLUMN IF NOT EXISTS length_cm           NUMERIC(10,2),
    ADD COLUMN IF NOT EXISTS width_cm            NUMERIC(10,2),
    ADD COLUMN IF NOT EXISTS height_cm           NUMERIC(10,2),
    ADD COLUMN IF NOT EXISTS color               TEXT,            -- hex for the designer palette
    ADD COLUMN IF NOT EXISTS is_drawable         BOOLEAN NOT NULL DEFAULT true;

-- ── 2. Per-location weight limit (inherited from the form at draw time) ───────
ALTER TABLE public.locations
    ADD COLUMN IF NOT EXISTS weight_capacity_kg NUMERIC(12,3);

-- ── 3. Backfill the seeded starter forms (idempotent: only when still unset) ──
-- PALLET_RACK: 5 levels × 2 positions = 10 slots (matches its existing default).
UPDATE public.storage_types
   SET levels = 5, positions_per_level = 2, weight_capacity_kg = COALESCE(weight_capacity_kg, 1000)
 WHERE code = 'PALLET_RACK' AND levels IS NULL;
-- COLD_ROOM: 3 × 2 = 6 slots (matches its existing default).
UPDATE public.storage_types
   SET levels = 3, positions_per_level = 2
 WHERE code = 'COLD_ROOM' AND levels IS NULL;
-- Palette colours for the starter forms (only when unset).
UPDATE public.storage_types SET color = '#10b981' WHERE code = 'PALLET_RACK' AND color IS NULL;
UPDATE public.storage_types SET color = '#6366f1' WHERE code = 'SHELVING'    AND color IS NULL;
UPDATE public.storage_types SET color = '#f59e0b' WHERE code = 'BULK_FLOOR'  AND color IS NULL;
UPDATE public.storage_types SET color = '#0ea5e9' WHERE code = 'COLD_ROOM'   AND color IS NULL;

-- ── 4. Seed a drawable STAGING form (dock-side buffer stock) ──────────────────
-- The I/O dock stays a travel anchor (layout_object); dock-side stock lives in a
-- capacity-bearing STAGING form drawn like any other rack.
INSERT INTO public.storage_types
    (code, name, default_capacity_slots, slot_unit, attributes, sort_order, color, is_drawable)
SELECT 'STAGING', 'Staging Area', 20::numeric, 'pallet', '{}'::jsonb, 50, '#a855f7', true
WHERE NOT EXISTS (SELECT 1 FROM public.storage_types s WHERE s.code = 'STAGING');

-- ── 5. Candidate loader: expose weight capacity + current weight fill ─────────
-- Return-type change ⇒ DROP + recreate. used_weight = Σ(on_hand × weight_kg);
-- products with no weight contribute 0 (weight gate fails open for them).
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
    weight_capacity_kg       NUMERIC,
    used_weight_kg           NUMERIC
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
    bin_weight AS (
        SELECT b.location_id, SUM(b.on_hand * COALESCE(pw.weight_kg, 0)) AS used_weight
        FROM public.inventory_balances b
        LEFT JOIN public.product_wms_attributes pw ON pw.product_id = b.product_id
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
        l.weight_capacity_kg,
        COALESCE(bw.used_weight, 0)
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
    LEFT JOIN bin_weight     bw  ON bw.location_id = p.location_id
    LEFT JOIN bin_cats       bc  ON bc.location_id = p.location_id
    LEFT JOIN same_prod      sp  ON sp.location_id = p.location_id
    WHERE p.layout_id = p_layout_id AND l.is_active
    ORDER BY ndd.dist NULLS LAST, p.location_id
    LIMIT p_limit;
$$;

REVOKE ALL ON FUNCTION public.wie_putaway_candidates(INT,INT,INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wie_putaway_candidates(INT,INT,INT) TO service_role;

COMMIT;

-- Verify:
--   SELECT code, levels, positions_per_level, default_capacity_slots, weight_capacity_kg, color, is_drawable
--     FROM public.storage_types ORDER BY sort_order;
--   SELECT column_name FROM information_schema.columns
--     WHERE table_name = 'locations' AND column_name = 'weight_capacity_kg';
--   SELECT weight_capacity_kg, used_weight_kg FROM public.wie_putaway_candidates(1, 1, 3);
