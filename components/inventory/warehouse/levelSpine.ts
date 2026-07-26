// The in-rect level spine: a levelled rack's levels reduced to one stripe each,
// so level count, role mix and per-level fullness are readable without clicking
// the rack open. Pure, no React — the renderer turns these rows into <rect>s.
//
// WHY. A rack's N levels are N `layout_placements` rows co-located at the same
// (floor,x,y) (mig 00072), collapsed by `groupPlacementsByCell` into a single
// rect. That rect used to be filled with "the first level that happened to have
// an overlay colour", which is actively misleading: under the occupancy overlay
// a rack with a jammed pick face and an empty bulk level could paint white.
// Per-level stripes replace that guess with the actual per-level numbers.

import type { InventoryLocation, LayoutPlacement } from '@/types'

/** One level's stripe. `roleKey` is a raw `level_roles.key` — resolve it to a
 *  colour through `@/lib/levelRoles`, never by comparing to a literal. */
export interface SpineRow {
  locationId: number
  levelIndex: number
  /** null = no role set (a legacy/unconstrained row), not "unknown role". */
  roleKey: string | null
  /** null = the level has no capacity configured, so fullness is unknown. */
  fillPct: number | null
}

/** A stripe thinner than this is a smudge rather than information.
 *
 *  Tuned against the real minimum zoom: BASE_CELL 26 at MIN_SCALE 0.4 gives a
 *  ~9.6px tall rect, and a 3-level rack there would draw 3.2px bands — visual
 *  noise on a cell whose own code is not even legible. 4px keeps the spine to
 *  zooms where it can actually be read. */
export const MIN_STRIPE_PX = 4

/**
 * Placement rows of one rack group → stripes, ordered BOTTOM-FIRST.
 *
 * L1 is the floor level (mig 00072), so index 0 of the result is the bottom of
 * the physical rack. SVG y grows downward, so the renderer must lay these out
 * upward from the rect's bottom edge — the order here matches how an operator
 * describes a rack, not how SVG paints it.
 *
 * `levelIndex` prefers the placement's copy and falls back to the location's:
 * `layout_placements.level_index` is nullable and was backfilled after
 * `locations.level_index`, so a half-migrated row must still sort correctly.
 */
export function spineRows(
  items: readonly LayoutPlacement[],
  locationsById: Map<number, InventoryLocation>,
  binFillPct: Map<number, number | null>,
): SpineRow[] {
  const rows: SpineRow[] = []
  for (const item of items) {
    const loc = locationsById.get(item.locationId)
    // No location row means no code, role or capacity — a stripe for it would be
    // a blank band the operator cannot act on, so leave it out entirely.
    if (!loc) continue
    rows.push({
      locationId: item.locationId,
      levelIndex: item.levelIndex ?? loc.levelIndex ?? 0,
      roleKey: loc.levelRole ?? null,
      fillPct: binFillPct.get(item.locationId) ?? null,
    })
  }
  return rows.sort((a, b) => a.levelIndex - b.levelIndex || a.locationId - b.locationId)
}

/** Is there room to draw `rowCount` stripes in a rect `rectPxH` screen px tall? */
export function spineFits(rectPxH: number, rowCount: number): boolean {
  if (!Number.isFinite(rectPxH) || rowCount <= 0) return false
  return rectPxH / rowCount >= MIN_STRIPE_PX
}

/**
 * One fullness figure for a whole rack, weighted by each level's capacity.
 *
 * This is what the collapsed rect and its `78%` label report, and it replaces
 * the old "colour of whichever level happened to be first" approximation. The
 * weighting matters: a 96-slot bulk level and a 24-slot pick level are not two
 * equal votes, and a plain mean would let a nearly-empty bulk level hide a
 * jammed pick face.
 *
 * Levels with no capacity contribute nothing (they have no denominator to add).
 * Returns null when no level has capacity — "unknown", never a misleading 0%.
 */
export function rollupFill(
  rows: readonly SpineRow[],
  capacityByLocation: Map<number, number | null | undefined>,
): number | null {
  let used = 0
  let capacity = 0
  for (const row of rows) {
    const cap = capacityByLocation.get(row.locationId)
    if (row.fillPct == null || cap == null || cap <= 0) continue
    used += row.fillPct * cap
    capacity += cap
  }
  return capacity > 0 ? used / capacity : null
}
