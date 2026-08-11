// Pure helpers for a storage form's level template (mig 00072).
//
// `storage_types.level_template` is a POSITIONAL jsonb array —
// `[{role, capacity_slots, slot_kind, weight_capacity_kg}, …]` where index + 1
// is the level_index and L1 is the bottom level. This module resolves what that
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
  /** This level's own slot unit. A rack can carry two — carton pick-zone levels
   *  below, pallet positions above — so it cannot live on the form alone. */
  slot_kind?: SlotKind | null
  weight_capacity_kg?: number | null
}

/** The two slot units `locations.slot_kind` accepts; anything else is NULL. */
export type SlotKind = 'pallet' | 'carton'

/** The capacity/weight/kind a single existing level should be set to. */
export interface LevelRetroPatch {
  levelIndex: number
  /** null means uncapped — never the whole-rack figure. */
  capacitySlots: number | null
  /** null means "inherit the form's slot_unit", matching the column default. */
  slotKind: SlotKind | null
  weightCapacityKg: number | null
}

/** jsonb numerics can arrive as numbers or numeric strings; anything else
 *  (including null/undefined) means "no limit". */
function toNumberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

/** `locations.slot_kind` has a CHECK on these two values, so anything else in
 *  the jsonb — including a stale 'each' from a form's slot_unit — must land as
 *  NULL rather than being written through and rejected by the constraint. */
function toSlotKindOrNull(value: unknown): SlotKind | null {
  return value === 'pallet' || value === 'carton' ? value : null
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
 *
 * `slot_kind` follows the same rule for the same reason, and it MUST be part of
 * the retro-apply: correcting a mis-typed level on the form (a pallet position
 * saved as `carton`) would otherwise reach only racks drawn afterwards, leaving
 * every existing one counting loose units against a two-slot limit while the
 * form claims to have been applied to all of them.
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
      slotKind: toSlotKindOrNull(entry.slot_kind),
      weightCapacityKg: toNumberOrNull(entry.weight_capacity_kg),
    }
  })
}
