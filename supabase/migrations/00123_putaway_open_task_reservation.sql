-- =============================================================================
-- An open putaway task holds the space it was promised
-- Migration: 00123_putaway_open_task_reservation.sql
-- =============================================================================
-- One view, and two REPORTED columns on wie_putaway_candidates. This function
-- filters nothing new: every bin it returned yesterday it returns today.
--
-- ── THE BUG ─────────────────────────────────────────────────────────────────
--
-- Two-stage putaway (00080) moves NO STOCK at assign — deliberately, and that is
-- right: un-placed goods read as sitting at the warehouse root, which is where
-- they actually are. The consequence nobody drew: `v_bin_fill` reads
-- `inventory_balances`, so until someone physically carries a plate to a bay the
-- bay reads EMPTY to the engine, however many tasks already name it.
--
-- Measured on dev before writing this: Amadiya bin 2967 (`AMADIYA-BULK-3-6`, one
-- marked pallet cell, `capacity_slots = 1`) carried THREE open assigned tasks on
-- three different plates, and bins 2966 and 2980 carried two each — every one of
-- them still reporting `used_slots = 0`. The operator assigns a new receipt and
-- is sent to a bay already promised to somebody elses pallet, under the same
-- name and the same barcode they were shown an hour ago.
--
-- ── WHY A REPORTED COLUMN AND NOT A FILTER ──────────────────────────────────
--
-- Same argument as 00116, which is worth not re-deriving: the overflow path
-- needs the full bins (a full bay is still a legal destination when everything
-- is full), and the precedence ladder needs every candidate including the ones
-- that lose. So this reports pending occupancy and TypeScript decides. The fold
-- happens in `_shared/putawayTasks.ts`, at the one line that already adds the
-- in-flight `overlay` to `used_slots` — pending tasks are the same idea across
-- receipts that the overlay is within one.
--
-- `used_slots` is deliberately NOT changed to include this. It is what the UI
-- shows as "how full is this bay", and a bay holding nothing is not full; it is
-- spoken for. Two different facts, two different columns.
--
-- ── THE CHARGING RULE IS THE ONE FROM 00122 ─────────────────────────────────
--
-- One position per DISTINCT plate in a plate-denominated bin, SUM(qty ×
-- size_factor) otherwise. Restated here because SQL must, and for the same
-- reason 00078 gave: the alternative is the planner and the fill disagreeing
-- about what a plate costs, which is precisely the class of bug 00122 fixed.
--
-- A task's destination is COALESCE(assigned_location_id, recommended_location_id)
-- — an assigned task holds the bay a person committed to, a suggested one holds
-- the bay the engine named. Only `suggested` and `assigned` are open; everything
-- else has either landed in `inventory_balances` already (accepted / overridden)
-- or been abandoned (expired), and counting those would double-charge the bay.
--
-- No self-blocking on a re-score: `recommend-putaway` expires the row it
-- replaces BEFORE calling the engine (its own comment says why), so a task being
-- re-run is not open when its candidates load.
--
-- DROP IS MANDATORY on the function: CREATE OR REPLACE cannot alter RETURNS
-- TABLE, and with a changed signature it makes a SECOND OVERLOAD rather than
-- replacing — the trap that has already bitten inv_transfer_stock and
-- inv_receive_stock. Both callers pass named arguments, so an overload fails at
-- runtime as an ambiguous call, not at deploy. AND THE REVOKE SHIPS IN THIS
-- FILE: this exact function lost its grants to precisely this operation in
-- 00078 and had to be repaired by 00101. Do not separate the DROP from the GRANT.
--
-- Apply via the Management API /database/query (the direct DB host is
-- unreachable from this box — see supabase/apply-sql.mjs).
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. v_bin_pending_putaway — space promised but not yet occupied
-- ---------------------------------------------------------------------------
DROP VIEW IF EXISTS public.v_bin_pending_putaway;

