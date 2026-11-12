import { describe, it, expect } from 'vitest'
import {
  allNodesReachable,
  buildWalkGraph,
  computeAnchorDistances,
  dijkstra,
  dijkstraWithPaths,
  pathTo,
  snapPlacementToNode,
} from '../../supabase/functions/_shared/wie/graph'
import type { WalkCell } from '../../supabase/functions/_shared/wie/types'

// L-shaped walkway: (0,0)dock — (1,0) — (2,0) — (2,1) — (2,2)
const L_CELLS: WalkCell[] = [
  { x: 0, y: 0, floor: 0, isDock: true },
  { x: 1, y: 0, floor: 0, isDock: false },
  { x: 2, y: 0, floor: 0, isDock: false },
  { x: 2, y: 1, floor: 0, isDock: false },
  { x: 2, y: 2, floor: 0, isDock: false },
]

describe('buildWalkGraph', () => {
  it('creates one node per cell and one edge per orthogonal adjacency', () => {
    const g = buildWalkGraph(L_CELLS, 1)
    expect(g.nodes).toHaveLength(5)
    expect(g.edges).toHaveLength(4)
  })

  it('tags dock cells regardless of degree and classifies junctions vs walk', () => {
    const g = buildWalkGraph(L_CELLS, 1)
    expect(g.nodes[0].nodeType).toBe('dock') // degree 1 but a dock
    expect(g.nodes[1].nodeType).toBe('walk') // degree 2
    expect(g.nodes[2].nodeType).toBe('walk') // corner, still degree 2
    expect(g.nodes[4].nodeType).toBe('junction') // dead end, degree 1
  })

  it('weights edges by cell size', () => {
    const g = buildWalkGraph(L_CELLS, 1.5)
    expect(g.edges.every((e) => e.weightM === 1.5)).toBe(true)
  })
})

describe('dijkstra', () => {
  it('computes shortest distance along the walkway', () => {
    const g = buildWalkGraph(L_CELLS, 1)
    const dist = dijkstra(g, 0)
    expect(dist.get(0)).toBe(0)
    expect(dist.get(4)).toBe(4)
  })

  it('omits unreachable nodes from the result', () => {
    const cells: WalkCell[] = [
      { x: 0, y: 0, floor: 0, isDock: true },
      { x: 5, y: 5, floor: 0, isDock: false }, // island
    ]
    const g = buildWalkGraph(cells, 1)
    const dist = dijkstra(g, 0)
    expect(dist.has(1)).toBe(false)
  })
})

describe('computeAnchorDistances', () => {
  it('emits a row per (anchor, reachable node)', () => {
    const g = buildWalkGraph(L_CELLS, 1)
    const rows = computeAnchorDistances(g, [0])
    expect(rows).toHaveLength(5)
    const toEnd = rows.find((r) => r.toNodeId === 4)
    expect(toEnd?.distanceM).toBe(4)
  })
})

describe('snapPlacementToNode', () => {
  it('snaps a footprint to its nearest walk node and reports the offset', () => {
    const g = buildWalkGraph(L_CELLS, 1)
    const snap = snapPlacementToNode({ locationId: 99, floor: 0, x: 3, y: 2, w: 1, h: 1 }, g.nodes, 1)
    expect(snap.graphNodeId).toBe(4) // node at (2,2)
    expect(snap.accessOffsetM).toBeGreaterThan(0)
  })

  it('returns null when no node shares the footprint floor', () => {
    const g = buildWalkGraph(L_CELLS, 1)
    const snap = snapPlacementToNode({ locationId: 99, floor: 3, x: 0, y: 0, w: 1, h: 1 }, g.nodes, 1)
    expect(snap.graphNodeId).toBeNull()
  })
})

