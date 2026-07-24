-- =============================================================================
-- Per-plate capacity — a pallet consumes a POSITION, not qty × size_factor
-- Migration: 00078_per_plate_capacity.sql
-- =============================================================================
-- A bin's capacity_slots is denominated in its slot_kind: a carton bay holds N
-- cartons, a pallet bay holds N PALLET POSITIONS. Every fill calculation in the
-- system has nonetheless been `Σ(on_hand × size_factor)` since mig 00039, which
-- is right for a carton bay and nonsense for a pallet bay — one pallet carrying
-- 130 units reads as 130 slots against a limit of 10.
--
-- Measured on live data before writing this:
--
--   warehouse   slot_kind  bins  used_slots  capacity  plates  over-capacity
--   WIE-DEMO    pallet       36         466       360      36      17
--   MAIN        carton      145        6713     16000     145       0
--
-- Each of those 17 "over-capacity" bins holds EXACTLY ONE PALLET in a
-- ten-position bay. The engine believes they are full, so it stops recommending
-- them, the warehouse map paints them red and the putaway picker warns operators
-- off them.
--
-- Handling units (mig 00075) made the fix expressible: a plate's contents ARE
-- its balance rows, so "how many pallets are in this bin" is a COUNT DISTINCT
-- over handling_unit_id.
--
-- THE RULE ------------------------------------------------------------------
--   positions(row) = 1 per DISTINCT plate   when locations.slot_kind = 'pallet'
--                                            AND handling_units.hu_type = 'pallet'
--                  = on_hand × size_factor   otherwise
--
-- Gated on BOTH ends, deliberately:
--   * on the BIN, so a pallet decanted onto a carton shelf is still counted in
--     cartons. This is what leaves MAIN — entirely carton-denominated, and the
--     only non-demo racked warehouse — bit-for-bit unchanged. Every pallet-slot
--     bin in the database today is in a demo/test warehouse.
--   * on the PLATE, so loose/legacy stock (handling_unit_id NULL) degrades to
--     exactly today's arithmetic, and carton plates keep their unit maths: the
--     00076 backfill lumped ~46 cartons onto a single 'carton' plate, so
--     counting those as one position would read MAIN as 1% full.
--
-- COUNT DISTINCT (rather than one row = one position) is what makes a MIXED-SKU
-- pallet — several balance rows, one handling unit, allowed by design — total 1.
--
-- WHY A VIEW ----------------------------------------------------------------
-- The bin_fill CTE was copy-pasted verbatim through migrations 00045, 00047,
-- 00048, 00049, 00054, 00061 and 00072. That duplication is precisely what made
-- this change expensive, so the definition moves into ONE view both live
-- consumers select from. `security_invoker = true` (PG15+; this project is
-- 17.6) keeps the caller's own permissions and RLS in force, so the view behaves
-- exactly as the inlined SQL did — no silent change in security posture.
--
-- The TypeScript half of the rule lives in _shared/wie/capacity.ts, imported by
-- both the Edge Functions and the Vite frontend. This file is the only place it
-- is restated.
--
-- Apply via the Management API /database/query (the direct DB host is
-- unreachable from this box — see supabase/apply-sql.mjs).
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. v_bin_fill — the single definition of "how full is this bin"
-- ---------------------------------------------------------------------------
DROP VIEW IF EXISTS public.v_bin_fill;

CREATE VIEW public.v_bin_fill
WITH (security_invoker = true) AS
    SELECT location_id, SUM(slots) AS used_slots
    FROM (
        -- Unit loads: one position per DISTINCT pallet plate in a pallet bin.
        SELECT b.location_id, COUNT(DISTINCT b.handling_unit_id)::NUMERIC AS slots
        FROM public.inventory_balances b
        JOIN public.handling_units    h ON h.id = b.handling_unit_id
        JOIN public.locations         l ON l.id = b.location_id
        WHERE b.on_hand > 0
          AND h.hu_type    = 'pallet'
          AND l.slot_kind  = 'pallet'
        GROUP BY b.location_id

        UNION ALL

        -- Everything else: the pre-00078 arithmetic, unchanged.
        -- COALESCE on BOTH sides of the negation is load-bearing: a bare
        -- NOT (NULL AND ...) evaluates to NULL, not TRUE, which would silently
        -- drop every loose (handling_unit_id IS NULL) row from the fill.
        SELECT b.location_id, SUM(b.on_hand * COALESCE(pr.size_factor, 1)) AS slots
        FROM public.inventory_balances b
        JOIN public.products  pr ON pr.id = b.product_id
        JOIN public.locations l  ON l.id  = b.location_id
        LEFT JOIN public.handling_units h ON h.id = b.handling_unit_id
        WHERE b.on_hand > 0
          AND NOT (COALESCE(h.hu_type, '') = 'pallet' AND COALESCE(l.slot_kind, '') = 'pallet')
        GROUP BY b.location_id
    ) t
    GROUP BY location_id;

COMMENT ON VIEW public.v_bin_fill IS
    'Occupancy per location in the unit its capacity_slots is denominated in: '
    'one position per pallet plate in a pallet-slot bin, Σ(on_hand × size_factor) '
    'everywhere else (mig 00078). The single SQL definition of the rule — mirrored '
    'in TypeScript by _shared/wie/capacity.ts. Do not re-inline it.';

