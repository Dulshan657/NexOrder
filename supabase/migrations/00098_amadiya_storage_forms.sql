-- =============================================================================
-- Amadiya's storage forms — a mixed-unit rack bay, and its bulk floor
-- Migration: 00098_amadiya_storage_forms.sql
-- =============================================================================
-- Data only: two new rows in the `storage_types` catalogue (00056, extended with
-- capacity/dims/colour by 00061 and with levels by 00072). No schema change, no
-- RLS change, no new level role, no new zone profile.
--
-- Why a migration rather than clicks in Settings -> Warehouse -> Storage Forms:
-- the same reason 00073 gives. The UI can create both rows end to end
-- (StorageFormsView -> mutate-storage-type), but a hand-typed row is absent from
-- a fresh database. Amadiya is being stood up on DEV while prod does not yet
-- exist (config/environments.mjs -> ENVIRONMENTS.prod.projectRef is null), so
-- every form built by hand now is work to be redone by hand later. Seeding it
-- here is the standing answer to WAREHOUSE-ONBOARDING-PLAN.md's M4.
--
-- These forms must exist BEFORE any rack is drawn. A rack's capacity is derived
-- from its form at draw time (mutate-layout `save_geometry`), so drawing first
-- produces bins with the wrong capacity and no way to notice.
--
-- ── THE RACKING, AS MEASURED ─────────────────────────────────────────────────
--
--   5 levels, 1.2 m pitch (top beam ~4.8 m) · 2.7 m bay · 1.0 m frame depth
--   1 tonne per level, TOTAL — L4/L5's two pallet positions share it
--   L1-L3  cartons, hand-picked   -> the PICK ZONE
--   L4-L5  2 pallet positions each -> reserve and bulk
--
-- ── ONE BAY, TWO SLOT UNITS. This is the point of the form. ──────────────────
--
-- `slot_kind` picks the fill formula (_shared/wie/capacity.ts): loose stock
-- consumes `qty x products.size_factor` slots, while stock on a handling unit
-- consumes exactly ONE position per plate (00078). Those are different
-- arithmetics, and a pallet position labelled `carton` reads a 130-unit pallet
-- as 130 slots against a limit of 2 — which is verbatim the bug 00078 was
-- written to stop, back when it made the engine believe 17 of WIE-DEMO's 36 bins
-- were over capacity while each held exactly one pallet.
--
-- A form has ONE `slot_unit`, so until now every level of every rack drawn with
-- it inherited that single value and a mixed bay was inexpressible. The template
-- entry now carries its own `slot_kind` (mutate-storage-type's
-- levelTemplateEntrySchema, lib/adapters.ts toRackLevelTemplate,
-- services/supabase/storageTypeService.ts toLevelTemplateColumn, and the new
-- control in components/warehouse/levels/RackLevelEditor.tsx). It is nullable
-- and every pre-existing template omits it, so they all keep inheriting exactly
-- as before. AMD_RACK's `slot_unit` below is therefore a FALLBACK ONLY — every
-- level names its own.
--
-- ── NO LEVEL ROLES ARE ADDED, AND THAT IS DELIBERATE ─────────────────────────
--
-- The seeded vocabulary (00081) already fits this rack exactly:
--   pick     hu_types ['carton'], is_pick_zone            -> L1, L2, L3
--   reserve  hu_types ['pallet'], replen_source_rank 1    -> L4
--   bulk     hu_types ['pallet'], replen_source_rank 2    -> L5
-- Pallets are steered to L4/L5 and cartons to the pick zone by `rolesForHuType`
-- with no edit at all, and replenishment draws L4 before L5. `level_roles` is
-- GLOBAL, so leaving it alone is also what leaves MAIN and WIE-DEMO untouched.
-- Do not "fix" this by adding a pallet-pick role.
--
-- ── TWO NUMBERS THAT LOOK WRONG AND ARE NOT ──────────────────────────────────
--
--   1. `positions_per_level` is NULL, on purpose.
--      00073's invariant 1 (levels x positions_per_level = default_capacity_slots)
--      presumes ONE slot unit per rack. It cannot hold for a mixed bay: 112 is
--      not divisible by 5, and there is no honest integer to write. So the form
--      reports as FLAT capacity (lib/storageFormCapacity.ts `capacityModeOf`
--      returns 'flat' unless BOTH levels and positions_per_level are set), with
--      112 as the manual count. `levels` stays 5 because it is true.
--
--      Invariant 2 is the one that matters here and it holds:
--        sum(level capacity) = 36+36+36+2+2 = 112 = default_capacity_slots
--        sum(level weight)   = 5 x 1000     = 5000 = weight_capacity_kg
--      Per-level figures are MANDATORY, not decorative: mutate-layout falls back
--      to the form's WHOLE-UNIT figures for any level that omits its own, which
--      would give each of the five levels 112 slots and 5000 kg.
--
--   2. 36 carton slots per pick level is DERIVED, and is the figure to revisit.
--      Reference carton 400 x 300 mm on a 2.7 x 1.0 m level packs 18 per layer
--      either way round (6 x 3 along the beam, or 9 x 2 rotated). 36 is TWO
--      layers. The 1.2 m clear height would take four, but four-high hand
--      stacking is not a pick zone anyone works, and the weight limit binds
--      first at anything over ~14 kg a carton.
--
--      Per-SKU sizing rides on `products.size_factor`, which scales against that
--      reference: a 600 x 400 carton is size_factor 2. Until the catalogue
--      import populates it every SKU defaults to 1.0 and these levels
--      over-report their remaining space. Setting size_factor is a REQUIRED step
--      of the catalogue import, not an optimisation — see
--      docs/runbooks/amadiya-warehouse-setup.md.
--
-- level_template is POSITIONAL — array index + 1 is the level_index, and L1 is
-- the BOTTOM level (`toRackLevelTemplate` in lib/adapters.ts).
-- =============================================================================

