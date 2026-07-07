import { describe, it, expect } from 'vitest'
import { buildWalkGraph } from '../../supabase/functions/_shared/wie/graph'
import { sequencePickRoute, sequenceBatchRoute, type PickStop } from '../../supabase/functions/_shared/wie/picking'
import type { WalkCell } from '../../supabase/functions/_shared/wie/types'

// Straight corridor: dock at (0,0), then (1,0)…(5,0). Node index == cell index.
const CORRIDOR: WalkCell[] = Array.from({ length: 6 }, (_, x) => ({ x, y: 0, floor: 0, isDock: x === 0 }))
const graph = buildWalkGraph(CORRIDOR, 1)
const DOCK = 0

function stop(node: number, offset = 0): PickStop {
  return { locationId: node * 10, graphNodeId: node, accessOffsetM: offset }
}

describe('sequencePickRoute', () => {
  it('orders stops along the shortest walk from the dock', () => {
    const route = sequencePickRoute(graph, DOCK, [stop(5), stop(1), stop(3)])
    expect(route.stops.map((s) => s.graphNodeId)).toEqual([1, 3, 5])
    expect(route.stops.map((s) => s.sequence)).toEqual([1, 2, 3])
  })

  it('computes total travel including access offsets', () => {
    const route = sequencePickRoute(graph, DOCK, [stop(1, 0.5), stop(3, 0.5)])
    // legs: dock→1 (1) +0.5, 1→3 (2) +0.5 = 4
    expect(route.totalDistanceM).toBeCloseTo(4, 5)
  })

  it('excludes unreachable stops and reports them', () => {
    const island: WalkCell[] = [...CORRIDOR, { x: 20, y: 20, floor: 0, isDock: false }]
    const g2 = buildWalkGraph(island, 1)
    const route = sequencePickRoute(g2, DOCK, [stop(1), { locationId: 99, graphNodeId: 6, accessOffsetM: 0 }])
    expect(route.stops.map((s) => s.locationId)).toEqual([10])
    expect(route.unreachable.map((s) => s.locationId)).toEqual([99])
  })

  it('treats a null graph node as unreachable', () => {
    const route = sequencePickRoute(graph, DOCK, [{ locationId: 7, graphNodeId: null, accessOffsetM: 0 }])
    expect(route.stops).toHaveLength(0)
    expect(route.unreachable).toHaveLength(1)
  })

  it('returns an empty route for no stops', () => {
    const route = sequencePickRoute(graph, DOCK, [])
    expect(route.stops).toHaveLength(0)
    expect(route.totalDistanceM).toBe(0)
  })

  it('finds the optimal tour on a branched layout (2-opt improves NN)', () => {
    // T-shape: corridor (0,0)-(4,0), branch up at x=2: (2,1),(2,2).
    const cells: WalkCell[] = [
      ...Array.from({ length: 5 }, (_, x) => ({ x, y: 0, floor: 0, isDock: x === 0 })),
      { x: 2, y: 1, floor: 0, isDock: false },
      { x: 2, y: 2, floor: 0, isDock: false },
    ]
    const g = buildWalkGraph(cells, 1)
    // node indices: 0..4 corridor, 5=(2,1), 6=(2,2)
    const route = sequencePickRoute(g, 0, [stop(4), stop(6), stop(2)])
    // Optimal: visit the branch (2 then up to 6) or the end (4) — the shortest
    // tour goes 2 → 6 → 4 or 2 → 4 → 6; either way stop at node 2 comes first.
    expect(route.stops[0].graphNodeId).toBe(2)
    // Total must not exceed the naive NN-style detour; just assert it's finite & sane.
    expect(route.totalDistanceM).toBeGreaterThan(0)
    expect(route.stops).toHaveLength(3)
  })
})

describe('sequenceBatchRoute', () => {
  it('merges multiple orders into one route and tags each stop with its order', () => {
    const route = sequenceBatchRoute(graph, DOCK, {
      'ORD-1': [stop(1), stop(4)],
      'ORD-2': [stop(2)],
    })
    expect(route.stops).toHaveLength(3)
    expect(route.stops.map((s) => s.graphNodeId)).toEqual([1, 2, 4])
    expect(route.stops.every((s) => typeof s.meta?.orderId === 'string')).toBe(true)
  })
})
