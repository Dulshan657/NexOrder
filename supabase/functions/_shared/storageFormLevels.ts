// Pure helpers for a storage form's level template (mig 00072).
//
// `storage_types.level_template` is a POSITIONAL jsonb array —
// `[{role, capacity_slots, weight_capacity_kg}, …]` where index + 1 is the
// level_index and L1 is the bottom level. This module resolves what that
// standard implies for the levels of racks already drawn with the form, which
// is what `mutate-storage-type`'s retro-apply ("Apply to all units") needs.
//
// No Deno, no IO — same pattern as `_shared/wie/*`, so vitest covers it
// directly (see __tests__/storageFormLevels.test.ts).

// Re-exported, not redeclared: this file used to carry its own copy of the
// union, which then had to be kept in step with _shared/wie/types.ts by hand.
// Since mig 00081 the vocabulary is operator-managed, so there is exactly one
// definition and it is a bare string.
export type { LevelRole } from './wie/types.ts'
import type { LevelRole } from './wie/types.ts'

/** One entry of a form's standard level layout, as stored in jsonb. */
export interface LevelTemplateEntry {
  role: LevelRole
  capacity_slots?: number | null
  weight_capacity_kg?: number | null
}

/** The capacity/weight a single existing level should be set to. */
export interface LevelRetroPatch {
  levelIndex: number
  /** null means uncapped — never the whole-rack figure. */
  capacitySlots: number | null
  weightCapacityKg: number | null
}

/** jsonb numerics can arrive as numbers or numeric strings; anything else
 *  (including null/undefined) means "no limit". */
function toNumberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

/**
 * The per-level capacity/weight a form's template implies, for the level
 * indices that actually exist on drawn racks.
 *
 * Positional: `template[i]` describes level `i + 1`. A level_index outside the
 * template's range is NOT described by the standard — it is omitted from the
 * result so the caller leaves those rows untouched rather than guessing.
 *
 * A template entry whose `capacity_slots` / `weight_capacity_kg` is absent or
 * null resolves to `null` (uncapped). It deliberately does NOT fall back to
 * the form's whole-unit figure: that fallback is exactly the bug this replaces,
 * where "Apply to all units" gave every level the whole rack's capacity.
 */
export function levelRetroPatches(
  template: unknown,
  levelIndices: readonly number[],
): LevelRetroPatch[] {
  if (!Array.isArray(template) || template.length === 0) return []

  const wanted = [...new Set(levelIndices)]
    .filter((n) => Number.isInteger(n) && n >= 1 && n <= template.length)
    .sort((a, b) => a - b)

  return wanted.map((levelIndex) => {
    const entry = (template[levelIndex - 1] ?? {}) as Record<string, unknown>
    return {
      levelIndex,
      capacitySlots: toNumberOrNull(entry.capacity_slots),
      weightCapacityKg: toNumberOrNull(entry.weight_capacity_kg),
    }
  })
}
