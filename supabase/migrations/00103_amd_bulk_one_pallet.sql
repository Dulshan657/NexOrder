-- =============================================================================
-- Amadiya Bulk Floor — one cell, one pallet, and the name says so
-- Migration: 00103_amd_bulk_one_pallet.sql
-- =============================================================================
-- No new column, no new row, no function. One form's capacity, the units already
-- drawn with it, and one stuck name. `00100` is applied and checksummed, so this
-- is a fix FORWARD rather than an edit of it.
--
-- ── WHAT 00100 GOT RIGHT, AND WHAT IT GOT BACKWARDS ─────────────────────────
--
-- 00100 read Amadiya's bulk and quarantine spaces correctly — painted rectangles
-- on the slab, one pallet each — and concluded that nothing seeded could say so,
-- because AMD_BULK is UNCOUNTED. It seeded a generic `FLOOR_PALLET` for the job.
--
-- The floor had already answered differently. Measured on dev before writing
-- this: all 23 of those cells are ALREADY `AMD_BULK` — 21 under `Bulk Storage`,
-- 2 under `Quarantine` — and nothing is drawn with FLOOR_PALLET at all. What is
-- wrong is not which form the operator picked; it is that the form they picked
-- has no ceiling, so a marked one-pallet spot is stored as a bin that can be
-- offered a second pallet, a third and a tenth. That is 00100's own argument,
-- pointed at the form that is actually in use.
--
-- So AMD_BULK becomes counted at ONE, which is the whole definition (00100:60):
-- `slot_unit = 'pallet'` with `default_capacity_slots = 1` is exactly one pallet
-- and the engine already enforces it unchanged — `_shared/wie/capacity.ts`
-- charges a plate ONE position when bin and plate are both `pallet` (00078), so
-- scoring.ts reads `0 + 1 > 1` for the first (accepted) and `1 + 1 > 1` for the
-- second (refused). An uncounted bin short-circuits that gate entirely and
-- scores a flat 0.5 with the detail 'uncapped bin'.
--
-- FLOOR_PALLET is deliberately left in place, drawable and unused. "A marked
-- spot that holds one pallet" is a denomination any site has and the catalogue
-- is shared; the two rows are now near-twins by name only.
--
-- ── THE CONSEQUENCE, STATED ─────────────────────────────────────────────────
--
-- Amadiya's bulk floor gains a real ceiling of 21 pallet positions and its
-- quarantine 2. Putaway will now call the floor FULL, which it has never done.
-- That is the point of counting it, and it is why the figure was worth deciding
-- rather than defaulting: at 2.70 m/cell a drawn cell is 7.3 m² of slab, so the
-- CELL is a drawing unit and the ONE is the operator's decision about how the
-- floor is marked out.
--
-- ── AND THE NAME ────────────────────────────────────────────────────────────
--
-- `Quarantine · Rack 2` is a lie about a pallet on a slab, and it is the only
-- one left: its 22 siblings read `· Pallet`. 1d588d6 made `unitNoun` call a
-- pallet-denominated floor a Pallet and `assignAutoNames` recompose on every
-- pass — but the only passes that RUN are `save_geometry` (drafts only) and the
-- opt-in area cascades, which touch only units whose area moved. On a published
-- layout nothing restamps a name after its form changes.
--
-- The ledger and the layouts say exactly how one bin got left behind. All 23
-- were drawn at 01:45, when `is_floor` did not yet exist (00100 applied 03:09),
-- so every one of them was named `· Rack N`. The draft copies saved afterwards
-- each ran a naming pass and restamped what they CONTAINED — and the draft
-- carries 1 of the 2 quarantine cells. The other exists only on the published
-- layout, where no pass has ever reached it. A restamp must therefore follow the
-- FORM's units, not a layout's.
--
-- The code half of that gap is closed in `mutate-storage-type` alongside this
-- file, which is also the UI route to everything below ("Apply to all existing
-- units"); this migration is the half that does not wait for a click.
--
-- Recomposed from the STORED columns, never parsed out of the old name: the pool
-- (`name_area`) and the number (`name_seq`) are columns precisely because an
-- area name is free text that may itself contain ` · Rack ` (00094). `IS
-- DISTINCT FROM` makes it a no-op on the 22 that are already right.
-- =============================================================================

-- ── 1. The form ──────────────────────────────────────────────────────────────
-- `slot_unit` (pallet) and `is_floor` (true, from 00100) are already correct and
-- are deliberately not restated: a migration that re-asserts fields it has no
-- opinion about is a migration that silently reverts someone's edit.
UPDATE public.storage_types
   SET default_capacity_slots = 1
 WHERE code = 'AMD_BULK';

-- ── 2. The units already drawn with it ───────────────────────────────────────
-- The retro-apply `mutate-storage-type` performs for "Apply to all existing
-- units", done here so it cannot be forgotten. Scoped to BIN: AMD_BULK is
-- `has_levels = false`, so there is no RACK-parent/SHELF split to make (00072) —
-- and if one ever appeared, giving every level the whole unit's figure is the
-- exact bug that split exists to prevent.
--
-- `slot_kind` is NOT written. All 23 already read `pallet`, and the flat
-- retro-apply path in mutate-storage-type does not write it either; adding it
-- here alone would make the migration and the button disagree about what
-- "apply the form" means.
UPDATE public.locations l
   SET capacity_slots = 1
  FROM public.storage_types s
 WHERE s.id = l.storage_type_id
   AND s.code = 'AMD_BULK'
   AND l.kind = 'BIN'
   AND l.capacity_slots IS DISTINCT FROM 1;

-- ── 3. The one stuck name ────────────────────────────────────────────────────
-- 'Pallet' is `PALLET_WORD` and ' · ' is `NAME_SEP` (_shared/wie/locationNaming
-- .ts). The literal is guarded rather than assumed: the join re-checks that this
-- form really IS a pallet-denominated floor, which is the whole of `unitNoun`.
-- If someone has since made it something else, this becomes a no-op instead of
-- stamping the wrong word on 23 bins.
--
-- Only `name_is_auto` rows, and only those carrying a number. A hand-typed name
-- is untouchable and has no `name_seq` to compose with (00094) — the same guard
-- assignAutoNames applies first, for the same reason.
UPDATE public.locations l
   SET name = CASE
                WHEN COALESCE(NULLIF(BTRIM(l.name_area), ''), '') = ''
                  THEN 'Pallet ' || l.name_seq::text
                ELSE l.name_area || ' · Pallet ' || l.name_seq::text
              END
  FROM public.storage_types s
 WHERE s.id = l.storage_type_id
   AND s.code = 'AMD_BULK'
   AND s.is_floor
   AND s.slot_unit = 'pallet'
   AND l.kind = 'BIN'
   AND l.name_is_auto
   AND l.name_seq IS NOT NULL
   AND l.name IS DISTINCT FROM CASE
                                 WHEN COALESCE(NULLIF(BTRIM(l.name_area), ''), '') = ''
                                   THEN 'Pallet ' || l.name_seq::text
                                 ELSE l.name_area || ' · Pallet ' || l.name_seq::text
                               END;

-- =============================================================================
-- Done. `locations.code` is untouched everywhere above — it is the QR payload,
-- the scan identity and a `materialized_path` segment (00094), and none of those
-- may move for a spelling fix or a capacity decision. No stock moves: every one
-- of these 23 bins was empty when this was written, and capacity is a ceiling
-- read at putaway rather than a quantity.
--
-- Verify:
--   SELECT code, name, default_capacity_slots, slot_unit, is_floor
--     FROM public.storage_types WHERE code IN ('AMD_BULK', 'FLOOR_PALLET');
--   -- AMD_BULK: 1 / pallet / true. FLOOR_PALLET unchanged at 1 / pallet / true.
--
--   SELECT l.name, l.capacity_slots, l.slot_kind
--     FROM public.locations l JOIN public.storage_types s ON s.id = l.storage_type_id
--    WHERE s.code = 'AMD_BULK' ORDER BY l.name_area, l.name_seq;
--   -- 23 rows, every capacity_slots = 1, every name '<area> · Pallet <n>',
--   -- none containing ' · Rack '.
-- =============================================================================
