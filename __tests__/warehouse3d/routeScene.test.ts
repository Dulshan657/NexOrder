// NX-0037 A3/A4: the pick walk in 3D, from the engine's own path.

import { describe, it, expect } from 'vitest'
import type { PickRouteStop } from '@/types'
import type { LevelBox } from '@/lib/warehouse3d/buildScene'
import { routeScene, WALK_HEIGHT_M } from '@/lib/warehouse3d/routeScene'

const CELL = 1.5

function level(locationId: number, center: [number, number, number]): LevelBox {
  return {
    locationId, levelIndex: 1, center, size: [CELL, 2, CELL],
    fillPct: 0.5, fillKnown: true, color: '#000', colorSource: 'occupancy', highlighted: false,
  }
}

function stop(sequence: number, locationId: number, path?: PickRouteStop['path']): PickRouteStop {
  return {
    sequence, locationId, code: null, productId: null, orderItemId: null, orderId: null,
    qtyBase: 1, legDistanceM: 1, path,
  }
}

// Levels: location 1 at grid (5,2) level 2 (y = 3 m); location 2 at grid (8,6).
const levels = [level(1, [5.5 * CELL, 3, 2.5 * CELL]), level(2, [8.5 * CELL, 1, 6.5 * CELL])]

describe('routeScene', () => {
  it("draws each leg along its corners in metres, with a riser to the stop's level", () => {
    const stops = [
      stop(1, 1, [{ floor: 0, x: 0, y: 0 }, { floor: 0, x: 5, y: 0 }, { floor: 0, x: 5, y: 1 }]),
    ]
    const { lines, markers } = routeScene({ stops, levels, floor: 0, cellSizeM: CELL })
    expect(lines).toHaveLength(1)
    const pts = lines[0]
    // Corners at walking height, cell centres in metres.
    expect(pts[0]).toEqual([0.5 * CELL, WALK_HEIGHT_M, 0.5 * CELL])
    expect(pts[1]).toEqual([5.5 * CELL, WALK_HEIGHT_M, 0.5 * CELL])
    expect(pts[2]).toEqual([5.5 * CELL, WALK_HEIGHT_M, 1.5 * CELL])
    // Riser: straight up at the aisle end, then into the level.
    expect(pts[3]).toEqual([5.5 * CELL, 3, 1.5 * CELL])
    expect(pts[4]).toEqual(levels[0].center)
    expect(markers).toEqual([{ sequence: 1, locationId: 1, position: expect.any(Array) }])
    expect(markers[0].position[1]).toBeGreaterThan(3)
  })

  it('falls back to a straight leg when a stop has no path', () => {
    const stops = [
      stop(1, 1, [{ floor: 0, x: 0, y: 0 }, { floor: 0, x: 5, y: 1 }]),
      stop(2, 2), // an older function: no path field
    ]
    const { lines, markers } = routeScene({ stops, levels, floor: 0, cellSizeM: CELL })
    expect(lines).toHaveLength(2)
    expect(lines[1]).toEqual([levels[0].center, levels[1].center])
    expect(markers.map((m) => m.sequence)).toEqual([1, 2])
  })

  it('draws only legs on the floor being viewed', () => {
    const stops = [
      // Walk starts on floor 0, takes the lift at (3,3), ends on floor 1.
      stop(1, 1, [
        { floor: 0, x: 0, y: 0 }, { floor: 0, x: 3, y: 0 }, { floor: 0, x: 3, y: 3 },
        { floor: 1, x: 3, y: 3 }, { floor: 1, x: 5, y: 3 },
      ]),
    ]
    // Viewing floor 0: only the floor-0 run, and no riser (the stop's level is
    // not in this floor's scene, so `levels` is empty).
    const f0 = routeScene({ stops, levels: [], floor: 0, cellSizeM: CELL })
    expect(f0.lines).toHaveLength(1)
    expect(f0.lines[0].map((p) => p[0] / CELL - 0.5)).toEqual([0, 3, 3])
    expect(f0.markers).toEqual([])
    // Viewing floor 1: only the floor-1 run, ending at the level.
    const f1 = routeScene({ stops, levels, floor: 1, cellSizeM: CELL })
    expect(f1.lines).toHaveLength(1)
    expect(f1.lines[0][0]).toEqual([3.5 * CELL, WALK_HEIGHT_M, 3.5 * CELL])
    expect(f1.lines[0][f1.lines[0].length - 1]).toEqual(levels[0].center)
  })
})
