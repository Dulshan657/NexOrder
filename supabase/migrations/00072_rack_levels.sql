-- =============================================================================
-- Rack levels — per-instance level configuration with pick/reserve/bulk roles
-- Migration: 00072_rack_levels.sql
-- =============================================================================
-- Today one painted grid cell becomes exactly one `locations` row of kind BIN
-- with a single flat capacity_slots. Levels *appear* to exist (storage_types
-- carries levels x positions_per_level = default_capacity_slots, mig 00061) but
-- those numbers are pure arithmetic feeding one capacity figure — no level is a
-- real place, and every rack drawn with a given form is identical. This
-- migration makes a rack a container of addressable levels: each level is a
-- real `locations` row with its own capacity, stock and role, so putaway and
-- picking can direct an operator to MAIN-B-4-2-L2, not just MAIN-B-4-2.
--
-- Load-bearing design decision (see the approved plan's Architecture section):
-- EVERY level gets its own layout_placements row, co-located at the rack's
-- existing (floor,x,y), distinguished by a new level_index column. The parent
-- RACK location gets NO placement row. wie_putaway_candidates, publish-time
-- graph snapping, layout_travel_distances, pick routing (wie_order_alloc_bins,
-- 00064) and the congestion overlay are ALL keyed on layout_placements — giving
-- every level a placement means all of those keep working unchanged, they just
-- see N co-located locations where they used to see 1. UNIQUE(layout_id,
-- location_id) permits this.
--
-- `kind = 'RACK'` is NOT a new value — 12 existing WIE-DEMO locations already
-- use it as a non-placed hierarchy container with BIN children (checked live:
-- those rows carry no layout_placements row and no capacity_slots). Converting
-- a BIN to a RACK-with-SHELF-children reuses that exact existing semantic.
--
-- Role enforcement (pick/reserve/bulk) lives in SQL, in wie_putaway_candidates'
-- WHERE clause, which is also where the 200-candidate cap is raised to 2000 —
-- MAIN is 189 bays x 5 levels = 945 locations, and the old cap would silently
-- hide the far half of the warehouse from the engine (memory/main-warehouse-
-- slotting-2026-07.md). NULL level_role (every legacy bin, forever) always
-- stays eligible — this is not optional, it is what keeps every non-levelled
-- bin in the entire system working with zero migration required.
--
-- wie_convert_rack_to_levels_tx is the only function here that touches live
-- stock. It deliberately does NOT call inv_transfer_stock (available-only,
-- would refuse to move MAIN's live allocated reservations against open
-- orders — see memory/stale-reservations-on-delivered-orders.md) and instead:
--   1. Moves on_hand via a transfer_out/transfer_in ledger pair per batch,
--      exactly mirroring inv_transfer_stock's own pattern (inv_apply_leg,
--      alloc_delta 0 on that leg) — a fully-typed, auditable move.
--   2. Moves the allocated portion by CALLING inv_apply_leg with BOTH deltas
--      set on the SAME transfer_out/transfer_in leg (so the physical balance —
--      on_hand AND allocated — is exactly, atomically correct on both ends;
--      the ledger's qty_delta for a transfer_out/in row only ever records the
--      on_hand delta per inv_apply_leg's own CASE, which is an accepted, minor
--      audit-trail gap for this genuinely new case — moving allocated stock —
--      that inv_transfer_stock has never had to handle).
--   3. SEPARATELY writes ledger-only (no balance mutation — raw INSERT, not
--      inv_apply_leg) 'deallocate'/'allocate' rows attributed per (product,
--      order), transplanting whatever wie_order_alloc_bins (00064) already
--      nets for the rack so it reports identically for L1 afterwards. This is
--      the "re-point open pick-task rows" step — there is no persisted
--      pick-task TABLE (00064's tasks are computed live from the ledger via
--      wie_order_alloc_bins), so re-pointing IS writing these ledger rows.
--      pick_progress is deliberately left untouched: it is a historical record
--      of a completed pick, correct as written, and the rack keeps its
--      `locations.id` specifically so pick_progress's FK never dangles.
--   4. Defensively expires any still-'suggested' wie_putaway_recommendations
--      whose recommended_location_id is the rack being converted — a bare BIN
--      target that no longer exists as a placeable location once it becomes a
--      RACK container.
--
-- Additive & idempotent: every new column is nullable/defaulted, the storage-
-- form backfill only touches rows with level_template still NULL, and
-- wie_putaway_candidates is DROP + recreate (same pattern as migs 00048/00061)
-- with the old 3-arg signature explicitly dropped first so no stale overload
-- can linger (mig 00037 caused a real ambiguous-overload bug in production).
-- wie_convert_rack_to_levels_tx guards re-runs on the SAME rack by rejecting
-- anything that isn't kind='BIN' with no level children yet.
--
-- Apply via the Supabase Management API (see CLAUDE.md); do not run
-- interactively. service_role-only on every new/changed function.
-- =============================================================================