-- ── 1. AMD_RACK — the racking, 5 levels, mixed units ─────────────────────────
INSERT INTO public.storage_types (
    code,
    name,
    default_capacity_slots,
    slot_unit,
    attributes,
    sort_order,
    levels,
    positions_per_level,
    weight_capacity_kg,
    length_cm,
    width_cm,
    height_cm,
    color,
    is_drawable,
    has_levels,
    level_template
)
SELECT
    'AMD_RACK',
    'Amadiya Rack',
    112::numeric,         -- = sum of the level shares below (invariant 2)
    'carton',             -- FALLBACK ONLY; every level names its own slot_kind
    '{}'::jsonb,
    16,                   -- immediately after RACK (15), before SHELVING (20)
    5,
    NULL,                 -- see "positions_per_level is NULL, on purpose" above
    5000::numeric,        -- whole-rack total = 5 x 1000 kg (invariant 2)
    270, 100, 600,        -- 2.7 m bay x 1.0 m deep x ~6.0 m frame, in cm
    '#e11d48',            -- rose; unused by any existing form or object fill
    true,
    true,
    jsonb_build_array(
        -- L1-L3: the pick zone. Cartons, hand-picked, replenished from above.
        jsonb_build_object('role', 'pick',    'slot_kind', 'carton', 'capacity_slots', 36, 'weight_capacity_kg', 1000),
        jsonb_build_object('role', 'pick',    'slot_kind', 'carton', 'capacity_slots', 36, 'weight_capacity_kg', 1000),
        jsonb_build_object('role', 'pick',    'slot_kind', 'carton', 'capacity_slots', 36, 'weight_capacity_kg', 1000),
        -- L4-L5: 2 pallet positions each. One plate = one position (00078), so
        -- the capacity is 2 whatever is on the pallets.
        jsonb_build_object('role', 'reserve', 'slot_kind', 'pallet', 'capacity_slots', 2,  'weight_capacity_kg', 1000),
        jsonb_build_object('role', 'bulk',    'slot_kind', 'pallet', 'capacity_slots', 2,  'weight_capacity_kg', 1000)
    )
WHERE NOT EXISTS (
    SELECT 1 FROM public.storage_types s WHERE s.code = 'AMD_RACK'
);

-- ── 2. AMD_BULK — the floor-stacked area in the middle of the building ───────
-- No levels: floor stack is one plane, and `has_levels = false` is what keeps it
-- a flat BIN rather than fanning out into SHELF rows.
--
-- `default_capacity_slots` is NULL — uncounted — because the number of pallet
-- positions the floor holds has not been measured yet. NULL means "no slot
-- ceiling": putaway will offer this area forever and never call it full. That is
-- the honest state before the measurement and the wrong state after it, so the
-- runbook carries setting it as a step. Edit it in Settings -> Warehouse ->
-- Storage Forms; it needs no migration.
--
-- `weight_capacity_kg` is NULL and stays NULL: a concrete slab has no rated UDL,
-- and 00061's weight gate fails OPEN on a null limit, which is correct here.
INSERT INTO public.storage_types (
    code,
    name,
    default_capacity_slots,
    slot_unit,
    attributes,
    sort_order,
    weight_capacity_kg,
    color,
    is_drawable,
    has_levels
)
SELECT
    'AMD_BULK',
    'Amadiya Bulk Floor',
    NULL,                 -- uncounted until the floor is measured (see above)
    'pallet',
    '{}'::jsonb,
    17,
    NULL,
    '#f97316',            -- orange
    true,
    false
WHERE NOT EXISTS (
    SELECT 1 FROM public.storage_types s WHERE s.code = 'AMD_BULK'
);

-- =============================================================================
-- Done. Both forms become drawable tools in the Layout Designer palette (any
-- is_drawable form does, automatically) and are available to every warehouse —
-- storage_types is not warehouse-scoped. Nothing is drawn with them yet, no
-- existing form, layout or location is touched, and no zone profile is created:
-- Amadiya is ambient-only, so the seeded 'Fast Moving' and 'Bulk Storage'
-- profiles serve, and creating a site-specific one would mean editing
-- allowed_categories on a row WIE-DEMO shares.
--
-- Verify:
--   SELECT code, levels, positions_per_level, default_capacity_slots, slot_unit,
--          weight_capacity_kg, has_levels, jsonb_pretty(level_template)
--     FROM public.storage_types WHERE code IN ('AMD_RACK','AMD_BULK');
-- =============================================================================
