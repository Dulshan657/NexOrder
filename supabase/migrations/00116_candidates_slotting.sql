-- =============================================================================
-- wie_putaway_candidates — report block membership and hold-ness
-- Migration: 00116_candidates_slotting.sql
-- =============================================================================
-- Three additions, all REPORTING. This function filters nothing new: every bin
-- it returned yesterday it returns today.
--
--   block_ids INT[]   which slotting blocks (00115) this bin belongs to
--   is_hold   BOOLEAN whether it sits in a quarantine zone (00101)
--   p_priority_locations INT[]  bins to hoist above the LIMIT cutoff
--
-- WHY THE FILTERING STAYS IN TYPESCRIPT. It is tempting to add a WHERE clause
-- here and be done. It would be wrong three times over:
--   1. Overflow needs the non-home bins. "Ranked homes, then anywhere" means a
--      bin outside every block is still a legal destination when the blocks are
--      full -- a WHERE clause deletes exactly the rows the feature depends on.
--   2. Precedence needs EVERY matching rule, plus the ones that do NOT match
--      (reservation is decided by those). Filtering here would mean restating
--      the ladder, the ranking, the reservation union and the hard/soft split
--      in SQL, beside the TypeScript that already does it.
--   3. A SQL-side exclusion is INVISIBLE. scoring.ts:178-196 exists solely
--      because the level-role gate runs here, and it had to fabricate a
--      HardFilterReason with rejectedCount 0 and an empty sample to compensate.
--      Doing it again would produce a second such special case, when the natural
--      TypeScript path yields real counts and real samples for free.
-- plan-reslot is the standing warning: three places answered "what zone is this
-- bin in", two were wrong, and it ran zone-blind for months with nothing failing.
--
-- WHY is_hold HAS TO TRAVEL. `quarantine` is a call ARGUMENT that never becomes
-- a stored fact -- it enters at receive-stock, becomes p_hold_only, and dies
-- there; wie_putaway_recommendations has no column for it. And p_hold_only is a
-- SWITCH, so a held line's candidate set is hold bays EXCLUSIVELY -- every one
-- of which is, by construction, outside any operator-painted block. Without this
-- column the engine cannot tell "quarantine bay" from "bin nobody assigned", so
-- every quarantined receipt of a slotted product would be flagged off-home, and
-- under a hard rule refused at the very bin the engine itself recommended.
--
-- WHY p_priority_locations RATHER THAN ORDERING BY block_ids. The LIMIT is a
-- HARD CUTOFF over an ORDER BY dock distance, so a home block at the far end of
-- a 2000+ location site would never reach the engine at all. Hoisting "is in ANY
-- block" would be a weak proxy -- on a well-organised site most bins are in some
-- block, so it sorts almost nothing. The caller already knows which bins are
-- THIS product's homes (it resolved the rule), so it passes them. That keeps
-- every judgement in TypeScript and leaves this function told, not deciding.
--
-- DROP IS MANDATORY: CREATE OR REPLACE cannot alter RETURNS TABLE, and with a
-- changed signature it makes a SECOND OVERLOAD rather than replacing -- the trap
-- that has already bitten inv_transfer_stock and inv_receive_stock. Both callers
-- pass named arguments, so an overload fails at runtime as an ambiguous call,
-- not at deploy.
--
-- AND THE REVOKE SHIPS IN THIS FILE. This exact function has already lost its
-- grants to precisely this operation: 00078 dropped both signatures and created
-- the new one without re-granting, so EXECUTE went to PUBLIC and any holder of
-- the anon key could enumerate every bin, its capacity, its fill and whether a
-- given product sat in it. 00101 repaired it and wrote down why. Do not separate
-- the DROP from the GRANT.
--
-- p_hold_only KEEPS ITS DEFAULT. wie-batch-reoptimize calls this with four named
-- arguments and omits it; dropping the default breaks that call silently at
-- runtime.
-- =============================================================================

BEGIN;

DROP FUNCTION IF EXISTS public.wie_putaway_candidates(INT, INT, INT, TEXT[], BOOLEAN);

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
    -- NEW in 00116. Appended last so a positional reader (there are none, but
    -- the convention costs nothing) sees the historical shape unchanged.
    block_ids                INT[],
    is_hold                  BOOLEAN
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
        COALESCE(zp.is_hold, false)
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
--   -- EXACTLY ONE overload must survive, or every named call errors as
--   -- ambiguous at runtime rather than at deploy:
--   SELECT oid::regprocedure AS signature, proacl
--     FROM pg_proc WHERE proname = 'wie_putaway_candidates';
--     -- expect ONE row, and proacl naming service_role only (never PUBLIC/anon)
--
--   -- Reporting only: the row count for a product must be unchanged by this
--   -- migration when the site has no slotting blocks.
--   SELECT count(*) FROM public.wie_putaway_candidates(
--       (SELECT active_layout_id FROM public.locations WHERE code = 'MAIN'), 1);
--
--   -- Hold-ness must agree with v_held_locations, in both directions:
--   SELECT c.is_hold, count(*) FROM public.wie_putaway_candidates(
--       (SELECT active_layout_id FROM public.locations WHERE code = 'MAIN'), 1) c
--   GROUP BY 1;   -- expect is_hold = false for every row of an ordinary call
--
-- Rollback: re-apply 00101's section 5 verbatim (its DROP names the 5-arg
--   signature, so change it to the 6-arg one first).
-- =============================================================================