BEGIN;

-- =============================================================================
-- A. Columns — all additive, nullable/defaulted
-- =============================================================================

-- ── A1. storage_types — opt a FORM into levels + its STANDARD level layout ───
ALTER TABLE public.storage_types
    ADD COLUMN IF NOT EXISTS has_levels     BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS level_template JSONB;   -- [{role, capacity_slots, weight_capacity_kg}]

-- ── A2. locations — a level's role + its 1-based position in its rack ────────
ALTER TABLE public.locations
    ADD COLUMN IF NOT EXISTS level_role  TEXT CHECK (level_role IN ('pick','reserve','bulk')),
    ADD COLUMN IF NOT EXISTS level_index INT;

COMMENT ON COLUMN public.locations.level_role IS
    'Role for an addressable rack level (pick/reserve/bulk). NULL on every '
    'legacy/non-levelled location (i.e. every bin today) means UNCONSTRAINED: '
    'wie_putaway_candidates''s p_roles filter always keeps a NULL-role location '
    'eligible, so nothing existing needs migrating.';
COMMENT ON COLUMN public.locations.level_index IS
    '1-based position within the parent rack (L1 = bottom/closest reach). NULL '
    'for anything that is not a rack level, including the RACK parent itself.';

-- ── A3. layout_placements — which level this placement row represents ───────
ALTER TABLE public.layout_placements
    ADD COLUMN IF NOT EXISTS level_index INT;   -- NULL = legacy single-bin placement

-- Renderers (LayoutCanvas/WarehouseCanvas) and the new "group co-located
-- placements into one rack" query both hit this shape hard.
CREATE INDEX IF NOT EXISTS idx_layout_placements_group
    ON public.layout_placements(layout_id, floor, x, y);

-- ── A4. product_wms_attributes — which level roles a SKU may occupy ─────────
ALTER TABLE public.product_wms_attributes
    ADD COLUMN IF NOT EXISTS allowed_level_roles TEXT[];

COMMENT ON COLUMN public.product_wms_attributes.allowed_level_roles IS
    'Level roles this SKU may be put away into. NULL = any role (unconstrained) '
    '— every existing product keeps working unchanged.';

