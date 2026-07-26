import { describe, it, expect } from 'vitest'

import type { InventoryLocation, LayoutPlacement } from '../types'
import { zoneRegions } from '../components/inventory/warehouse/zoneRegions'

let nextId = 1000

function bin(locationId: number, x: number, y: number, floor = 0, w = 1, h = 1): LayoutPlacement {
  return { id: nextId++, layoutId: 1, locationId, floor, x, y, w, h, rotation: 0 }
}

function zone(id: number, code: string, path: string, zoneProfileId?: number): InventoryLocation {
  return {
    id, kind: 'ZONE', code, name: `${code} zone`, materializedPath: path, isActive: true, zoneProfileId,
  }
}

function binLoc(id: number, code: string, path: string): InventoryLocation {
  return { id, kind: 'BIN', code, name: code, materializedPath: path, isActive: true }
}

/** One zone `/MAIN/COLD` holding bins at the given cells. */
function coldFixture(cells: Array<[number, number]>) {
  const locations = new Map<number, InventoryLocation>()
  locations.set(1, zone(1, 'COLD', '/MAIN/COLD', 7))
  const placements: LayoutPlacement[] = []
  cells.forEach(([x, y], i) => {
    const id = 10 + i
    locations.set(id, binLoc(id, `C-${i}`, `/MAIN/COLD/C-${i}`))
    placements.push(bin(id, x, y))
  })
  return { locations, placements }
}

describe('zoneRegions — cells', () => {
  it('collects every cell a zone’s bins occupy', () => {
    const { locations, placements } = coldFixture([[2, 3], [3, 3]])
    const [region] = zoneRegions(placements, locations, 0)
    expect(region.zoneId).toBe(1)
    expect(region.name).toBe('COLD zone')
    expect(region.zoneProfileId).toBe(7)
    expect(region.cells).toHaveLength(2)
  })

  it('expands a multi-cell placement into all of its cells', () => {
    const locations = new Map<number, InventoryLocation>([
      [1, zone(1, 'BULK', '/MAIN/BULK')],
      [10, binLoc(10, 'B-1', '/MAIN/BULK/B-1')],
    ])
    const [region] = zoneRegions([bin(10, 5, 5, 0, 3, 2)], locations, 0)
    expect(region.cells).toHaveLength(6)
  })

  // Every level of a rack is its own placement row co-located at the same
  // (floor,x,y) — mig 00072. Without dedupe a 4-level rack would contribute its
  // cell four times and the edge union would cancel itself out.
  it('dedupes cells shared by every level of one rack', () => {
    const locations = new Map<number, InventoryLocation>([
      [1, zone(1, 'COLD', '/MAIN/COLD')],
      [11, binLoc(11, 'L1', '/MAIN/COLD/R1/L1')],
      [12, binLoc(12, 'L2', '/MAIN/COLD/R1/L2')],
    ])
    const levels = [bin(11, 2, 2), bin(12, 2, 2)]
    const [region] = zoneRegions(levels, locations, 0)
    expect(region.cells).toHaveLength(1)
    expect(region.edges).toHaveLength(4)
  })

  it('ignores placements on another floor', () => {
    const { locations, placements } = coldFixture([[2, 3]])
    expect(zoneRegions(placements, locations, 1)).toEqual([])
  })

  it('emits no region for a zone with no placed bins', () => {
    const locations = new Map<number, InventoryLocation>([[1, zone(1, 'EMPTY', '/MAIN/EMPTY')]])
    expect(zoneRegions([], locations, 0)).toEqual([])
  })
})

