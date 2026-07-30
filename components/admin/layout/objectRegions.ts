// Contiguous same-type object cells → one merged shape.
//
// WHY A DERIVED RENDER MODEL, NOT A DATA MERGE. The paint tools only ever mint
// 1×1 objects, and erase/select hit-test per cell. A merged multi-cell rect in the
// DATA model would be a UX regression (erasing one cell would have to re-split the
// rect, and identity churn would break the selection), so the data stays 1×1 and
// only the PICTURE merges. This mirrors groupPlacementsByCell: regroup raw rows
// into a render model inside a useMemo, leave the model alone.
//
// Pure — no React, no I/O. Coordinates come back in GRID CELL units; the canvas
// multiplies by its own `cell`, which keeps this memoizable on objects+floor alone
// and independent of zoom.

import type { LayoutObjectType } from '@/types'

export interface RegionCell {
  x: number
  y: number
}

/** One boundary segment, in GRID CELL units. */
export interface ObjectEdge {
  x1: number
  y1: number
  x2: number
  y2: number
}

/** The minimal shape both canvases already satisfy — the designer's EditorObject
 *  and the published LayoutObject. */
export interface RegionObject {
  objectType: LayoutObjectType
  floor: number
  x: number
  y: number
  w: number
  h: number
}

export interface ObjectRegion {
  /** `${objectType}:${floor}:${x}:${y}` of the top-left-most cell. Stable across
   *  renders and across input reordering: cells are (y,x)-sorted, and two
   *  components of one type on one floor cannot share a top-left cell. */
  key: string
  objectType: LayoutObjectType
  floor: number
  cells: RegionCell[]
  /** Exterior outline only — an edge is emitted where the 4-neighbour is not in
   *  THIS component, so an L-shape traces its notch instead of being boxed in. */
  edges: ObjectEdge[]
}

/**
 * Object types drawn as merged regions.
 *
 * `label` is excluded because it is annotation that may legally overlap anything,
 * and merging two adjacent labels into one silhouette would swallow both names.
 * `obstacle` is excluded because obstacles are discrete NAMED rooms ("Cold room",
 * "Returns", "Quarantine") — two adjacent ones merging into a single shape with
 * two names inside reads as one mislabelled room.
 */
export const MERGED_OBJECT_TYPES: ReadonlySet<LayoutObjectType> = new Set<LayoutObjectType>([
  'wall', 'walkway', 'dock', 'lift', 'conveyor', 'staging',
])

const k = (x: number, y: number) => `${x}:${y}`

/**
 * 4-connected components of same-type object cells on one floor.
 *
 * The flood fill is what zoneRegions deliberately omits: a zone is one logical
 * region even when its bins are scattered, whereas walls are many independent
 * runs and two unconnected segments must not share one outline.
 *
 * Cells are deduped, so overlapping or duplicated same-type objects collapse —
 * the merged fill is correct even on data the overlap repair hasn't run over yet.
 */
