// NX-0037 A7: the 2D map draws the engine's walk, not straight stop-to-stop lines.

import { describe, it, expect } from 'vitest'
import type { PickRouteStop } from '@/types'
import { routeOverlay2d, type RoutePlacement } from '@/lib/warehouseRoute2d'

function stop(sequence: number, locationId: number, path?: PickRouteStop['path']): PickRouteStop {
  return {
    sequence, locationId, code: null, productId: null, orderItemId: null, orderId: null,
    qtyBase: 1, legDistanceM: 1, path,
  }
}

// Location 1: a 1x1 bay at (5,2). Location 2: a 2x1 bay at (8,6). Location 3: floor 1.
const placements = new Map<number, RoutePlacement>([
  [1, { x: 5, y: 2, w: 1, h: 1, floor: 0 }],
  [2, { x: 8, y: 6, w: 2, h: 1, floor: 0 }],
  [3, { x: 1, y: 1, w: 1, h: 1, floor: 1 }],
])

describe('routeOverlay2d', () => {
  it("draws each leg from the dock along the engine's walk to the stop", () => {
    const stops = [
      stop(1, 1, [{ floor: 0, x: 0, y: 0 }, { floor: 0, x: 5, y: 0 }, { floor: 0, x: 5, y: 1 }]),
      stop(2, 2, [{ floor: 0, x: 5, y: 1 }, { floor: 0, x: 8, y: 1 }, { floor: 0, x: 8, y: 5 }]),
    ]
    const r = routeOverlay2d(stops, placements, 0)
    // Cell centres along the walk, then into the bay's centre.
    expect(r.legs).toEqual([
      [[0.5, 0.5], [5.5, 0.5], [5.5, 1.5], [5.5, 2.5]],
      [[5.5, 1.5], [8.5, 1.5], [8.5, 5.5], [9, 6.5]],
    ])
    expect(r.start).toEqual([0.5, 0.5])
    expect(r.markers).toEqual([
      { locationId: 1, x: 5.5, y: 2.5, label: '1' },
      { locationId: 2, x: 9, y: 6.5, label: '2' },
    ])
  })

  it('falls back to a straight leg from the previous stop when a stop has no path', () => {
    const r = routeOverlay2d([stop(1, 1), stop(2, 2)], placements, 0)
    // No path for stop 1 → no dock leg and no start; stop 2 joins straight to stop 1.
    expect(r.legs).toEqual([[[5.5, 2.5], [9, 6.5]]])
    expect(r.start).toBeNull()
    expect(r.markers.map((m) => m.label)).toEqual(['1', '2'])
  })

  it('draws only the floor being viewed', () => {
    const stops = [
      stop(1, 1, [{ floor: 0, x: 0, y: 0 }, { floor: 0, x: 5, y: 1 }]),
      // A lift leg: leaves floor 0, arrives on floor 1.
      stop(2, 3, [{ floor: 0, x: 5, y: 1 }, { floor: 0, x: 9, y: 9 }, { floor: 1, x: 9, y: 9 }, { floor: 1, x: 1, y: 0 }]),
      // Back on floor 0 with no path: never a straight line through the ceiling.
      stop(3, 2),
    ]
    const f0 = routeOverlay2d(stops, placements, 0)
    expect(f0.markers.map((m) => m.locationId)).toEqual([1, 2])
    expect(f0.legs).toEqual([
      [[0.5, 0.5], [5.5, 1.5], [5.5, 2.5]],
      [[5.5, 1.5], [9.5, 9.5]],
    ])
    const f1 = routeOverlay2d(stops, placements, 1)
    expect(f1.start).toBeNull()
    expect(f1.markers.map((m) => m.locationId)).toEqual([3])
    expect(f1.legs).toEqual([[[9.5, 9.5], [1.5, 0.5], [1.5, 1.5]]])
  })
})