describe('zoneRegions — edge union', () => {
  it('outlines a single cell with four edges', () => {
    const { locations, placements } = coldFixture([[2, 3]])
    const [region] = zoneRegions(placements, locations, 0)
    expect(region.edges).toHaveLength(4)
    expect(region.edges).toContainEqual({ x1: 2, y1: 3, x2: 3, y2: 3 }) // top
    expect(region.edges).toContainEqual({ x1: 2, y1: 4, x2: 3, y2: 4 }) // bottom
    expect(region.edges).toContainEqual({ x1: 2, y1: 3, x2: 2, y2: 4 }) // left
    expect(region.edges).toContainEqual({ x1: 3, y1: 3, x2: 3, y2: 4 }) // right
  })

  it('drops the shared edge between two adjacent cells', () => {
    const { locations, placements } = coldFixture([[2, 3], [3, 3]])
    const [region] = zoneRegions(placements, locations, 0)
    expect(region.edges).toHaveLength(6)
    // The seam at x=3 is interior to the zone and must not be drawn.
    expect(region.edges).not.toContainEqual({ x1: 3, y1: 3, x2: 3, y2: 4 })
  })

  // The whole reason for an edge union rather than a bounding box: an L-shaped
  // zone's bbox would cover cells belonging to a neighbouring zone.
  it('traces an L-shape without covering the notch', () => {
    const { locations, placements } = coldFixture([[0, 0], [1, 0], [0, 1]])
    const [region] = zoneRegions(placements, locations, 0)
    expect(region.cells).toHaveLength(3)
    // A 2x2 bbox would have 8 perimeter edges; the L has 8 too, but the notch
    // corner at (1,1) must be traced, not filled.
    expect(region.cells).not.toContainEqual({ x: 1, y: 1 })
    expect(region.edges).toContainEqual({ x1: 1, y1: 1, x2: 2, y2: 1 }) // underside of (1,0)
    expect(region.edges).toContainEqual({ x1: 1, y1: 1, x2: 1, y2: 2 }) // right of (0,1)
  })

  it('gives each of two touching zones its own boundary along the seam', () => {
    const locations = new Map<number, InventoryLocation>([
      [1, zone(1, 'A', '/MAIN/A')],
      [2, zone(2, 'B', '/MAIN/B')],
      [10, binLoc(10, 'a1', '/MAIN/A/a1')],
      [20, binLoc(20, 'b1', '/MAIN/B/b1')],
    ])
    const regions = zoneRegions([bin(10, 0, 0), bin(20, 1, 0)], locations, 0)
    expect(regions).toHaveLength(2)
    for (const r of regions) expect(r.edges).toHaveLength(4)
  })
})

describe('zoneRegions — nesting and labelling', () => {
  it('assigns a bin to its DEEPEST ancestor zone', () => {
    const locations = new Map<number, InventoryLocation>([
      [1, zone(1, 'OUTER', '/MAIN/OUTER')],
      [2, zone(2, 'INNER', '/MAIN/OUTER/INNER')],
      [10, binLoc(10, 'b', '/MAIN/OUTER/INNER/b')],
    ])
    const regions = zoneRegions([bin(10, 1, 1)], locations, 0)
    expect(regions).toHaveLength(1)
    expect(regions[0].zoneId).toBe(2)
  })

  it('does not treat a zone as its own ancestor', () => {
    const locations = new Map<number, InventoryLocation>([
      [1, zone(1, 'COLD', '/MAIN/COLD')],
      [10, binLoc(10, 'b', '/MAIN/COLD/b')],
    ])
    // A path that merely starts with the same characters must not match:
    locations.set(2, zone(2, 'COLDER', '/MAIN/COLDE'))
    const regions = zoneRegions([bin(10, 0, 0)], locations, 0)
    expect(regions.map((r) => r.zoneId)).toEqual([1])
  })

  it('anchors the label at the top-left-most cell for a stable position', () => {
    const { locations, placements } = coldFixture([[5, 9], [4, 9], [4, 8]])
    const [region] = zoneRegions(placements, locations, 0)
    expect(region.labelAt).toEqual({ x: 4, y: 8 })
  })

  it('returns regions in a stable order (by zone id)', () => {
    const locations = new Map<number, InventoryLocation>([
      [5, zone(5, 'E', '/MAIN/E')],
      [2, zone(2, 'B', '/MAIN/B')],
      [50, binLoc(50, 'e', '/MAIN/E/e')],
      [20, binLoc(20, 'b', '/MAIN/B/b')],
    ])
    const regions = zoneRegions([bin(50, 9, 9), bin(20, 0, 0)], locations, 0)
    expect(regions.map((r) => r.zoneId)).toEqual([2, 5])
  })
})
