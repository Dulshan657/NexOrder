import { describe, it, expect } from 'vitest'
import {
  MERGED_OBJECT_TYPES,
  objectRegions,
  regionFillPath,
  regionOutlinePath,
  type RegionObject,
} from '../components/admin/layout/objectRegions'
import type { LayoutObjectType } from '../types'

function obj(objectType: LayoutObjectType, x: number, y: number, w = 1, h = 1, floor = 0): RegionObject {
  return { objectType, floor, x, y, w, h }
}

/** A run of 1×1 cells along a row — what the paint tools actually produce. */
function run(objectType: LayoutObjectType, x0: number, y: number, n: number): RegionObject[] {
  return Array.from({ length: n }, (_, i) => obj(objectType, x0 + i, y))
}

describe('objectRegions', () => {
  it('merges a straight run into one region', () => {
    const regions = objectRegions(run('wall', 2, 5, 5), 0)
    expect(regions).toHaveLength(1)
    expect(regions[0].objectType).toBe('wall')
    expect(regions[0].cells).toHaveLength(5)
  })

  // 5 cells × 4 sides = 20, minus 2 sides per shared edge × 4 shared edges = 12.
  it('emits only exterior edges for a straight run', () => {
    const regions = objectRegions(run('wall', 2, 5, 5), 0)
    expect(regions[0].edges).toHaveLength(12)
    const d = regionOutlinePath(regions[0], 10)
    expect((d.match(/M/g) ?? []).length).toBe(12)
  })

  it('splits unconnected runs of the same type into separate regions', () => {
    const regions = objectRegions([...run('wall', 0, 0, 3), ...run('wall', 6, 0, 3)], 0)
    expect(regions).toHaveLength(2)
    expect(new Set(regions.map((r) => r.key)).size).toBe(2)
    expect(regions.every((r) => r.cells.length === 3)).toBe(true)
  })

  it('traces the notch of an L-shape instead of boxing it in', () => {
    // Vertical arm (0,0)-(0,2) plus horizontal arm (1,2)-(2,2).
    const cells = [obj('wall', 0, 0), obj('wall', 0, 1), obj('wall', 0, 2), obj('wall', 1, 2), obj('wall', 2, 2)]
    const regions = objectRegions(cells, 0)
    expect(regions).toHaveLength(1)
    // 5 cells × 4 sides = 20, minus 2 sides per shared edge × 4 shared edges = 12.
    expect(regions[0].edges).toHaveLength(12)
    // The concave corner: the top side of (1,2) faces out, because (1,1) is empty.
    expect(regions[0].edges).toEqual(
      expect.arrayContaining([{ x1: 1, y1: 2, x2: 2, y2: 2 }]),
    )
    // A bounding box would have claimed (1,0); no edge may sit inside the notch.
    expect(regions[0].cells).not.toEqual(expect.arrayContaining([{ x: 1, y: 0 }]))
  })

  it('emits the boundary of an interior hole', () => {
    // 3×3 ring with the centre missing.
    const cells: RegionObject[] = []
    for (let y = 0; y < 3; y++) {
      for (let x = 0; x < 3; x++) {
        if (x === 1 && y === 1) continue
        cells.push(obj('wall', x, y))
      }
    }
    const regions = objectRegions(cells, 0)
    expect(regions).toHaveLength(1)
    expect(regions[0].cells).toHaveLength(8)
    // The hole's four sides face out of the region, so all four must be present.
    expect(regions[0].edges).toEqual(
      expect.arrayContaining([
        { x1: 1, y1: 1, x2: 2, y2: 1 },
        { x1: 1, y1: 2, x2: 2, y2: 2 },
        { x1: 1, y1: 1, x2: 1, y2: 2 },
        { x1: 2, y1: 1, x2: 2, y2: 2 },
      ]),
    )
  })

  it('rasterizes a multi-cell imported object and drops its interior edges', () => {
    const regions = objectRegions([obj('wall', 0, 0, 3, 2)], 0)
    expect(regions).toHaveLength(1)
    expect(regions[0].cells).toHaveLength(6)
    // 6×4 = 24 minus 2 per shared edge; 3×2 has 7 internal shared edges → 24-14 = 10.
    expect(regions[0].edges).toHaveLength(10)
  })

  it('keeps the shared border between two DIFFERENT types', () => {
    const regions = objectRegions([obj('wall', 0, 0), obj('walkway', 1, 0)], 0)
    expect(regions).toHaveLength(2)
    // Each is a lone cell, so each keeps all four sides — the line between a wall
    // and the walkway beside it must not vanish.
    expect(regions.every((r) => r.edges.length === 4)).toBe(true)
  })

  it('collapses duplicate and overlapping same-type objects', () => {
    // Correct even on data the overlap repair hasn't run over yet.
    const regions = objectRegions([obj('wall', 1, 1), obj('wall', 1, 1), obj('wall', 1, 1, 2, 1)], 0)
    expect(regions).toHaveLength(1)
    expect(regions[0].cells).toHaveLength(2)
    expect(regions[0].edges).toHaveLength(6)
  })

  it('never returns label or obstacle', () => {
    const regions = objectRegions([obj('label', 0, 0), obj('obstacle', 2, 2), obj('wall', 5, 5)], 0)
    expect(regions).toHaveLength(1)
    expect(regions[0].objectType).toBe('wall')
    expect(MERGED_OBJECT_TYPES.has('label')).toBe(false)
    expect(MERGED_OBJECT_TYPES.has('obstacle')).toBe(false)
  })

  it('ignores other floors', () => {
    const regions = objectRegions([obj('wall', 0, 0), obj('wall', 0, 0, 1, 1, 1)], 0)
    expect(regions).toHaveLength(1)
    expect(regions[0].cells).toHaveLength(1)
  })

  it('is stable under input reordering', () => {
    const cells = run('wall', 0, 0, 4)
    const a = objectRegions(cells, 0)
    const b = objectRegions([...cells].reverse(), 0)
    expect(b.map((r) => r.key)).toEqual(a.map((r) => r.key))
    expect(b.map((r) => r.cells)).toEqual(a.map((r) => r.cells))
  })
})

