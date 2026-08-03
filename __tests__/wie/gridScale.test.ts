import { describe, it, expect } from 'vitest'
import {
  MAX_GRID_CELLS,
  applyRatio,
  deriveFloorSize,
  deriveGrid,
  findOutOfBounds,
  planRescale,
  rulerStride,
  scaleBarFor,
  scaleFactor,
  toHundredths,
  type ScaleItem,
} from '../../supabase/functions/_shared/wie/gridScale'

const item = (label: string, x: number, y: number, w = 1, h = 1): ScaleItem => ({ label, x, y, w, h })

describe('toHundredths', () => {
  it('accepts clean NUMERIC(6,2) quantities', () => {
    expect(toHundredths(1)).toBe(100)
    expect(toHundredths(0.5)).toBe(50)
    expect(toHundredths(0.75)).toBe(75)
    // 0.29 * 100 is 28.999999999999996 in binary floating point — the tolerance
    // exists for exactly this, and must not swallow a real third decimal.
    expect(toHundredths(0.29)).toBe(29)
  })

  it('rejects a third decimal place rather than rounding it', () => {
    // Silently storing 0.51 would make every derived distance wrong with nothing
    // on screen to reveal it.
    expect(toHundredths(0.505)).toBeNull()
  })

  it('rejects non-positive and non-finite values', () => {
    expect(toHundredths(0)).toBeNull()
    expect(toHundredths(-1)).toBeNull()
    expect(toHundredths(Number.NaN)).toBeNull()
  })
})

describe('scaleFactor', () => {
  it('returns 2/1 when the resolution halves', () => {
    // Finer cells → a rectangle needs MORE of them to cover the same ground.
    expect(scaleFactor(1.0, 0.5)).toEqual({ num: 2, den: 1 })
  })

  it('returns 4/3 for 1.0 -> 0.75', () => {
    expect(scaleFactor(1.0, 0.75)).toEqual({ num: 4, den: 3 })
  })

  it('returns 1/2 when the resolution doubles', () => {
    expect(scaleFactor(0.5, 1.0)).toEqual({ num: 1, den: 2 })
  })

  it('is identity for an unchanged resolution', () => {
    expect(scaleFactor(1.2, 1.2)).toEqual({ num: 1, den: 1 })
  })

  it('refuses a resolution it cannot represent exactly', () => {
    expect(scaleFactor(1.0, 0.333)).toBeNull()
  })
})

describe('applyRatio', () => {
  it('scales a whole number of cells', () => {
    expect(applyRatio(3, { num: 4, den: 3 })).toBe(4)
    expect(applyRatio(2, { num: 2, den: 1 })).toBe(4)
  })

  it('returns null rather than a fraction', () => {
    expect(applyRatio(2, { num: 4, den: 3 })).toBeNull()
  })
})

describe('deriveGrid / deriveFloorSize', () => {
  it('derives the grid from a building and a resolution', () => {
    expect(deriveGrid({ floorWidthM: 48, floorHeightM: 32, cellSizeM: 0.5 }))
      .toEqual({ gridWidth: 96, gridHeight: 64 })
  })

  it('ceils so the far wall is always inside the grid', () => {
    // 47.5 m at 1 m/cell needs 48 cells; 47 would leave the last half-metre — and
    // any rack standing on it — off the plan.
    expect(deriveGrid({ floorWidthM: 47.5, floorHeightM: 10, cellSizeM: 1 }))
      .toEqual({ gridWidth: 48, gridHeight: 10 })
  })

  it('round-trips an exact fit', () => {
    const grid = deriveGrid({ floorWidthM: 48, floorHeightM: 32, cellSizeM: 0.5 })!
    expect(deriveFloorSize({ ...grid, cellSizeM: 0.5 })).toEqual({ floorWidthM: 48, floorHeightM: 32 })
  })

  it('refuses a resolution it cannot represent', () => {
    expect(deriveGrid({ floorWidthM: 48, floorHeightM: 32, cellSizeM: 0.333 })).toBeNull()
  })
})

