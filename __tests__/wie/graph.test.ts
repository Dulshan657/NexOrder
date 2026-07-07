import { describe, it, expect } from 'vitest'
import {
  allNodesReachable,
  buildWalkGraph,
  computeAnchorDistances,
  dijkstra,
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