-- =============================================================================
-- B. Backfill the seeded starter FORMS with a standard level template
-- =============================================================================
-- Idempotent (WHERE level_template IS NULL). Per-level capacity_slots /
-- weight_capacity_kg are DERIVED from the form's existing default_capacity_slots
-- / weight_capacity_kg split evenly across N levels, so the rack's total
-- capacity still equals its old default_capacity_slots — the CapacityAdvisor's
-- invariant (Σ level capacities == old flat capacity) holds exactly for
-- PALLET_RACK (10 / 5 = 2/level, matching its existing positions_per_level=2)
-- and COLD_ROOM (6 / 3 = 2/level, matching positions_per_level=2). SHELVING has
-- no stored positions_per_level, so 40 / 4 = 10/level is a fresh even split.
--
-- NOTE for the orchestrator: this deliberately matches the plan's literal code
-- list (PALLET_RACK/SHELVING/COLD_ROOM). Live MAIN today actually uses ITS OWN
-- custom forms (MAIN_PALLET_BAY, MAIN_SHELF_BAY, MAIN_COLD_BAY, MAIN_BULK_FLOOR
-- — confirmed via a read-only SELECT against prod), which are NOT touched here
-- and so start with has_levels=false. wie_convert_rack_to_levels_tx does not
-- depend on a form's level_template (its p_levels is caller-supplied), so MAIN
-- conversions are unaffected; only the "reset to form standard" UI convenience
-- and RackWizard's default-for-new-rack behaviour would need an admin to
-- configure has_levels/level_template on MAIN's own forms via Storage Forms.
WITH role_specs(code, roles) AS (
    VALUES
        ('PALLET_RACK', ARRAY['pick','pick','pick','pick','bulk']),
        ('SHELVING',    ARRAY['pick','pick','pick','pick']),
        ('COLD_ROOM',   ARRAY['pick','pick','bulk'])
),
templates AS (
    SELECT
        st.id,
        jsonb_agg(
            jsonb_build_object(
                'role', r.role,
                'capacity_slots',
                    ROUND(COALESCE(st.default_capacity_slots, 0) / array_length(rs.roles, 1), 3),
                'weight_capacity_kg',
                    CASE WHEN st.weight_capacity_kg IS NULL THEN NULL
                         ELSE ROUND(st.weight_capacity_kg / array_length(rs.roles, 1), 3) END
            ) ORDER BY r.ord
        ) AS level_template
    FROM public.storage_types st
    JOIN role_specs rs ON rs.code = st.code
    CROSS JOIN LATERAL unnest(rs.roles) WITH ORDINALITY AS r(role, ord)
    WHERE st.level_template IS NULL
    GROUP BY st.id
)
UPDATE public.storage_types st
SET has_levels     = true,
    level_template = t.level_template
FROM templates t
WHERE st.id = t.id;

-- BULK_FLOOR and STAGING intentionally stay has_levels=false (the column
-- default) — floor stock and dock buffers are not addressable-level storage.

