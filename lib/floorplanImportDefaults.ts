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

// ── Pallet-area decisions ────────────────────────────────────────────────────
//
// A `palletAreas` entry (`FloorplanPalletAreaDraft` in floorplanService.ts) is a
// cross-hatched floor-pallet block the AI extracted, with 1×1 bin placements
// pre-generated per free cell but `storage_type_id` deliberately left unset —
// the normalizer never decides storable-vs-visual on the operator's behalf.
// The import modal asks per area; this module turns that decision into the
// placements/objects `createDraft` appends to the base layout geometry.

/** The minimal placement shape this mapper needs — matches
 *  `SavePlacementInput`'s `new_bin` shape structurally. */
interface PalletAreaPlacement {
  new_bin?: { code: string; storage_type_id?: number | null } | null
}

/** The minimal pallet-area shape this mapper needs — matches
 *  `FloorplanPalletAreaDraft` structurally. */
export interface PalletAreaInput<P extends PalletAreaPlacement> {
  code: string
  floor: number
  x: number
  y: number
  w: number
  h: number
  placements: P[]
}

/** The operator's choice for one pallet area. `storable: false` ("Visual
 *  only") drops the pre-generated bins entirely in favor of a named obstacle.
 *  `storageTypeId: null` on a storable area means "no default (uncapped)",
 *  same convention as `applyDefaultStorageForm`'s `formId` parameter. */
export type PalletAreaDecision =
  | { storable: true; storageTypeId: number | null }
  | { storable: false }

// Areas with no recorded decision (shouldn't normally happen — the modal seeds
// one per area on load) default to storable/uncapped rather than silently
// dropping the area's bins.
const DEFAULT_PALLET_AREA_DECISION: PalletAreaDecision = { storable: true, storageTypeId: null }

/** A visual-only pallet area renders as a plain named obstacle — no bins, no
 *  storage capacity, just a labeled block on the floor. */
export interface PalletAreaVisualObject {
  object_type: 'obstacle'
  floor: number
  x: number
  y: number
  w: number
  h: number
  meta: { name: string }
}

export interface ApplyPalletAreaChoicesResult<P> {
  /** Placements for every storable area: `storage_type_id` backfilled from the
   *  chosen form, and `new_bin.code` suffixed with `-L{layoutId}` — the same
   *  per-layout scoping `createDraft` applies to the base placements. */
  placements: P[]
  /** One obstacle object per visual-only area. */
  visualObjects: PalletAreaVisualObject[]
}

/**
 * Apply the operator's per-pallet-area storable/visual choices.
 *
 * - Storable areas: their pre-generated bin placements are kept (unmatched
 *   `storage_type_id` backfilled from the chosen form; already-set values are
 *   left alone), with `new_bin.code` suffixed `-L{layoutId}`.
 * - Visual-only areas contribute no placements — just one obstacle object
 *   covering the area's footprint.
 *
 * Pure and immutable: inputs are never mutated; areas missing from `decisions`
 * default to storable/uncapped (see `DEFAULT_PALLET_AREA_DECISION`).
 */
export function applyPalletAreaChoices<P extends PalletAreaPlacement>(
  areas: ReadonlyArray<PalletAreaInput<P>>,
  decisions: Readonly<Record<string, PalletAreaDecision>>,
  layoutId: number,
): ApplyPalletAreaChoicesResult<P> {
  const placements: P[] = []
  const visualObjects: PalletAreaVisualObject[] = []

  for (const area of areas) {
    const decision = decisions[area.code] ?? DEFAULT_PALLET_AREA_DECISION
    if (!decision.storable) {
      visualObjects.push({
        object_type: 'obstacle',
        floor: area.floor,
        x: area.x,
        y: area.y,
        w: area.w,
        h: area.h,
        meta: { name: 'Pallet storage' },
      })
      continue
    }
    for (const p of area.placements) {
      if (!p.new_bin) {
        placements.push(p)
        continue
      }
      placements.push({
        ...p,
        new_bin: {
          ...p.new_bin,
          code: `${p.new_bin.code}-L${layoutId}`,
          storage_type_id: p.new_bin.storage_type_id ?? decision.storageTypeId ?? undefined,
        },
      })
    }
  }

  return { placements, visualObjects }
}

// ── Stale walkway pruning ────────────────────────────────────────────────────
//
// The server's extraction-time auto-connect pass runs before the operator's
// pallet-area Storable/Visual decisions exist, so it may have threaded 1×1
// walkway repair cells across cells that later became storable pallet bins.
// `createDraft` re-runs auto-connect client-side over the FINAL assembled
// geometry, but a stale walkway sitting under a new bin needs pruning first —
// auto-connect only ever ADDS cells, it never removes one that's now covered.

/** The minimal object shape this pruner needs — matches `SaveObjectInput`
 *  structurally. */
interface WalkwayPruneObject {
  object_type: string
  floor: number
  x: number
  y: number
  w: number
  h: number
}

/** The minimal placement shape this pruner needs — matches
 *  `SavePlacementInput` structurally. */
interface WalkwayPrunePlacement {
  floor: number
  x: number
  y: number
  w: number
  h: number
}

/**
 * Drop any 1×1 `walkway` object whose single cell is covered by a placement
 * in the final assembled placement list (base racks + storable pallet-area
 * bins). Only 1×1 walkways are ever auto-added by auto-connect, so only those
 * are eligible for pruning — a multi-cell walkway (an AI-drawn aisle) must
 * survive even if a placement happens to overlap one of its cells.
 *
 * Pure: inputs are never mutated; returns a new array.
 */
export function pruneStaleWalkways<T extends WalkwayPruneObject>(
  objects: readonly T[],
  placements: ReadonlyArray<WalkwayPrunePlacement>,
): T[] {
  const covered = new Set<string>()
  for (const p of placements) {
    for (let dx = 0; dx < p.w; dx++) {
      for (let dy = 0; dy < p.h; dy++) {
        covered.add(`${p.floor}:${p.x + dx}:${p.y + dy}`)
      }
    }
  }
  return objects.filter((o) => {
    if (o.object_type !== 'walkway' || o.w !== 1 || o.h !== 1) return true
    return !covered.has(`${o.floor}:${o.x}:${o.y}`)
  })
}