CREATE VIEW public.v_bin_pending_putaway
WITH (security_invoker = true) AS
    SELECT location_id,
           SUM(slots)  AS pending_slots,
           SUM(weight) AS pending_weight_kg
    FROM (
        -- Unit loads: one position per DISTINCT plate in a plate-denominated
        -- bin. The JOIN (not LEFT JOIN) confines this arm to tasks carrying a
        -- plate id, exactly as v_bin_fill's first arm does.
        SELECT COALESCE(r.assigned_location_id, r.recommended_location_id) AS location_id,
               COUNT(DISTINCT r.handling_unit_id)::NUMERIC                 AS slots,
               COALESCE(SUM(r.quantity * COALESCE(pw.weight_kg, 0)), 0)    AS weight
        FROM public.wie_putaway_recommendations r
        JOIN public.handling_units h
          ON h.id = r.handling_unit_id
        JOIN public.locations l
          ON l.id = COALESCE(r.assigned_location_id, r.recommended_location_id)
        LEFT JOIN public.product_wms_attributes pw ON pw.product_id = r.product_id
        WHERE r.status IN ('suggested', 'assigned')
          AND l.slot_kind = 'pallet'
        GROUP BY 1

        UNION ALL

        -- Everything else: quantity × size_factor, the arithmetic the planner
        -- itself uses for loose stock and for carton-denominated bays.
        SELECT COALESCE(r.assigned_location_id, r.recommended_location_id) AS location_id,
               SUM(r.quantity * COALESCE(pr.size_factor, 1))               AS slots,
               COALESCE(SUM(r.quantity * COALESCE(pw.weight_kg, 0)), 0)    AS weight
        FROM public.wie_putaway_recommendations r
        JOIN public.products  pr ON pr.id = r.product_id
        JOIN public.locations l
          ON l.id = COALESCE(r.assigned_location_id, r.recommended_location_id)
        LEFT JOIN public.handling_units h ON h.id = r.handling_unit_id
        LEFT JOIN public.product_wms_attributes pw ON pw.product_id = r.product_id
        WHERE r.status IN ('suggested', 'assigned')
          AND NOT (h.id IS NOT NULL AND COALESCE(l.slot_kind, '') = 'pallet')
        GROUP BY 1
    ) t
    GROUP BY location_id;

COMMENT ON VIEW public.v_bin_pending_putaway IS
    'Space promised to OPEN putaway tasks (suggested or assigned) but not yet '
    'occupied, per destination location, in the unit that bin capacity_slots is '
    'denominated in. Two-stage putaway moves no stock at assign (00080), so '
    'without this a one-pallet bay reads empty to the engine however many tasks '
    'already name it. Charging rule mirrors v_bin_fill (00122). Reported to the '
    'planner via wie_putaway_candidates.pending_slots; deliberately NOT folded '
    'into v_bin_fill, which answers a different question.';

GRANT SELECT ON public.v_bin_pending_putaway TO authenticated;

-- ---------------------------------------------------------------------------
-- 2. wie_putaway_candidates reports it
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.wie_putaway_candidates(INT, INT, INT, TEXT[], BOOLEAN, INT[]);

