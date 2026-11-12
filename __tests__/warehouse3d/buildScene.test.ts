// NX-0035 A3/A4: the pure scene model behind the 3D live map.
//
// Everything the renderer draws is decided here, in metres, so it can be tested
// without WebGL (jsdom has none). The renderer only turns these specs into meshes.

import { describe, it, expect } from 'vitest'
import type { InventoryLocation, LayoutObject, LayoutPlacement } from '@/types'
import { buildScene, type BuildSceneInput } from '@/lib/warehouse3d/buildScene'
import { occupancyFill } from '@/components/inventory/warehouse/warehouseOverlays'

const CELL = 1.5
const LEVEL_H = 2

function placement(p: Partial<LayoutPlacement> & { locationId: number }): LayoutPlacement {
  return { id: p.locationId, layoutId: 1, floor: 0, x: 0, y: 0, w: 1, h: 1, rotation: 0, ...p } as LayoutPlacement
}

function loc(l: Partial<InventoryLocation> & { id: number }): InventoryLocation {
  return { code: `L${l.id}`, name: `L${l.id}`, kind: 'SHELF', materializedPath: `/${l.id}`, isActive: true, ...l } as InventoryLocation
}

function input(over: Partial<BuildSceneInput> = {}): BuildSceneInput {
  return {
    layout: { cellSizeM: CELL, gridWidth: 20, gridHeight: 10 },
    placements: [],
    objects: [],
    floor: 0,
    locationsById: new Map(),
    binFillPct: new Map(),
    zoneTypeByProfileId: new Map(),
    levelHeightM: LEVEL_H,
    ...over,
  }
}

// A 3-level rack at (4, 2), 2 cells wide, levels deliberately out of order.
const rackPlacements = [
  placement({ locationId: 13, x: 4, y: 2, w: 2, h: 1, levelIndex: 3 }),
  placement({ locationId: 11, x: 4, y: 2, w: 2, h: 1, levelIndex: 1 }),
  placement({ locationId: 12, x: 4, y: 2, w: 2, h: 1, levelIndex: 2 }),
]
const rackLocations = new Map<number, InventoryLocation>([
  [10, loc({ id: 10, kind: 'RACK' })],
  [11, loc({ id: 11, parentId: 10, levelIndex: 1 })],
  [12, loc({ id: 12, parentId: 10, levelIndex: 2 })],
  [13, loc({ id: 13, parentId: 10, levelIndex: 3 })],
])

describe('buildScene', () => {
  it('places a rack in metres from cellSizeM and stacks its levels bottom-first', () => {
    const scene = buildScene(input({ placements: rackPlacements, locationsById: rackLocations }))

    expect(scene.levels.map((l) => l.locationId)).toEqual([11, 12, 13])
    // Footprint: x 4..6, y 2..3 cells → centre (5, 2.5) cells → metres.
    for (const level of scene.levels) {
      expect(level.center[0]).toBeCloseTo(5 * CELL)
      expect(level.center[2]).toBeCloseTo(2.5 * CELL)
      expect(level.size).toEqual([2 * CELL, LEVEL_H, 1 * CELL])
    }
    expect(scene.levels.map((l) => l.center[1])).toEqual([1, 3, 5])

    expect(scene.racks).toHaveLength(1)
    expect(scene.racks[0].levelCount).toBe(3)
    expect(scene.racks[0].size[1]).toBeCloseTo(3 * LEVEL_H)
  })

  it("carries each level's location id and colours it by fill, null fill as unknown", () => {
    const binFillPct = new Map<number, number | null>([[11, 0.9], [12, 0.1], [13, null]])
    const scene = buildScene(input({ placements: rackPlacements, locationsById: rackLocations, binFillPct }))

    const byId = new Map(scene.levels.map((l) => [l.locationId, l]))
    expect(byId.get(11)).toMatchObject({ fillPct: 0.9, fillKnown: true, color: occupancyFill(0.9) })
    expect(byId.get(12)).toMatchObject({ fillPct: 0.1, fillKnown: true, color: occupancyFill(0.1) })
    expect(byId.get(13)).toMatchObject({ fillPct: null, fillKnown: false, color: occupancyFill(null) })
  })

  it('prefers the active overlay colour over occupancy', () => {
    const binFillPct = new Map<number, number | null>([[11, 0.9]])
    const binColors = new Map<number, string>([[11, '#123456']])
    const scene = buildScene(input({ placements: rackPlacements, locationsById: rackLocations, binFillPct, binColors }))

    expect(scene.levels.find((l) => l.locationId === 11)?.color).toBe('#123456')
    // A level the overlay says nothing about keeps its occupancy colour.
    expect(scene.levels.find((l) => l.locationId === 12)?.color).toBe(occupancyFill(null))
  })

  it('builds only the active floor', () => {
    const placements = [
      placement({ locationId: 1, floor: 0, x: 1, y: 1 }),
      placement({ locationId: 2, floor: 1, x: 1, y: 1 }),
    ]
    const objects = [
      { id: 7, layoutId: 1, objectType: 'wall', floor: 1, x: 0, y: 0, w: 1, h: 1, meta: {} },
      { id: 8, layoutId: 1, objectType: 'wall', floor: 0, x: 0, y: 0, w: 1, h: 1, meta: {} },
    ] as LayoutObject[]
    const locationsById = new Map([[1, loc({ id: 1, kind: 'BIN' })], [2, loc({ id: 2, kind: 'BIN' })]])

    const scene = buildScene(input({ placements, objects, locationsById, floor: 1 }))
    expect(scene.levels.map((l) => l.locationId)).toEqual([2])
    expect(scene.objects.map((o) => o.id)).toEqual([7])
  })

  it('draws a legacy single bin as one level', () => {
    const placements = [placement({ locationId: 1, x: 0, y: 0 })]
    const locationsById = new Map([[1, loc({ id: 1, kind: 'BIN' })]])
    const scene = buildScene(input({ placements, locationsById }))
    expect(scene.levels).toHaveLength(1)
    expect(scene.levels[0].center[1]).toBeCloseTo(LEVEL_H / 2)
  })

  it("tints a rack frame by its zone ancestor's profile", () => {
    const locationsById = new Map(rackLocations)
    locationsById.set(5, loc({ id: 5, kind: 'ZONE', zoneProfileId: 99 }))
    locationsById.set(10, loc({ id: 10, kind: 'RACK', parentId: 5 }))
    const scene = buildScene(input({
      placements: rackPlacements,
      locationsById,
      zoneTypeByProfileId: new Map([[99, 'COLD']]),
    }))
    expect(scene.racks[0].zoneType).toBe('COLD')
  })

  it('reports scene bounds from the layout grid', () => {
    const scene = buildScene(input())
    expect(scene.bounds).toMatchObject({ width: 20 * CELL, depth: 10 * CELL })
    expect(scene.bounds.center[0]).toBeCloseTo(10 * CELL)
    expect(scene.bounds.center[2]).toBeCloseTo(5 * CELL)
  })
})
