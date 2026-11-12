// Rack-level grouping (mig 00072), shared by both map canvases and the 3D
// scene model. Lifted out of LayoutCanvas.tsx (NX-0035) so a node test can
// import it without pulling in a component file; LayoutCanvas re-exports it.

// ── Rack-level grouping (mig 00072) ─────────────────────────────────────────
// Each level of a rack now gets its own placement row, co-located at the
// rack's exact (floor, x, y), distinguished by `levelIndex`. Rendering a
// placements array 1:1 therefore paints one overlapping rect per level — both
// this canvas and WarehouseCanvas group by cell first and draw one rect per
// group. See the architecture note on `LayoutPlacement.levelIndex` in types.ts.

/** Minimal shape `groupPlacementsByCell` needs — satisfied by both the
 *  designer's `EditorPlacement` and the published `LayoutPlacement`, so one
 *  helper serves both canvases. */
export interface PlacementCell {
  floor: number
  x: number
  y: number
  w: number
  h: number
  /** Which level of its rack this row is; undefined = legacy single-bin. */
  levelIndex?: number
}

export interface PlacementGroup<T extends PlacementCell> {
  key: string
  floor: number
  x: number
  y: number
  w: number
  h: number
  /** True for a lone placement with `levelIndex === undefined` — the legacy
   *  single-bin case. Callers MUST render this exactly as before; anything
   *  else is (or will become, once it has >1 row) a rack needing
   *  expand-in-place. */
  isLegacyBin: boolean
  /** Every placement sharing this cell, ascending by levelIndex. */
  items: T[]
}

/** Groups a placements array by `(floor, x, y)` — the co-location key every
 *  level of a rack shares. A group of one placement with `levelIndex ===
 *  undefined` is a legacy bin and renders exactly as it does today; this is
 *  the regression risk the grouping exists to avoid getting wrong. */
export function groupPlacementsByCell<T extends PlacementCell>(placements: T[]): PlacementGroup<T>[] {
  const order: string[] = []
  const byKey = new Map<string, T[]>()
  for (const p of placements) {
    const key = `${p.floor}:${p.x}:${p.y}`
    const bucket = byKey.get(key)
    if (bucket) bucket.push(p)
    else {
      byKey.set(key, [p])
      order.push(key)
    }
  }
  return order.map((key) => {
    const items = [...(byKey.get(key) as T[])].sort((a, b) => (a.levelIndex ?? 0) - (b.levelIndex ?? 0))
    const first = items[0]
    return {
      key,
      floor: first.floor,
      x: first.x,
      y: first.y,
      w: first.w,
      h: first.h,
      isLegacyBin: items.length === 1 && items[0].levelIndex === undefined,
      items,
    }
  })
}