export function objectRegions(objects: readonly RegionObject[], floor: number): ObjectRegion[] {
  // Rasterize once per type.
  const byType = new Map<LayoutObjectType, Set<string>>()
  for (const o of objects) {
    if (o.floor !== floor || !MERGED_OBJECT_TYPES.has(o.objectType)) continue
    let cells = byType.get(o.objectType)
    if (!cells) { cells = new Set(); byType.set(o.objectType, cells) }
    for (let dy = 0; dy < Math.max(1, o.h); dy++) {
      for (let dx = 0; dx < Math.max(1, o.w); dx++) cells.add(k(o.x + dx, o.y + dy))
    }
  }

  const regions: ObjectRegion[] = []
  for (const [objectType, cellKeys] of byType) {
    // Deterministic iteration order → deterministic region keys and output order,
    // regardless of how the caller ordered `objects`.
    const sorted = [...cellKeys]
      .map((s) => { const [x, y] = s.split(':'); return { x: Number(x), y: Number(y) } })
      .sort((a, b) => (a.y === b.y ? a.x - b.x : a.y - b.y))

    const seen = new Set<string>()
    for (const start of sorted) {
      const startKey = k(start.x, start.y)
      if (seen.has(startKey)) continue

      // Iterative flood fill — an explicit stack, not recursion, because a wall
      // run can be thousands of cells on the 120×80 grid.
      const component: RegionCell[] = []
      const componentKeys = new Set<string>()
      const stack: RegionCell[] = [start]
      seen.add(startKey)
      componentKeys.add(startKey)
      while (stack.length > 0) {
        const cur = stack.pop()!
        component.push(cur)
        const neighbours = [
          { x: cur.x, y: cur.y - 1 }, { x: cur.x, y: cur.y + 1 },
          { x: cur.x - 1, y: cur.y }, { x: cur.x + 1, y: cur.y },
        ]
        for (const n of neighbours) {
          const nk = k(n.x, n.y)
          if (!cellKeys.has(nk) || seen.has(nk)) continue
          seen.add(nk)
          componentKeys.add(nk)
          stack.push(n)
        }
      }

      component.sort((a, b) => (a.y === b.y ? a.x - b.x : a.y - b.y))

      // Exterior edges only: emit a side where the neighbour is outside THIS
      // component. An interior hole's boundary is emitted too, which is correct —
      // it faces out of the region.
      const edges: ObjectEdge[] = []
      for (const { x, y } of component) {
        if (!componentKeys.has(k(x, y - 1))) edges.push({ x1: x, y1: y, x2: x + 1, y2: y })
        if (!componentKeys.has(k(x, y + 1))) edges.push({ x1: x, y1: y + 1, x2: x + 1, y2: y + 1 })
        if (!componentKeys.has(k(x - 1, y))) edges.push({ x1: x, y1: y, x2: x, y2: y + 1 })
        if (!componentKeys.has(k(x + 1, y))) edges.push({ x1: x + 1, y1: y, x2: x + 1, y2: y + 1 })
      }

      const anchor = component[0]
      regions.push({
        key: `${objectType}:${floor}:${anchor.x}:${anchor.y}`,
        objectType,
        floor,
        cells: component,
        edges,
      })
    }
  }
  return regions
}

/**
 * `d` for the UNION FILL: one closed unit-square subpath per cell, with NO inset
 * and NO corner radius, so adjacent cells share an exact coordinate and knit into
 * one silhouette.
 *
 * The 1px inset + rx={2} the per-object rects used to carry is exactly what made
 * a drawn wall look like a grid of separate squares: two neighbours sat 2px apart
 * and the grid line showed through the seam.
 */
export function regionFillPath(region: ObjectRegion, cell: number): string {
  let d = ''
  for (const c of region.cells) {
    const x = c.x * cell
    const y = c.y * cell
    d += `M${x},${y}h${cell}v${cell}h${-cell}Z`
  }
  return d
}

/**
 * `d` for the EXTERIOR OUTLINE: every boundary edge accumulated into ONE path.
 *
 * Deliberately one path rather than one <line> per edge. A 1-cell-thick run of N
 * cells has ~3.5N exterior edges, so N <line> elements would be ~3.5× MORE DOM
 * nodes than the one-rect-per-cell rendering this replaces — the fix would have
 * made the 120×80 grid slower, which is the exact thing the canvas perf rewrite
 * (single interaction rect + pointer math) exists to protect. One accumulated `d`
 * is 2-3 nodes per region regardless of N. Zone outlines get away with <line>
 * because there is ~1 zone region per warehouse; walls have dozens.
 */
export function regionOutlinePath(region: ObjectRegion, cell: number): string {
  let d = ''
  for (const e of region.edges) {
    d += `M${e.x1 * cell},${e.y1 * cell}L${e.x2 * cell},${e.y2 * cell}`
  }
  return d
}