describe('multi-floor lifts', () => {
  // floor 0: (0,0)dock — (1,0) — (2,0)lift ; floor 1: (2,0)lift — (3,0)
  const cells: WalkCell[] = [
    { x: 0, y: 0, floor: 0, isDock: true },
    { x: 1, y: 0, floor: 0, isDock: false },
    { x: 2, y: 0, floor: 0, isDock: false, isLift: true },
    { x: 2, y: 0, floor: 1, isDock: false, isLift: true },
    { x: 3, y: 0, floor: 1, isDock: false },
  ]

  it('tags lift cells and connects floors vertically', () => {
    const g = buildWalkGraph(cells, 1)
    expect(g.nodes[2].nodeType).toBe('lift')
    expect(g.nodes[3].nodeType).toBe('lift')
    // a lift edge exists between the two lift nodes
    const liftEdge = g.edges.find((e) => (e.fromNode === 2 && e.toNode === 3) || (e.fromNode === 3 && e.toNode === 2))
    expect(liftEdge).toBeDefined()
  })

  it('routes across floors through the lift', () => {
    const g = buildWalkGraph(cells, 1)
    const dist = dijkstra(g, 0)
    // dock→(1,0)=1, →(2,0)=2, lift up (+3)=5, →(3,0,f1)=6
    expect(dist.get(4)).toBe(6)
  })
})

describe('allNodesReachable', () => {
  it('is true when every node is reachable from an anchor', () => {
    const g = buildWalkGraph(L_CELLS, 1)
    expect(allNodesReachable(g, [0])).toBe(true)
  })

  it('is false when a node is stranded from all anchors', () => {
    const cells: WalkCell[] = [
      { x: 0, y: 0, floor: 0, isDock: true },
      { x: 5, y: 5, floor: 0, isDock: false },
    ]
    const g = buildWalkGraph(cells, 1)
    expect(allNodesReachable(g, [0])).toBe(false)
  })
})

// NX-0037: the route the engine computed, not just its length. An L-shaped
// corridor so the shortest path has a corner.
describe('dijkstraWithPaths', () => {
  const L: WalkCell[] = [
    ...Array.from({ length: 5 }, (_, x) => ({ x, y: 0, floor: 0, isDock: x === 0 })),
    ...Array.from({ length: 3 }, (_, i) => ({ x: 4, y: i + 1, floor: 0, isDock: false })),
  ]
  const g = buildWalkGraph(L, 1.5)
  const idAt = (x: number, y: number) => g.nodes.find((n) => n.x === x && n.y === y)!.id

  it('gives an edge-contiguous path whose weights sum to the distance', () => {
    const { dist, prev } = dijkstraWithPaths(g, idAt(0, 0))
    const target = idAt(4, 3)
    const path = pathTo(prev, idAt(0, 0), target)!
    expect(path[0]).toBe(idAt(0, 0))
    expect(path[path.length - 1]).toBe(target)
    let sum = 0
    for (let i = 1; i < path.length; i++) {
      const e = g.edges.find((ed) =>
        (ed.fromNode === path[i - 1] && ed.toNode === path[i]) ||
        (ed.bidirectional && ed.fromNode === path[i] && ed.toNode === path[i - 1]))
      expect(e, `no edge ${path[i - 1]}→${path[i]}`).toBeDefined()
      sum += e!.weightM
    }
    expect(sum).toBeCloseTo(dist.get(target)!, 6)
    // The distance-only API is the same answer.
    expect(dijkstra(g, idAt(0, 0))).toEqual(dist)
    // Source to itself is the one-node path.
    expect(pathTo(prev, idAt(0, 0), idAt(0, 0))).toEqual([idAt(0, 0)])
  })

  it('gives no path to an unreachable node', () => {
    const g2 = buildWalkGraph([...L, { x: 20, y: 20, floor: 0, isDock: false }], 1.5)
    const island = g2.nodes.find((n) => n.x === 20)!.id
    const { dist, prev } = dijkstraWithPaths(g2, 0)
    expect(dist.has(island)).toBe(false)
    expect(pathTo(prev, 0, island)).toBeNull()
  })
})
