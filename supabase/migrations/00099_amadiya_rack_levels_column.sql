-- =============================================================================
-- AMD_RACK: clear `storage_types.levels`, which the editor would clear anyway
-- Migration: 00099_amadiya_rack_levels_column.sql
-- =============================================================================
-- One UPDATE, one row. 00098 is applied and checksummed, so this edits forward
-- rather than changing its bytes.
--
-- 00098 seeded AMD_RACK with `levels = 5` and `positions_per_level = NULL`,
-- because 5 is true and the mixed bay has no single positions figure. But those
-- two columns are not independent facts — together they are the STRUCTURED
-- capacity model, and a form has one only when BOTH are set:
--
--   lib/storageFormCapacity.ts
--     capacityModeOf  -> 'structured' only if levels AND positionsPerLevel
--     deriveCapacitySlots -> levels x positions, else the flat count
--
-- AMD_RACK is therefore a FLAT-capacity form (112 slots, stated directly), and
-- in flat mode StorageFormsView renders no Levels input at all while
-- `buildPatch` sends `levels: null`. So the first time anyone opened the form
-- and pressed Save — to fix a colour, to correct the carton figure — the 5
-- would have vanished, silently, with no way to have seen it or put it back.
--
-- A seeded row must be a FIXED POINT of its own editor. If opening it and
-- saving changes the row, nobody can tell later whether the change mattered.
--
-- Nothing is lost by clearing it. The rack's level count is stated
-- authoritatively, and per level, by `has_levels = true` + a 5-entry
-- `level_template`, which is what every consumer actually reads: mutate-layout's
-- rack fan-out, RackLevelEditor, applyTemplate, levelRetroPatches. The only
-- readers of `storage_types.levels` are that capacity helper and the list row's
-- "N x M = K slots" summary, which already renders nothing without a positions
-- figure.
--
-- Scoped to AMD_RACK by code. Every other form has both columns or neither.
-- =============================================================================

UPDATE public.storage_types
   SET levels = NULL
 WHERE code = 'AMD_RACK'
   AND positions_per_level IS NULL;

-- =============================================================================
-- Verify — expect levels NULL, positions NULL, 112 slots, 5 template entries:
--   SELECT code, levels, positions_per_level, default_capacity_slots,
--          has_levels, jsonb_array_length(level_template) AS template_levels
--     FROM public.storage_types WHERE code = 'AMD_RACK';
-- =============================================================================
