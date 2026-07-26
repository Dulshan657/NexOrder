-- =============================================================================
-- Level roles become operator-managed data ("Pick face" -> "Pick Zone")
-- Migration: 00081_level_roles.sql
-- =============================================================================
-- A rack level carries a ROLE. Since 00072 that role has been a bare TEXT
-- column with an inline CHECK pinning it to exactly ('pick','reserve','bulk'),
-- and the same three values were then re-hardcoded in ~11 more places: a
-- plpgsql RAISE, two duplicate TS unions, three zod enums, four LEVEL_ROLES
-- arrays and two colour/label maps. Renaming "Pick face" to "Pick Zone" meant
-- editing six screens, and an operator could not add a role at all.
--
-- This migration makes the list data, following the precedent set by mig 00057
-- for zone types: drop the CHECK, put the vocabulary in a table, let an Edge
-- Function own the writes.
--
-- The STORED KEY DOES NOT CHANGE. locations.level_role still holds 'pick'.
-- Only its display_name is 'Pick Zone'. There is no data migration here and
-- nothing that reads the key needs to change to keep working.
--
-- The table carries four things that used to be code:
--   * display_name / colours  -- were RackLevelEditor.tsx + layoutPalette.ts
--   * hu_types                -- was ROLES_BY_HU_TYPE in _shared/putawayTasks.ts
--   * is_pick_zone            -- new: replenishment destination (mig 00082) and
--                                the inv_reserve_order preference (mig 00083)
--   * replen_source_rank      -- new: which roles feed a pick zone, in order
--
-- Why is_pick_zone + replen_source_rank rather than reusing sort_order as a
-- ladder: with a ladder, an operator adding "Quarantine" below Bulk would
-- silently make it a replenishment source. Two explicit knobs cannot be broken
-- by adding a role.
--
-- Contents:
--   1. level_roles table + seed + RLS
--   2. locations.level_role: drop the CHECK, add the FK (NULL still = legacy)
--   3. wie_convert_rack_to_levels_tx -- role check reads the table
--   4. wie_level_role_usage -- the only defence for the two references that
--      live outside a column and can never have an FK
--
-- Additive. Idempotent. Backward-compatible: the three keys still validate, so
-- un-redeployed Edge Functions keep working through the deploy window.
-- Apply via the Management API (see CLAUDE.md); do not run interactively.
--
-- PRE-FLIGHT (must pass before applying):
--   SELECT DISTINCT level_role FROM public.locations;
--     -- must return only {NULL, pick, reserve, bulk}, or the FK below fails.
-- =============================================================================

BEGIN;