CREATE FUNCTION public.wie_putaway_candidates(
    p_layout_id           INT,
    p_product_id          INT,
    p_limit               INT     DEFAULT 2000,
    p_roles               TEXT[]  DEFAULT NULL,
    p_hold_only           BOOLEAN DEFAULT false,
    p_priority_locations  INT[]   DEFAULT NULL
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
    slot_kind                TEXT,
    block_ids                INT[],
    is_hold                  BOOLEAN,
    -- NEW in 00123. Appended last, same convention as 00116.
    pending_slots            NUMERIC,
    pending_weight_kg        NUMERIC
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
    ),
    -- Every block every bin belongs to, for the WHOLE layout, folded once.
    -- v_slotting_block_bins is the single definition of that expansion (00115);
    -- never restate the materialized_path prefix walk anywhere else.
    bin_blocks AS (
        SELECT vb.location_id, array_agg(DISTINCT vb.block_id) AS ids
        FROM public.v_slotting_block_bins vb
        GROUP BY vb.location_id
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
        l.slot_kind,
        bb.ids,
        COALESCE(zp.is_hold, false),
        COALESCE(pend.pending_slots, 0),
        COALESCE(pend.pending_weight_kg, 0)
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
    LEFT JOIN public.v_bin_pending_putaway pend ON pend.location_id = p.location_id
    LEFT JOIN bin_weight     bw  ON bw.location_id = p.location_id
    LEFT JOIN bin_cats       bc  ON bc.location_id = p.location_id
    LEFT JOIN same_prod      sp  ON sp.location_id = p.location_id
    LEFT JOIN bin_blocks     bb  ON bb.location_id = p.location_id
    WHERE p.layout_id = p_layout_id
      AND l.is_active
      -- A RACK-kind parent has no placement row anyway (belt-and-braces guard).
      AND l.kind <> 'RACK'
      -- NULL level_role (every legacy bin) always stays eligible — the hard
      -- never-mix role rule only ever narrows LEVELLED locations.
      AND (p_roles IS NULL OR l.level_role IS NULL OR l.level_role = ANY(p_roles))
      -- 00101. COALESCE, because zp is NULL for every unbound bin and a NULL
      -- here is not FALSE: an unbound bin is not held, and must stay eligible
      -- for an ordinary receipt and ineligible for a held one.
      AND COALESCE(zp.is_hold, false) = p_hold_only
    -- 00116. A PRIORITY, not a filter: everything still arrives, but this
    -- product's own home bins can never be the rows the LIMIT cuts off.
    ORDER BY (p_priority_locations IS NOT NULL
              AND p.location_id = ANY(p_priority_locations)) DESC,
             ndd.dist NULLS LAST,
             p.location_id
    LIMIT p_limit;
$$;

REVOKE ALL ON FUNCTION public.wie_putaway_candidates(INT,INT,INT,TEXT[],BOOLEAN,INT[])
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wie_putaway_candidates(INT,INT,INT,TEXT[],BOOLEAN,INT[])
    TO service_role;

COMMIT;

-- =============================================================================
-- Verify with:
--
--   -- a. EXACTLY ONE overload must survive, or every named call errors as
--   --    ambiguous at runtime rather than at deploy:
--   SELECT oid::regprocedure AS signature, proacl
--     FROM pg_proc WHERE proname = 'wie_putaway_candidates';
--     -- expect ONE row, proacl naming service_role only (never PUBLIC/anon)
--
--   -- b. The bays that were double-booked. Every one must now report pending
--   --    space, where it previously reported used_slots = 0 and nothing else:
--   SELECT l.code, l.capacity_slots, f.used_slots, pend.pending_slots,
--          count(r.id) AS open_tasks
--     FROM public.wie_putaway_recommendations r
--     JOIN public.locations l
--       ON l.id = COALESCE(r.assigned_location_id, r.recommended_location_id)
--     LEFT JOIN public.v_bin_fill f               ON f.location_id = l.id
--     LEFT JOIN public.v_bin_pending_putaway pend ON pend.location_id = l.id
--    WHERE r.status IN ('suggested','assigned')
--    GROUP BY 1,2,3,4 ORDER BY 5 DESC;
--
--   -- c. Reporting only: the candidate row count for a product must be
--   --    unchanged by this migration.
--   SELECT count(*) FROM public.wie_putaway_candidates(
--       (SELECT active_layout_id FROM public.locations WHERE code = 'MAIN'), 1);
--
-- Rollback: DROP VIEW public.v_bin_pending_putaway, then re-apply 00116's
--   function body verbatim (its DROP names the 6-arg signature already).
-- =============================================================================