describe('regionFillPath', () => {
  it('uses no arc command and no inset, so adjacent cells knit', () => {
    const regions = objectRegions(run('wall', 0, 0, 2), 0)
    const d = regionFillPath(regions[0], 10)
    // An `rx` would compile to an arc; the 1px inset would offset the origin.
    expect(d).not.toMatch(/[Aa]/)
    expect(d).toBe('M0,0h10v10h-10ZM10,0h10v10h-10Z')
  })

  it('shares an exact coordinate between neighbouring cells', () => {
    const regions = objectRegions(run('wall', 0, 0, 2), 0)
    const d = regionFillPath(regions[0], 26)
    // Cell 0 ends at x=26 and cell 1 starts at x=26 — no gap for a grid line to
    // show through, which is what made a drawn wall look like separate squares.
    expect(d).toContain('M0,0h26')
    expect(d).toContain('M26,0h26')
  })
})

// ── Named areas (mig 00090) ─────────────────────────────────────────────────
// An area is painted cell-by-cell like a wall, so merging is what turns those
// cells into one labelled region. Merging on TYPE alone would fuse two touching
// areas into a single shape carrying one of their two names — the exact problem
// that keeps `obstacle` out of MERGED_OBJECT_TYPES. `regionGroupKey` is what
// buys the merge without the fusion.

function area(name: string, x: number, y: number, zoneProfileId?: number): RegionObject {
  return { objectType: 'area', floor: 0, x, y, w: 1, h: 1, meta: { name, zoneProfileId } }
}

describe('objectRegions — named areas', () => {
  it('merges contiguous cells that share a name into one region', () => {
    const regions = objectRegions([area('Cold Storage', 0, 0), area('Cold Storage', 1, 0)], 0)

    expect(regions).toHaveLength(1)
    expect(regions[0].cells).toHaveLength(2)
    expect(regions[0].groupKey).toBe('Cold Storage')
  })

  it('keeps two DIFFERENT areas apart even when they touch', () => {
    const regions = objectRegions([area('Cold Storage', 0, 0), area('Bulk', 1, 0)], 0)

    expect(regions).toHaveLength(2)
    expect(regions.map((r) => r.groupKey).sort()).toEqual(['Bulk', 'Cold Storage'])
    for (const r of regions) expect(r.cells).toHaveLength(1)
  })

  it('separates names that differ only by a space or a colon', () => {
    // The bucket key joins type and group; a separator that can occur inside an
    // operator-typed name would collide two distinct areas into one region.
    const regions = objectRegions([area('Cold Storage', 0, 0), area('Cold:Storage', 5, 5)], 0)

    expect(regions).toHaveLength(2)
  })

  it('carries the area meta through, so the canvas can tint and label it', () => {
    const regions = objectRegions([area('Cold Storage', 0, 0, 4)], 0)

    expect(regions[0].meta).toMatchObject({ name: 'Cold Storage', zoneProfileId: 4 })
  })

  it('still splits one name into separate regions when the cells are apart', () => {
    const regions = objectRegions([area('Bulk', 0, 0), area('Bulk', 9, 9)], 0)

    expect(regions).toHaveLength(2)
    expect(regions.map((r) => r.key)).toEqual([...new Set(regions.map((r) => r.key))])
  })

  it('leaves every non-area type on the empty group key', () => {
    const regions = objectRegions(run('wall', 0, 0, 3), 0)

    expect(regions).toHaveLength(1)
    expect(regions[0].groupKey).toBe('')
  })

  it('is a merged type — otherwise a 50-cell area would draw 50 names', () => {
    expect(MERGED_OBJECT_TYPES.has('area')).toBe(true)
  })
})