GRANT SELECT ON public.v_bin_fill TO authenticated;

-- ---------------------------------------------------------------------------
-- 2. wie_putaway_recommendations remembers WHICH plate the line is on
-- ---------------------------------------------------------------------------
-- Without this the queue row reaching the operator's manual bin picker has no
-- handling unit, so the client-side capacity warning falls back to per-unit
-- maths and shouts "over capacity" at precisely the pallet bays the engine has
-- just called fine. Nullable and advisory: every pre-existing row stays NULL and
-- behaves exactly as before.
--
-- Deliberately NOT wired into decide-putaway, which still moves a QUANTITY via
-- inv_transfer_stock (expiry-ordered, carrying whatever plate each row has).
-- Position accounting is unaffected by that — any pallet is one position — but
-- making the named plate the one that physically moves is a separate change.
ALTER TABLE public.wie_putaway_recommendations
    ADD COLUMN IF NOT EXISTS handling_unit_id BIGINT
        REFERENCES public.handling_units(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.wie_putaway_recommendations.handling_unit_id IS
    'The plate this recommendation is for (mig 00078). Advisory: drives the '
    'operator-facing capacity unit and the plate badge, not the stock movement.';

-- ---------------------------------------------------------------------------
-- 3. wie_putaway_candidates — plate-aware fill + expose slot_kind
-- ---------------------------------------------------------------------------
-- The engine has to know a bin's DENOMINATION to charge an incoming line
-- correctly, so slot_kind joins the result set.
--
-- TRAP: this is a return-type change. CREATE OR REPLACE with a changed
-- signature creates an OVERLOAD, not a replacement — mig 00037 did exactly this
-- to inv_receive_stock and 00075 nearly repeated it on inv_adjust_stock, both
-- costing real debugging. Drop every existing arg list explicitly, then create.
-- Verify with the pg_proc count at the bottom of this file.
DROP FUNCTION IF EXISTS public.wie_putaway_candidates(INT, INT, INT);
DROP FUNCTION IF EXISTS public.wie_putaway_candidates(INT, INT, INT, TEXT[]);

CREATE FUNCTION public.wie_putaway_candidates(
    p_layout_id  INT,
    p_product_id INT,
    p_limit      INT DEFAULT 2000,
    p_roles      TEXT[] DEFAULT NULL
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
    used_weight_kg           NUMERIC,
    level_role               TEXT,
    level_index              INT,
    slot_kind                TEXT
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
        COALESCE(bw.used_weight, 0),
        l.level_role,
        l.level_index,
        l.slot_kind
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
    LEFT JOIN public.v_bin_fill bf ON bf.location_id = p.location_id
    LEFT JOIN bin_weight     bw  ON bw.location_id = p.location_id
    LEFT JOIN bin_cats       bc  ON bc.location_id = p.location_id
    LEFT JOIN same_prod      sp  ON sp.location_id = p.location_id
    WHERE p.layout_id = p_layout_id
      AND l.is_active
      -- A RACK-kind parent has no placement row anyway (belt-and-braces guard).
      AND l.kind <> 'RACK'
      -- NULL level_role (every legacy bin) always stays eligible — the hard
      -- never-mix role rule only ever narrows LEVELLED locations.
      AND (p_roles IS NULL OR l.level_role IS NULL OR l.level_role = ANY(p_roles))
    ORDER BY ndd.dist NULLS LAST, p.location_id
    LIMIT p_limit;
$$;

-- ---------------------------------------------------------------------------
-- 4. wie_warehouse_report — same fill, so the KPI matches the engine
-- ---------------------------------------------------------------------------
-- Return type is unchanged (JSONB), so CREATE OR REPLACE is safe here.
-- emptyBins / utilizationPct both read the fill, and a warehouse whose engine
-- and whose KPI strip disagree about occupancy is worse than either being wrong.
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
        SELECT f.location_id, f.used_slots
        FROM public.v_bin_fill f
        WHERE f.location_id IN (SELECT location_id FROM placed_bins)
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

COMMIT;

-- =============================================================================
-- Verification (run rollback-isolated FIRST — see
-- memory/rollback-isolated-prod-sql-verification.md)
-- =============================================================================
--   -- The overload trap: exactly ONE signature must survive.
--   SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--    WHERE n.nspname = 'public' AND p.proname = 'wie_putaway_candidates';   -- 1
--
--   -- WIE-DEMO's 36 pallet bins: 466 → 36 used slots, 0 over capacity.
--   -- MAIN's 145 carton bins: 6713, unchanged. This is the no-regression gate.
--   SELECT split_part(l.materialized_path, '/', 1) AS wh, l.slot_kind,
--          count(*) AS bins, SUM(f.used_slots) AS used, SUM(l.capacity_slots) AS cap,
--          count(*) FILTER (WHERE f.used_slots > l.capacity_slots) AS over_cap
--     FROM public.v_bin_fill f JOIN public.locations l ON l.id = f.location_id
--    GROUP BY 1, 2 ORDER BY 1, 2;
--
--   -- The new column is present and populated:
--   SELECT location_id, code, slot_kind, capacity_slots, used_slots
--     FROM public.wie_putaway_candidates(<layout_id>, <product_id>, 20);
-- =============================================================================
