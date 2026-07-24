-- =============================================================================
-- Seed the "Rack" storage form — a 4-level addressable rack counted in cartons
-- Migration: 00073_storage_form_rack.sql
-- =============================================================================
-- Data only: one new row in the `storage_types` catalogue (mig 00056, extended
-- with capacity/dims/colour by 00061 and with levels by 00072). No schema
-- change, no RLS change.
--
-- Why a migration rather than a click in Settings → Warehouse → Storage Forms:
-- the UI can already create this exact row end to end (StorageFormsView →
-- mutate-storage-type), but a hand-typed prod row would be absent from a fresh
-- database. Seeding it here makes the catalogue reproducible everywhere.
--
-- Being drawable + has_levels, every rack painted with this form fans out at
-- save time (mutate-layout `save_geometry`) into a parent `locations` row of
-- kind RACK — which carries NO capacity and NO placement row of its own, per
-- 00072's load-bearing decision — plus one SHELF child + one co-located
-- layout_placements row per level. Putaway then routes per level by role.
--
-- ── TWO INVARIANTS. Both must hold if these numbers are ever edited ──────────
--
--   1. levels × positions_per_level = default_capacity_slots
--        4 × 24 = 96.  `lib/storageFormCapacity.ts` derives the structured
--        capacity this way; a mismatch makes the Storage Forms editor show a
--        different figure than the row stores.
--
--   2. Σ level_template capacity_slots = default_capacity_slots, and
--      Σ level_template weight_capacity_kg = weight_capacity_kg
--        4 × 24 = 96 slots and 4 × 1000 = 4000 kg.  This is the convention
--        00072's backfill established (per-level share = whole-unit ÷ N) and
--        the invariant CapacityAdvisor reports against.
--
-- Per-level capacity_slots / weight_capacity_kg are MANDATORY here, not
-- decorative: mutate-layout/index.ts falls back to the form's WHOLE-UNIT
-- figures for any level that omits its own, so a template without them would
-- give each of the 4 levels 96 slots (384 per rack) and 4000 kg.
--
-- level_template is POSITIONAL — array index + 1 is the level_index, and L1 is
-- the BOTTOM level (see `toRackLevelTemplate` in lib/adapters.ts). Roles run
-- pick, pick, reserve, bulk from the floor up: two pick faces at working
-- height, a replenishment buffer above them, overstock on top. The per-level
-- travel penalty (ACCESS_OFFSET_STEP_M) already makes the engine prefer the
-- lower levels, so pickers stay low without any scoring change.
-- =============================================================================

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
    'RACK',
    'Rack',
    96::numeric,          -- = levels × positions_per_level (invariant 1)
    'carton',
    '{}'::jsonb,
    15,                   -- after PALLET_RACK (10) and MAIN's bays (10–13), before SHELVING (20)
    4,
    24,
    4000::numeric,        -- whole-rack total = Σ level shares (invariant 2)
    NULL, NULL, NULL,     -- physical dims are display-only; unset until measured
    '#14b8a6',            -- teal; unused by any existing form or layout object fill
    true,
    true,
    jsonb_build_array(
        jsonb_build_object('role', 'pick',    'capacity_slots', 24, 'weight_capacity_kg', 1000),  -- L1 bottom pick face
        jsonb_build_object('role', 'pick',    'capacity_slots', 24, 'weight_capacity_kg', 1000),  -- L2 pick face
        jsonb_build_object('role', 'reserve', 'capacity_slots', 24, 'weight_capacity_kg', 1000),  -- L3 replen buffer
        jsonb_build_object('role', 'bulk',    'capacity_slots', 24, 'weight_capacity_kg', 1000)   -- L4 overstock
    )
WHERE NOT EXISTS (
    SELECT 1 FROM public.storage_types s WHERE s.code = 'RACK'
);

-- =============================================================================
-- Done. Nothing is drawn with this form yet — it becomes a teal tool in the
-- Layout Designer palette (any is_drawable form does, automatically) and is
-- available to every warehouse. MAIN's own four bay forms are untouched and
-- deliberately stay has_levels = false, exactly as 00072 left them.
-- =============================================================================
