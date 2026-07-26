import { describe, it, expect } from 'vitest'

import type { InventoryLocation, LayoutPlacement } from '../types'
import { spineRows, spineFits, rollupFill, MIN_STRIPE_PX } from '../components/inventory/warehouse/levelSpine'

function placement(locationId: number, levelIndex?: number): LayoutPlacement {
  return {
    id: locationId * 10,
    layoutId: 1,
    locationId,
    floor: 0,
    x: 4,
    y: 7,
    w: 1,
    h: 1,
    rotation: 0,
    levelIndex,
  }
}

function level(id: number, levelIndex: number, levelRole: string | undefined): InventoryLocation {
  return {
    id,
    parentId: 100,
    kind: 'SHELF',
    code: `R-1-L${levelIndex}`,
    name: `Level ${levelIndex}`,
    materializedPath: `/MAIN/R-1/R-1-L${levelIndex}`,
    isActive: true,
    levelIndex,
    levelRole,
  }
}

const LOCATIONS = new Map<number, InventoryLocation>([
  [1, level(1, 1, 'pick')],
  [2, level(2, 2, 'pick')],
  [3, level(3, 3, 'reserve')],
  [4, level(4, 4, 'bulk')],
])

const FILL = new Map<number, number | null>([
  [1, 0.85],
  [2, 1],
  [3, 0.35],
  [4, null],
])

describe('spineRows', () => {
  it('orders bottom-first so L1 (the floor level, mig 00072) comes first', () => {
    const rows = spineRows([placement(3, 3), placement(1, 1), placement(4, 4), placement(2, 2)], LOCATIONS, FILL)
    expect(rows.map((r) => r.levelIndex)).toEqual([1, 2, 3, 4])
  })

  it('carries each level’s own role and fill, not the rack’s aggregate', () => {
    const rows = spineRows([placement(1, 1), placement(3, 3), placement(4, 4)], LOCATIONS, FILL)
    expect(rows).toEqual([
      { locationId: 1, levelIndex: 1, roleKey: 'pick', fillPct: 0.85 },
      { locationId: 3, levelIndex: 3, roleKey: 'reserve', fillPct: 0.35 },
      { locationId: 4, levelIndex: 4, roleKey: 'bulk', fillPct: null },
    ])
  })

  it('falls back to the location’s levelIndex when the placement lacks one', () => {
    // layout_placements.level_index is nullable; locations.level_index is the
    // authoritative copy, so a half-migrated row must still order correctly.
    const rows = spineRows([placement(2, undefined), placement(1, undefined)], LOCATIONS, FILL)
    expect(rows.map((r) => r.levelIndex)).toEqual([1, 2])
  })

  it('reports a null role for a level with none set (unconstrained legacy row)', () => {
    const locs = new Map<number, InventoryLocation>([[9, level(9, 1, undefined)]])
    const rows = spineRows([placement(9, 1)], locs, new Map())
    expect(rows[0].roleKey).toBeNull()
  })

  it('reports null fill when the level has no capacity configured', () => {
    const rows = spineRows([placement(4, 4)], LOCATIONS, FILL)
    expect(rows[0].fillPct).toBeNull()
  })

  it('skips placements with no matching location rather than drawing a blank stripe', () => {
    const rows = spineRows([placement(1, 1), placement(404, 2)], LOCATIONS, FILL)
    expect(rows.map((r) => r.locationId)).toEqual([1])
  })

  it('returns an empty array for no items', () => {
    expect(spineRows([], LOCATIONS, FILL)).toEqual([])
  })
})

describe('spineFits', () => {
  it('needs at least MIN_STRIPE_PX of height per level', () => {
    expect(spineFits(MIN_STRIPE_PX * 4, 4)).toBe(true)
    expect(spineFits(MIN_STRIPE_PX * 4 - 0.01, 4)).toBe(false)
  })

  it('is false for zero or negative rows so a legacy bin never draws a spine', () => {
    expect(spineFits(100, 0)).toBe(false)
    expect(spineFits(100, -1)).toBe(false)
  })

  it('is false for a non-finite height', () => {
    expect(spineFits(Number.NaN, 4)).toBe(false)
  })
})

describe('rollupFill', () => {
  const rows = (...specs: Array<[number, number | null]>) =>
    specs.map(([locationId, fillPct], i) => ({
      locationId,
      levelIndex: i + 1,
      roleKey: null,
      fillPct,
    }))

  it('weights each level by its capacity, not equally', () => {
    // 24-slot pick face full, 96-slot bulk empty → 24/120 = 20%, not the 50%
    // a plain mean would report.
    const caps = new Map([[1, 24], [2, 96]])
    expect(rollupFill(rows([1, 1], [2, 0]), caps)).toBeCloseTo(0.2)
  })

  it('ignores levels with unknown fill or no capacity', () => {
    const caps = new Map<number, number | null>([[1, 10], [2, null], [3, 0]])
    expect(rollupFill(rows([1, 0.5], [2, 0.9], [3, 1]), caps)).toBeCloseTo(0.5)
  })

  it('returns null when nothing has capacity — never a misleading 0%', () => {
    expect(rollupFill(rows([1, 0.5]), new Map())).toBeNull()
    expect(rollupFill([], new Map([[1, 10]]))).toBeNull()
  })

  it('carries over-capacity through rather than clamping', () => {
    expect(rollupFill(rows([1, 1.5]), new Map([[1, 10]]))).toBeCloseTo(1.5)
  })
})