-- ── 1. The vocabulary table ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.level_roles (
    key                TEXT PRIMARY KEY,
    display_name       TEXT    NOT NULL,
    description        TEXT,
    color_fill         TEXT    NOT NULL DEFAULT '#e7e5e4',
    color_stroke       TEXT    NOT NULL DEFAULT '#78716c',
    color_text         TEXT,
    sort_order         INT     NOT NULL DEFAULT 100,
    -- Replaces ROLES_BY_HU_TYPE. Stored on the ROLE ("which plate types belong
    -- here"), not on the plate type, so adding a role needs no code change.
    -- Deliberately NO element CHECK: that would re-introduce exactly the
    -- hardcoding this migration removes. mutate-level-role validates it.
    hu_types           TEXT[]  NOT NULL DEFAULT '{}',
    -- Replenishment DESTINATION (00082) + inv_reserve_order preference (00083).
    is_pick_zone       BOOLEAN NOT NULL DEFAULT false,
    -- Replenishment SOURCE order. NULL = never a source. 1 = try first.
    replen_source_rank INT,
    -- Seeded roles: undeletable, key un-editable. Note this protects DELETION,
    -- not SEMANTICS -- clearing is_pick_zone on 'pick' is still possible, and is
    -- blocked in mutate-level-role, not here.
    is_system          BOOLEAN NOT NULL DEFAULT false,
    is_active          BOOLEAN NOT NULL DEFAULT true,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by         UUID REFERENCES public.profiles(id),
    CONSTRAINT level_roles_rank_check
        CHECK (replen_source_rank IS NULL OR replen_source_rank > 0)
);

COMMENT ON TABLE  public.level_roles IS
    'Operator-managed rack level roles. key is the stored value in locations.level_role and never changes; display_name is what operators see.';
COMMENT ON COLUMN public.level_roles.hu_types IS
    'Handling-unit types that prefer this role during putaway. Replaces the hardcoded ROLES_BY_HU_TYPE map. Set membership, not order.';
COMMENT ON COLUMN public.level_roles.is_pick_zone IS
    'Replenishment destination and the bin preference used by inv_reserve_order. At least one active role must have this set.';
COMMENT ON COLUMN public.level_roles.replen_source_rank IS
    'Order in which this role is drawn from to refill a pick zone. NULL = never a source.';

CREATE INDEX IF NOT EXISTS idx_level_roles_sort
    ON public.level_roles(sort_order, key) WHERE is_active;

-- Seed. Colours lifted verbatim from components/admin/layout/layoutPalette.ts
-- (LEVEL_ROLE_FILL / LEVEL_ROLE_STROKE) so nothing changes visually on day one.
INSERT INTO public.level_roles
    (key, display_name, description, color_fill, color_stroke, sort_order,
     hu_types, is_pick_zone, replen_source_rank, is_system)
VALUES
    ('pick',    'Pick Zone', 'Working height. Pickers draw from here; replenishment keeps it stocked.',
     '#a7f3d0', '#059669', 10, ARRAY['carton'], true,  NULL, true),
    ('reserve', 'Reserve',   'Replenishment buffer directly above the pick zone.',
     '#c7d2fe', '#4f46e5', 20, ARRAY['pallet'], false, 1,    true),
    ('bulk',    'Bulk',      'Overstock. Drawn from only once reserve is empty.',
     '#fde68a', '#d97706', 30, ARRAY['pallet'], false, 2,    true)
ON CONFLICT (key) DO NOTHING;

-- RLS: read-only for ops; writes go through mutate-level-role (service_role).
-- Mirrors zone_profiles (00047:143-147).
ALTER TABLE public.level_roles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "level_roles_select_ops" ON public.level_roles;
CREATE POLICY "level_roles_select_ops" ON public.level_roles FOR SELECT TO authenticated
    USING ((SELECT public.user_role()) IN ('Admin','Manager','Warehouse'));
GRANT SELECT ON public.level_roles TO authenticated;

-- ── 2. locations.level_role: CHECK -> FK ─────────────────────────────────────
-- The FK preserves the NULL = legacy/unconstrained semantic FOR FREE: Postgres
-- never enforces a foreign key on a NULL child value. Every pre-00072 bin stays
-- exactly as eligible as it is today.
--
-- The CHECK was declared inline at 00072:91, so it carries Postgres's generated
-- name. Drop it by that name, then sweep pg_constraint defensively in case an
-- environment generated a different one (the 00057 pattern).
ALTER TABLE public.locations DROP CONSTRAINT IF EXISTS locations_level_role_check;

DO $$
DECLARE con_name TEXT;
BEGIN
    FOR con_name IN
        SELECT c.conname
        FROM pg_constraint c
        JOIN pg_class     t ON t.oid = c.conrelid
        JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE n.nspname = 'public'
          AND t.relname = 'locations'
          AND c.contype = 'c'
          AND pg_get_constraintdef(c.oid) LIKE '%level_role%'
    LOOP
        EXECUTE format('ALTER TABLE public.locations DROP CONSTRAINT %I', con_name);
    END LOOP;
END $$;

-- FK child columns are NOT auto-indexed. Needed for the ON DELETE RESTRICT
-- lookup and for 00082's replenishment source scan.
CREATE INDEX IF NOT EXISTS idx_locations_level_role
    ON public.locations(level_role) WHERE level_role IS NOT NULL;

-- ON UPDATE CASCADE is a safety net only -- mutate-level-role forbids key edits
-- outright, because a cascade would rewrite locations under a lock.
-- ON DELETE RESTRICT is the second net behind is_system.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'locations_level_role_fkey' AND conrelid = 'public.locations'::regclass
    ) THEN
        ALTER TABLE public.locations
            ADD CONSTRAINT locations_level_role_fkey
            FOREIGN KEY (level_role) REFERENCES public.level_roles(key)
            ON UPDATE CASCADE ON DELETE RESTRICT;
    END IF;
