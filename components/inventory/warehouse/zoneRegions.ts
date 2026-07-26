// Derives drawable geometry for warehouse ZONES, which have none of their own.
//
// WHY THIS IS COMPUTED RATHER THAN READ. A zone is a tree node, not a shape:
// `mutate-layout`'s `resolveZone` creates a `locations` row of kind ZONE purely
// so drawn bins can be reparented under it, and never gives it a
// `layout_placements` row. `publish-layout` depends on that (it refuses to
// deactivate "unplaced" bins precisely because it would otherwise disable the
// ZONE ancestors of placed bins). So the only spatial trace a cold room leaves
// is its bins' cells — plus, in some warehouses, a `label` object drawn over it.
// This module recovers the area from the bins; the label objects are rendered
// separately, and warehouses like wie-demo have zones but no label objects at
// all, which is why bin-derived regions are the load-bearing path.
//
// Pure, no React, no I/O.

import type { InventoryLocation, LayoutPlacement } from '@/types'

export interface ZoneCell {
  x: number
  y: number
}

/** One boundary segment in GRID CELL units — multiply by `cell` to draw. */
export interface ZoneEdge {
  x1: number
  y1: number
  x2: number
  y2: number
}

export interface ZoneRegion {
  zoneId: number
  name: string
  /** Resolve to a `zone_profiles.zone_type` (and thus a tint) via useZoneProfiles();
   *  `locations` itself carries only the FK. */
  zoneProfileId?: number
  cells: ZoneCell[]
  /** The union outline: only the edges that face OUT of the region. */
  edges: ZoneEdge[]
  /** Top-left-most cell — a stable anchor that never lands in an L-shape's notch. */
  labelAt: ZoneCell
}

const key = (x: number, y: number) => `${x}:${y}`

/**
 * Zone regions for one floor, ordered by zone id.
 *
 * A bin is attributed to its DEEPEST ancestor zone, so a zone nested inside
 * another claims its own bins rather than both drawing the same cells. Matching
 * is on `materializedPath` with an explicit trailing separator, so `/MAIN/COLDE`
 * cannot swallow the bins of `/MAIN/COLD`.
 *
 * Cells are deduped: every level of a levelled rack is its own placement row at
 * the same (floor,x,y) (mig 00072), and without dedupe a 4-level rack would
 * contribute its cell four times.
 */
export function zoneRegions(
  placements: readonly LayoutPlacement[],
  locationsById: Map<number, InventoryLocation>,
  floor: number,
): ZoneRegion[] {
  const zones: InventoryLocation[] = []
  for (const loc of locationsById.values()) {
    if (loc.kind === 'ZONE') zones.push(loc)
  }
  if (zones.length === 0) return []

  // Deepest-first, so the first prefix match is the most specific zone.
  const byDepth = zones
    .slice()
    .sort((a, b) => b.materializedPath.length - a.materializedPath.length)

  const cellsByZone = new Map<number, Set<string>>()

  for (const p of placements) {
    if (p.floor !== floor) continue
    const loc = locationsById.get(p.locationId)
    if (!loc) continue
    const zone = byDepth.find((z) => loc.materializedPath.startsWith(`${z.materializedPath}/`))
    if (!zone) continue

    let cells = cellsByZone.get(zone.id)
    if (!cells) {
      cells = new Set<string>()
      cellsByZone.set(zone.id, cells)
    }
    // A placement can span several cells; record every one it covers.
    for (let dx = 0; dx < Math.max(1, p.w); dx++) {
      for (let dy = 0; dy < Math.max(1, p.h); dy++) {
        cells.add(key(p.x + dx, p.y + dy))
      }
    }
  }

  const regions: ZoneRegion[] = []
  for (const [zoneId, cellKeys] of cellsByZone) {
    const zone = locationsById.get(zoneId)
    if (!zone || cellKeys.size === 0) continue

    // Sorted (y, then x) so cells, edges and React keys are stable across renders.
    const cells: ZoneCell[] = Array.from(cellKeys, (k) => {
      const [x, y] = k.split(':')
      return { x: Number(x), y: Number(y) }
    }).sort((a, b) => a.y - b.y || a.x - b.x)

    const edges: ZoneEdge[] = []
    for (const { x, y } of cells) {
      // An edge is part of the outline only where the neighbouring cell is
      // outside the zone — this is what makes an L-shape trace its notch
      // instead of being filled in like a bounding box would.
      if (!cellKeys.has(key(x, y - 1))) edges.push({ x1: x, y1: y, x2: x + 1, y2: y })
      if (!cellKeys.has(key(x, y + 1))) edges.push({ x1: x, y1: y + 1, x2: x + 1, y2: y + 1 })
      if (!cellKeys.has(key(x - 1, y))) edges.push({ x1: x, y1: y, x2: x, y2: y + 1 })
      if (!cellKeys.has(key(x + 1, y))) edges.push({ x1: x + 1, y1: y, x2: x + 1, y2: y + 1 })
    }

    regions.push({
      zoneId,
      name: zone.name,
      zoneProfileId: zone.zoneProfileId,
      cells,
      edges,
      labelAt: cells[0], // cells are (y,x)-sorted, so [0] is the top-left-most
    })
  }

  return regions.sort((a, b) => a.zoneId - b.zoneId)
}