-- =============================================================================
-- C. wie_putaway_candidates — role-aware candidate loader, cap raised to 2000
-- =============================================================================
-- Return-type change (2 new trailing columns) => DROP + recreate, same pattern
-- as migs 00048/00061. The OLD 3-arg signature is dropped BY EXACT SIGNATURE so
-- no stale overload can linger (mig 00037's ambiguous-overload production bug).
DROP FUNCTION IF EXISTS public.wie_putaway_candidates(INT,INT,INT);

CREATE OR REPLACE FUNCTION public.wie_putaway_candidates(
    p_layout_id  INT,
    p_product_id INT,
    p_limit      INT     DEFAULT 2000,   -- was 200; MAIN alone is 189 bays x 5 levels = 945 locations
    p_roles      TEXT[]  DEFAULT NULL    -- NULL = no role filtering at all
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
    level_index               INT
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
        COALESCE(bw.used_weight, 0),
        l.level_role,
        l.level_index
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

REVOKE ALL ON FUNCTION public.wie_putaway_candidates(INT,INT,INT,TEXT[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wie_putaway_candidates(INT,INT,INT,TEXT[]) TO service_role;

-- =============================================================================
-- D. wie_convert_rack_to_levels_tx — convert ONE live BIN into a levelled RACK
-- =============================================================================
-- The only function here that touches live stock. See the header comment for
-- the full design rationale (why not inv_transfer_stock, the two-part ledger
-- write, and why pick_progress is untouched).
CREATE OR REPLACE FUNCTION public.wie_convert_rack_to_levels_tx(
    p_location_id INT,
    p_layout_id   INT,
    p_levels      JSONB,          -- ascending L1..Ln: [{role, capacity_slots, weight_capacity_kg}]
    p_actor       UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_rack        public.locations%ROWTYPE;
    v_placement   public.layout_placements%ROWTYPE;
    v_level       JSONB;
    v_role        TEXT;
    v_idx         INT := 0;
    v_new_loc_id  INT;
    v_l1_id       INT;
    v_level_ids   INT[] := '{}';
    v_bal         RECORD;
    v_order       RECORD;
    v_units_moved NUMERIC := 0;
BEGIN
    IF p_levels IS NULL OR jsonb_typeof(p_levels) <> 'array' OR jsonb_array_length(p_levels) < 1 THEN
        RAISE EXCEPTION 'INVALID_LEVELS: p_levels must be a non-empty JSON array' USING ERRCODE = 'P0001';
    END IF;

    -- Row lock: serialises concurrent conversion attempts on the same rack.
    SELECT * INTO v_rack FROM public.locations WHERE id = p_location_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'NOT_FOUND: location % not found', p_location_id USING ERRCODE = 'P0001';
    END IF;
    IF v_rack.kind <> 'BIN' THEN
        RAISE EXCEPTION 'ALREADY_CONVERTED: location % is kind % (expected BIN)', p_location_id, v_rack.kind
            USING ERRCODE = 'P0001';
    END IF;
    IF EXISTS (
        SELECT 1 FROM public.locations WHERE parent_id = p_location_id AND level_index IS NOT NULL
    ) THEN
        RAISE EXCEPTION 'ALREADY_CONVERTED: location % already has level children', p_location_id
            USING ERRCODE = 'P0001';
    END IF;

    -- The rack must be placed in THIS layout — every level inherits its
    -- geometry and graph anchor. Lock it too: nothing else may move it mid-txn.
    SELECT * INTO v_placement
    FROM public.layout_placements
    WHERE layout_id = p_layout_id AND location_id = p_location_id
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'NOT_PLACED: location % has no placement in layout %', p_location_id, p_layout_id
            USING ERRCODE = 'P0001';
    END IF;

    -- ── 1. Insert the level locations + their co-located placements ─────────
    FOR v_level IN SELECT * FROM jsonb_array_elements(p_levels)
    LOOP
        v_idx := v_idx + 1;
        v_role := v_level->>'role';
        IF v_role IS NULL OR v_role NOT IN ('pick','reserve','bulk') THEN
            RAISE EXCEPTION 'INVALID_LEVEL_ROLE: level % has role % (must be pick/reserve/bulk)',
                v_idx, v_role USING ERRCODE = 'P0001';
        END IF;

        INSERT INTO public.locations (
            parent_id, kind, code, name, materialized_path, is_active,
            level_role, level_index, capacity_slots, slot_kind, weight_capacity_kg,
            storage_type_id, created_in_layout_id
        ) VALUES (
            p_location_id, 'SHELF',
            v_rack.code || '-L' || v_idx,
            v_rack.name || ' — Level ' || v_idx,
            v_rack.materialized_path || '/' || v_rack.code || '-L' || v_idx,
            true,
            v_role, v_idx,
            NULLIF(v_level->>'capacity_slots', '')::NUMERIC,
            v_rack.slot_kind,
            NULLIF(v_level->>'weight_capacity_kg', '')::NUMERIC,
            v_rack.storage_type_id, v_rack.created_in_layout_id
        )
        RETURNING id INTO v_new_loc_id;

        v_level_ids := array_append(v_level_ids, v_new_loc_id);
        IF v_idx = 1 THEN v_l1_id := v_new_loc_id; END IF;

        -- Vertical reach cost rides the existing access_offset_m column: L1 =
        -- the rack's own offset, each level above adds a small +0.5m penalty.
        INSERT INTO public.layout_placements (
            layout_id, location_id, floor, x, y, w, h, rotation,
            graph_node_id, access_offset_m, level_index
        ) VALUES (
            p_layout_id, v_new_loc_id, v_placement.floor, v_placement.x, v_placement.y,
            v_placement.w, v_placement.h, v_placement.rotation,
            v_placement.graph_node_id,
            COALESCE(v_placement.access_offset_m, 0) + (v_idx - 1) * 0.5,
            v_idx
        );
    END LOOP;

    -- ── 2. The rack becomes a non-placed container (mirrors the existing RACK
    --      semantic already live for 12 WIE-DEMO locations: no placement row,
    --      no capacity_slots — see header comment). SAME locations.id, so
    --      inventory_movements / pick_progress history and every FK survive.
    DELETE FROM public.layout_placements WHERE layout_id = p_layout_id AND location_id = p_location_id;

    UPDATE public.locations
    SET kind = 'RACK', capacity_slots = NULL, slot_kind = NULL, weight_capacity_kg = NULL
    WHERE id = p_location_id;

    -- ── 3. Move stock to L1. NOT inv_transfer_stock (available-only — would
    --      reject any batch carrying a live reservation). inv_apply_leg is
    --      called directly with BOTH on_hand and allocated deltas on the SAME
    --      transfer_out/transfer_in leg, so the physical balance is exactly,
    --      atomically right on both ends (its ledger row's qty_delta records
    --      only the on_hand portion per inv_apply_leg's own convention — see
    --      header comment for why that is an accepted gap here).
    FOR v_bal IN
        SELECT product_id, batch_id, on_hand, allocated
        FROM public.inventory_balances
        WHERE location_id = p_location_id AND (on_hand > 0 OR allocated > 0)
        FOR UPDATE
    LOOP
        PERFORM public.inv_apply_leg(
            v_bal.product_id, p_location_id, v_bal.batch_id, -v_bal.on_hand, -v_bal.allocated,
            'transfer_out', p_actor, 'rack_conversion', p_location_id::TEXT, 'rack converted to levels');
        PERFORM public.inv_apply_leg(
            v_bal.product_id, v_l1_id, v_bal.batch_id, v_bal.on_hand, v_bal.allocated,
            'transfer_in', p_actor, 'rack_conversion', p_location_id::TEXT, 'rack converted to levels');
        v_units_moved := v_units_moved + v_bal.on_hand;
    END LOOP;

    -- ── 4. Re-point open orders' allocation NETTING to L1 (ledger-only — does
    --      NOT re-touch inventory_balances, already moved in full above). There
    --      is no persisted "pick task" table: wie_order_alloc_bins (00064)
    --      computes tasks live from this exact (product, location) grouping
    --      over allocate/deallocate legs, so writing a matching pair here is
    --      what "re-points" it. Whatever that view already nets for the rack,
    --      it now nets identically for L1 — pick_progress itself is untouched
    --      (a completed pick is a correct historical fact either way).
    FOR v_order IN
        SELECT product_id, ref_id AS order_id, SUM(qty_delta) AS qty
        FROM public.inventory_movements
        WHERE location_id = p_location_id
          AND ref_type = 'order'
          AND movement_type IN ('allocate', 'deallocate')
        GROUP BY product_id, ref_id
        HAVING SUM(qty_delta) > 0
    LOOP
        INSERT INTO public.inventory_movements
            (product_id, location_id, batch_id, qty_delta, movement_type, ref_type, ref_id, actor_id, reason)
        VALUES
            (v_order.product_id, p_location_id, NULL, -v_order.qty, 'deallocate', 'order', v_order.order_id,
             p_actor, 'rack levels conversion — routing repoint'),
            (v_order.product_id, v_l1_id, NULL, v_order.qty, 'allocate', 'order', v_order.order_id,
             p_actor, 'rack levels conversion — routing repoint');
    END LOOP;

    -- ── 5. Defuse any still-open putaway recommendation that targets the bare
    --      rack — it is no longer a placeable location on its own.
    UPDATE public.wie_putaway_recommendations
    SET status = 'expired'
    WHERE status = 'suggested' AND recommended_location_id = p_location_id;

    RETURN jsonb_build_object(
        'rack_id',            p_location_id,
        'level_location_ids', to_jsonb(v_level_ids),
        'l1_location_id',     v_l1_id,
        'units_moved',        v_units_moved
    );
END;
$$;

REVOKE ALL ON FUNCTION public.wie_convert_rack_to_levels_tx(INT,INT,JSONB,UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wie_convert_rack_to_levels_tx(INT,INT,JSONB,UUID) TO service_role;

COMMIT;

-- =============================================================================
-- Verify:
--   -- New columns exist:
--   SELECT column_name FROM information_schema.columns
--     WHERE table_name = 'storage_types' AND column_name IN ('has_levels','level_template');
--   SELECT column_name FROM information_schema.columns
--     WHERE table_name = 'locations' AND column_name IN ('level_role','level_index');
--   SELECT column_name FROM information_schema.columns
--     WHERE table_name = 'layout_placements' AND column_name = 'level_index';
--   SELECT column_name FROM information_schema.columns
--     WHERE table_name = 'product_wms_attributes' AND column_name = 'allowed_level_roles';
--
--   -- Backfilled forms (PALLET_RACK/SHELVING/COLD_ROOM has_levels=true with a
--   -- template summing back to the old default_capacity_slots; BULK_FLOOR/
--   -- STAGING/MAIN_* forms untouched, has_levels=false):
--   SELECT code, has_levels, level_template, default_capacity_slots FROM public.storage_types ORDER BY sort_order;
--
--   -- wie_putaway_candidates: no-role call still returns everything (and >200
--   -- rows for a big layout, proving the cap raise); a role filter narrows to
--   -- matching + NULL-role locations only:
--   SELECT count(*) FROM public.wie_putaway_candidates(<layout_id>, <product_id>);
--   SELECT location_id, level_role FROM public.wie_putaway_candidates(<layout_id>, <product_id>, 2000, ARRAY['bulk']);
--
--   -- wie_convert_rack_to_levels_tx, rollback-isolated against a REAL rack that
--   -- holds allocated stock (per memory/rollback-isolated-prod-sql-verification.md):
--   BEGIN;
--     SELECT public.wie_convert_rack_to_levels_tx(
--       <bin_location_id>, <layout_id>,
--       '[{"role":"pick","capacity_slots":2,"weight_capacity_kg":200},
--         {"role":"pick","capacity_slots":2,"weight_capacity_kg":200},
--         {"role":"pick","capacity_slots":2,"weight_capacity_kg":200},
--         {"role":"pick","capacity_slots":2,"weight_capacity_kg":200},
--         {"role":"bulk","capacity_slots":2,"weight_capacity_kg":200}]'::jsonb);
--     -- rack flipped to RACK, no placement of its own; 5 SHELF children exist:
--     SELECT kind FROM public.locations WHERE id = <bin_location_id>;
--     SELECT id, code, level_role, level_index FROM public.locations
--       WHERE parent_id = <bin_location_id> ORDER BY level_index;
--     SELECT location_id, level_index, access_offset_m FROM public.layout_placements
--       WHERE layout_id = <layout_id> AND location_id = ANY(
--         SELECT id FROM public.locations WHERE parent_id = <bin_location_id>)
--       ORDER BY level_index;
--     -- on_hand AND allocated both landed on L1, rack's own balance zeroed:
--     SELECT location_id, on_hand, allocated FROM public.inventory_balances
--       WHERE location_id IN (<bin_location_id>, <l1_location_id_from_result>);
--     -- matched transfer_out/transfer_in pair + any order-attributed re-point pair:
--     SELECT location_id, movement_type, qty_delta, ref_type, ref_id FROM public.inventory_movements
--       ORDER BY id DESC LIMIT 8;
--   ROLLBACK;
-- =============================================================================
