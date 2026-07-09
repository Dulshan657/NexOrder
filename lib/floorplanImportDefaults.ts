// Floor-plan import: default storage-form assignment.
//
// The AI extraction matches a rack's storageTypeHint against the catalogue
// where it can, but leaves `new_bin.storage_type_id` unset when it can't (see
// `matchStorageType` in `_shared/floorplan/extractionSchema.ts`). Rather than
// publish those racks uncapped, the import modal lets the operator pick one
// storage form to backfill every unmatched rack with. This module is the pure
// mapper — no I/O, trivially unit-testable.

/** The minimal shape this mapper needs from a placement — matches
 *  `SavePlacementInput`/`NormalizedPlacement`'s `new_bin` shape structurally. */
interface PlacementWithOptionalBin {
  new_bin?: { storage_type_id?: number | null } | null
}

/**
 * Backfill `new_bin.storage_type_id` on any placement whose AI-matched bin
 * left it unset. Matched bins (storage_type_id already present) and
 * placements without a `new_bin` (existing-location placements) are returned
 * as the SAME reference — untouched. `formId = null` means "no default,
 * leave uncapped": unmatched bins get `storage_type_id: undefined` (omitted),
 * same as if the AI had never guessed. Immutable: the input array and its
 * objects are never mutated.
 */
export function applyDefaultStorageForm<T extends PlacementWithOptionalBin>(
  placements: T[],
  formId: number | null,
): T[] {
  return placements.map((p) => {
    if (!p.new_bin || p.new_bin.storage_type_id != null) return p
    return { ...p, new_bin: { ...p.new_bin, storage_type_id: formId ?? undefined } }
  })
}