END $$;

-- ── 3. wie_convert_rack_to_levels_tx -- role check reads the table ───────────
-- Signature UNCHANGED (INT,INT,JSONB,UUID), so CREATE OR REPLACE genuinely
-- replaces rather than creating an overload. Do NOT add a DROP here.
-- The body is 00072's verbatim, with exactly one hunk changed: the role
-- validation at 00072:363. The FK would reject a bad role at INSERT anyway, but
-- with an unreadable message -- and the FK cannot enforce is_active, which this
-- does.
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
        -- CHANGED in 00081: the role vocabulary is now a table, not a literal.
        IF v_role IS NULL OR NOT EXISTS (
            SELECT 1 FROM public.level_roles r WHERE r.key = v_role AND r.is_active
        ) THEN
            RAISE EXCEPTION 'INVALID_LEVEL_ROLE: level % has role % (not an active level role)',
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
        -- 0.5 is the canonical step -- see _shared/wie/levelGeometry.ts, which
        -- 00081's Edge Function wave makes the single definition.
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

-- ── 4. wie_level_role_usage -- what the FK cannot protect ────────────────────
-- Two references to a role key live outside a column, so NO constraint can
-- guard them: Postgres has no array-element FK and none for a JSONB field.
--   * product_wms_attributes.allowed_level_roles TEXT[]
--   * storage_types.level_template JSONB  ([{role, ...}] positional)
-- mutate-level-role refuses a delete unless all four counts are zero, and the
-- admin UI renders them. This function is that single definition.
CREATE OR REPLACE FUNCTION public.wie_level_role_usage(p_key TEXT)
RETURNS JSONB
LANGUAGE sql
STABLE
SET search_path = public
AS $$
    SELECT jsonb_build_object(
        'locations',   (SELECT count(*) FROM public.locations WHERE level_role = p_key),
        'sku_rules',   (SELECT count(*) FROM public.product_wms_attributes
                         WHERE allowed_level_roles && ARRAY[p_key]),
        'form_levels', (SELECT count(*) FROM public.storage_types st
                         WHERE st.level_template @> jsonb_build_array(jsonb_build_object('role', p_key))),
        'home_bins',   (SELECT count(*) FROM public.product_home_bins hb
                         JOIN public.locations l ON l.id = hb.bin_id
                         WHERE l.level_role = p_key)
    );
$$;

REVOKE ALL ON FUNCTION public.wie_level_role_usage(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wie_level_role_usage(TEXT) TO service_role;

COMMIT;

-- =============================================================================
-- Verify:
--   SELECT key, display_name, hu_types, is_pick_zone, replen_source_rank, is_system
--     FROM public.level_roles ORDER BY sort_order;
--     -- expect pick/Pick Zone/{carton}/t/NULL/t, reserve/.../1/t, bulk/.../2/t
--
--   -- The CHECK is gone and the FK is in place:
--   SELECT conname, contype FROM pg_constraint
--    WHERE conrelid = 'public.locations'::regclass
--      AND pg_get_constraintdef(oid) LIKE '%level_role%';
--     -- expect exactly one row: locations_level_role_fkey / 'f'
--
--   -- NULL level_role still accepted (the legacy-bin semantic survived):
--   BEGIN;
--     UPDATE public.locations SET level_role = NULL WHERE level_role = 'pick';
--     -- expect: UPDATE n, no FK violation
--   ROLLBACK;
--
--   -- A bogus role is refused:
--   BEGIN;
--     UPDATE public.locations SET level_role = 'nope' WHERE id = (
--       SELECT id FROM public.locations WHERE level_role IS NOT NULL LIMIT 1);
--     -- expect: violates foreign key constraint "locations_level_role_fkey"
--   ROLLBACK;
--
--   -- No overload was created:
--   SELECT proname, count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--    WHERE n.nspname = 'public' AND proname = 'wie_convert_rack_to_levels_tx' GROUP BY proname;
--     -- expect exactly 1
--
--   SELECT public.wie_level_role_usage('pick');
-- =============================================================================
