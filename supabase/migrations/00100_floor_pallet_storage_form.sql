-- =============================================================================
-- Floor storage — `is_floor`, and a Floor Pallet form that holds exactly one
-- Migration: 00100_floor_pallet_storage_form.sql
-- =============================================================================
-- One new column on `storage_types` and one new row in it (00056, extended by
-- 00061, 00072 and 00098). No RLS change, no engine change.
--
-- ── WHY A COLUMN, WHEN `has_levels` LOOKS LIKE IT ALREADY SAYS THIS ─────────
--
-- It doesn't, and the difference is load-bearing. `has_levels` means "this form
-- carries a standard level layout": mutate-storage-type's validateLevelTemplate
-- calls a non-empty `level_template` a SYSTEM INVARIANT of has_levels = true,
-- and StorageFormsView refuses to save the pair any other way.
--
-- So `has_levels = false` covers two unrelated states. On dev today:
--
--   MAIN_PALLET_BAY  "Pallet Rack Bay"    has_levels = false, no template
--   MAIN_SHELF_BAY   "Shelf Bay"          has_levels = false, no template
--   MAIN_COLD_BAY    "Cold Rack Bay"      has_levels = false, no template
--
-- That is racking — MAIN's 189 bays — and 00072 said so explicitly when it
-- backfilled the generic forms and left these alone: "only the reset-to-form
-- standard UI convenience and RackWizard's default-for-new-rack behaviour would
-- need an admin to configure has_levels/level_template on MAIN's own forms".
-- They are false because nobody has measured a template, not because a beam
-- cannot be hung. Reading them as "cannot be levelled" would take Split into
-- levels away from every bay on MAIN; setting has_levels = true instead would
-- violate the template invariant above and produce a row its own editor refuses
-- to save. Neither is acceptable, so the question needs its own answer.
--
-- `is_floor` is a fact about the world: the stock stands on the slab, and there
-- is no upright to hang a beam from. Nothing derives it and nothing infers it —
-- an operator sets it, the same way level roles and storage forms themselves
-- became operator-managed data. Its one consumer today is BinDetailPanel, which
-- stops offering to split such a bin into levels: that offer is an offer to
-- build something that cannot be built.
--
-- Backfilled true for the four forms that are already floors and nothing else.
-- STAGING is included — goods on a staging lane stand on the slab too.
--
-- ── WHAT WAS MISSING ────────────────────────────────────────────────────────
--
-- Amadiya's bulk areas in the middle of the floor, and its quarantine bays, are
-- painted rectangles on the slab. Each one holds ONE pallet. No racking, no
-- levels, no second tier. Nothing seeded could say that:
--
--   AMD_BULK / BULK_FLOOR  flat and pallet-denominated, but deliberately
--                          UNCOUNTED — `default_capacity_slots` NULL means "no
--                          slot ceiling", so putaway offers the area forever and
--                          never calls it full (00098's own words). Right for an
--                          unmeasured floor, wrong for a marked bay.
--   STAGING                flat and pallet, but 20 slots and a staging colour.
--   PALLET_RACK / AMD_RACK levelled. Drawing a bulk spot with one of these makes
--                          it a RACK parent with SHELF children, which is why
--                          the map offered to "split it into levels".
--
-- So the operator drew the only thing available, and the floor came back saying
-- racks. This is the missing denomination.
--
-- ── ONE POSITION, AND WHY THAT IS THE WHOLE DEFINITION ──────────────────────
--
-- `slot_unit = 'pallet'` with `default_capacity_slots = 1` is exactly one pallet
-- and the engine already enforces it, unchanged. `_shared/wie/capacity.ts`
-- charges a plate ONE position when the bin's slot_kind and the plate's hu_type
-- are both `pallet` (isUnitLoad, 00078) instead of `qty x size_factor`. So
-- scoring.ts's gate reads `0 + 1 > 1` for the first pallet (false — accepted) and
-- `1 + 1 > 1` for the second (true — refused, "needs 1.00 positions, 0.00 free").
--
-- That last part is the reason this cannot be spelled with an uncounted form: an
-- uncounted bin short-circuits the gate entirely and scores a flat 0.5 on
-- capacity_fit with the detail 'uncapped bin'. A bay that holds one pallet would
-- be offered a second, a third and a tenth.
--
-- ── FLAT, AND IT MUST STAY A FIXED POINT OF ITS OWN EDITOR ──────────────────
--
-- `levels` and `positions_per_level` are both omitted, so both are NULL. That is
-- load-bearing, and it is 00099's lesson restated: `capacityModeOf`
-- (lib/storageFormCapacity.ts) returns 'structured' only when BOTH are set, so
-- this row is a FLAT-capacity form. StorageFormsView therefore renders a flat
-- slots input and no Levels field, and its buildPatch sends `levels: null` — so a
-- row seeded with, say, `levels = 1` would have that 1 silently dropped by the
-- first save of any unrelated field. A seeded row must survive a round trip
-- through the screen that edits it.
--
-- Note `1 x 1 = 1` would satisfy 00073's invariant, so structured is expressible
-- here. It is still not used: it would put a Levels input on a form whose entire
-- meaning is that it has none.
--
-- `has_levels = false` is what keeps a drawn cell a flat BIN rather than fanning
-- out into SHELF rows (00098:142), and it is what the designer now reads to stop
-- offering to split one into levels.
--
-- `weight_capacity_kg` is NULL and stays NULL, for 00098's reason: a concrete
-- slab has no rated UDL, and 00061's weight gate fails OPEN on a null limit.
-- =============================================================================

-- ── 1. `is_floor` ────────────────────────────────────────────────────────────
ALTER TABLE public.storage_types
    ADD COLUMN IF NOT EXISTS is_floor BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.storage_types.is_floor IS
    'Stock stands on the slab: there is no upright to hang a beam from, so a bin '
    'of this form can never be split into addressable levels. Distinct from '
    'has_levels, which means "carries a standard level layout" and is false on '
    'plenty of real racking that simply has no template yet.';

-- The forms that are already floors. Deliberately explicit rather than derived
-- from slot_unit or a null capacity: both of those are true of things that are
-- not floors, and a wrong guess here silently removes a real capability.
UPDATE public.storage_types
   SET is_floor = true
 WHERE code IN ('BULK_FLOOR', 'MAIN_BULK_FLOOR', 'AMD_BULK', 'STAGING');

-- ── 2. FLOOR_PALLET ──────────────────────────────────────────────────────────
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
    has_levels,
    is_floor
)
SELECT
    'FLOOR_PALLET',
    'Floor Pallet',
    1,                    -- one pallet. See "ONE POSITION" above.
    'pallet',
    '{}'::jsonb,
    18,
    NULL,                 -- a slab has no rated UDL
    '#84cc16',            -- lime, distinct from AMD_BULK's orange floor
    true,
    false,
    true
WHERE NOT EXISTS (
    SELECT 1 FROM public.storage_types s WHERE s.code = 'FLOOR_PALLET'
);

-- =============================================================================
-- Done. It becomes a drawable tool in the Layout Designer palette automatically
-- (every is_drawable form does) and is available to every warehouse —
-- storage_types is not warehouse-scoped. Nothing is drawn with it, and no
-- existing form, layout or location is touched.
--
-- Not Amadiya-specific on purpose: "a marked floor spot that holds one pallet"
-- is a denomination any site has, and the catalogue is shared.
--
-- Verify:
--   SELECT code, levels, positions_per_level, default_capacity_slots, slot_unit,
--          weight_capacity_kg, has_levels, is_floor, is_drawable
--     FROM public.storage_types ORDER BY is_floor DESC, sort_order;
--   -- is_floor true for exactly: BULK_FLOOR, MAIN_BULK_FLOOR, AMD_BULK,
--   -- STAGING, FLOOR_PALLET. Every MAIN_*_BAY stays false and keeps its
--   -- Split into levels action.
-- =============================================================================