describe('planRescale', () => {
  const base = { fromCellM: 1.0, gridWidth: 60, gridHeight: 40 }

  it('preserves real-world size when the resolution halves', () => {
    // A 2x1 rack at 1.0 m/cell is 2.0 m x 1.0 m. At 0.5 m/cell that same rack
    // must occupy 4x2 cells, or the drawing quietly stops matching the building.
    const result = planRescale({
      ...base,
      toCellM: 0.5,
      placements: [item('A-03', 3, 2, 2, 1)],
      objects: [item('wall', 0, 0, 60, 1)],
    })
    expect(result.ok).toBe(true)
    if (result.ok === false) return
    expect(result.factor).toEqual({ num: 2, den: 1 })
    expect(result.gridWidth).toBe(120)
    expect(result.gridHeight).toBe(80)
    expect(result.placements[0]).toEqual({ label: 'A-03', x: 6, y: 4, w: 4, h: 2 })
    expect(result.objects[0]).toEqual({ label: 'wall', x: 0, y: 0, w: 120, h: 2 })
  })

  it('is a no-op at an unchanged resolution', () => {
    const result = planRescale({
      ...base,
      toCellM: 1.0,
      placements: [item('A-03', 3, 2, 2, 1)],
      objects: [],
    })
    expect(result.ok).toBe(true)
    if (result.ok === false) return
    expect(result.placements[0]).toEqual({ label: 'A-03', x: 3, y: 2, w: 2, h: 1 })
    expect(result.gridWidth).toBe(60)
  })

  it('refuses when a rectangle would land on a fractional cell, naming it', () => {
    // 1.0 -> 0.75 is 4/3. A 3-cell rack becomes exactly 4 cells, but a 2-cell
    // wall becomes 2.667 — so the whole change is refused rather than rounded.
    const result = planRescale({
      ...base,
      toCellM: 0.75,
      placements: [item('A-03', 0, 0, 3, 3)],
      objects: [item('W-12', 0, 6, 2, 1)],
    })
    expect(result.ok).toBe(false)
    if (result.ok !== false) return
    expect(result.reason).toBe('not_divisible')
    expect(result.offenders).toEqual(['W-12'])
    expect(result.detail).toContain('W-12')
  })

  it('refuses when an item would fall outside a shrunk grid, naming it', () => {
    const result = planRescale({
      ...base,
      toCellM: 1.0,
      toGridWidth: 10,
      toGridHeight: 10,
      placements: [item('A-03', 2, 2), item('Z-99', 40, 1)],
      objects: [],
    })
    expect(result.ok).toBe(false)
    if (result.ok !== false) return
    expect(result.reason).toBe('out_of_bounds')
    expect(result.offenders).toEqual(['Z-99'])
  })

  it('refuses a resolution whose derived grid exceeds the cap', () => {
    // 60x40 at 1.0 m is a 60 m x 40 m floor; at 0.25 m/cell that is 240 cells
    // across, past MAX_GRID_CELLS.
    const result = planRescale({ ...base, toCellM: 0.25, placements: [], objects: [] })
    expect(result.ok).toBe(false)
    if (result.ok !== false) return
    expect(result.reason).toBe('grid_cap')
    expect(result.detail).toContain(String(MAX_GRID_CELLS))
  })

  it('refuses a resolution it cannot represent exactly', () => {
    const result = planRescale({ ...base, toCellM: 0.333, placements: [], objects: [] })
    expect(result.ok).toBe(false)
    if (result.ok !== false) return
    expect(result.reason).toBe('invalid')
  })

  it('honours an explicit new grid when the floor size changed too', () => {
    const result = planRescale({
      ...base,
      toCellM: 0.5,
      toGridWidth: 100,
      toGridHeight: 70,
      placements: [item('A-03', 1, 1, 2, 2)],
      objects: [],
    })
    expect(result.ok).toBe(true)
    if (result.ok === false) return
    expect(result.gridWidth).toBe(100)
    expect(result.gridHeight).toBe(70)
    expect(result.placements[0]).toEqual({ label: 'A-03', x: 2, y: 2, w: 4, h: 4 })
  })
})

describe('findOutOfBounds', () => {
  it('reports only what pokes past the grid', () => {
    const items = [item('in', 8, 8, 2, 2), item('out', 9, 0, 2, 1)]
    expect(findOutOfBounds(items, { gridWidth: 10, gridHeight: 10 })).toEqual(['out'])
  })
})

describe('scaleBarFor', () => {
  it('picks the largest round distance that fits the target width', () => {
    // 26 px/cell at 1 m/cell → 120 px holds 4.6 m, so the bar shows 2 m.
    expect(scaleBarFor(26, 1, 120)).toEqual({ metres: 2, px: 52 })
  })

  it('shows more metres per bar as the cells get finer', () => {
    // Same pixels, half-metre cells → 120 px is only 2.3 m of building.
    expect(scaleBarFor(26, 0.5, 120).metres).toBe(2)
    expect(scaleBarFor(26, 4, 120).metres).toBe(10)
  })

  it('falls back to a sane bar on a degenerate zoom', () => {
    expect(scaleBarFor(0, 1, 120)).toEqual({ metres: 1, px: 120 })
  })
})

describe('rulerStride', () => {
  it('labels every cell when they are wide enough', () => {
    expect(rulerStride(52, 40)).toBe(1)
  })

  it('thins the labels as cells shrink', () => {
    expect(rulerStride(13, 40)).toBe(4)
    expect(rulerStride(0, 40)).toBe(1)
  })
})
