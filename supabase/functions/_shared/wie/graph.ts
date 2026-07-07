// Warehouse Intelligence Engine — walkway graph.
//
// Used at PUBLISH time only: turn a layout's walkable cells into a routing
// skeleton, snap storage footprints onto it, and precompute anchor→node
// distances into layout_travel_distances. The runtime recommend path never
// pathfinds — it reads those precomputed distances via SQL.

import type {
  GraphEdge,
  GraphNode,
  PlacementFootprint,
  WalkCell,
  WarehouseGraph,
} from './types.ts'

function cellKey(x: number, y: number, floor: number): string {
  return `${floor}:${x}:${y}`
}

const ORTHO: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
]

/**
 * Build a walkway skeleton from walkable grid cells. Each walk cell becomes a
 * node; orthogonally-adjacent walk cells on the same floor are connected with an
 * edge weighted by `cellSizeM`. A cell with exactly two walk neighbors is a plain
 * 'walk' node; anything else is a 'junction' (endpoints, corners, intersections).
 * Dock cells are tagged 'dock' regardless of degree so they serve as anchors.
 *
 * Node `id` is the 0-based index into the returned `nodes` array; the publish
 * pipeline maps these to real DB ids before writing edges.
 */
export function buildWalkGraph(cells: WalkCell[], cellSizeM: number): WarehouseGraph {
  const index = new Map<string, number>()
  cells.forEach((c, i) => index.set(cellKey(c.x, c.y, c.floor), i))

  const nodes: GraphNode[] = cells.map((c, i) => {
    let degree = 0
    for (const [dx, dy] of ORTHO) {
      if (index.has(cellKey(c.x + dx, c.y + dy, c.floor))) degree++
    }
    const nodeType: GraphNode['nodeType'] = c.isDock
      ? 'dock'
      : c.isLift
        ? 'lift'
        : degree === 2
          ? 'walk'
          : 'junction'
    return { id: i, floor: c.floor, x: c.x, y: c.y, nodeType }
  })

  // Cost to change floors via a lift (metres-equivalent). A few cell-widths keeps
  // multi-floor routes sensible without needing a separate time model.
  const liftWeightM = cellSizeM * 3

  const edges: GraphEdge[] = []
  for (const c of cells) {
    const from = index.get(cellKey(c.x, c.y, c.floor))!
    // Only add the +x / +y direction to avoid duplicating each undirected edge.
    for (const [dx, dy] of [[1, 0], [0, 1]] as const) {
      const to = index.get(cellKey(c.x + dx, c.y + dy, c.floor))
      if (to !== undefined) {
        edges.push({ fromNode: from, toNode: to, weightM: cellSizeM, bidirectional: true })
      }
    }
    // Lift cell → the lift cell directly above it on the next floor (once per pair).
    if (c.isLift) {
      const up = index.get(cellKey(c.x, c.y, c.floor + 1))
      if (up !== undefined && cells[up].isLift) {
        edges.push({ fromNode: from, toNode: up, weightM: liftWeightM, bidirectional: true })
      }
    }
  }

  return { nodes, edges }
}

/** Adjacency list: nodeId → [{ to, weight }]. Expands bidirectional edges. */
function toAdjacency(graph: WarehouseGraph): Map<number, Array<{ to: number; weight: number }>> {
  const adj = new Map<number, Array<{ to: number; weight: number }>>()
  for (const n of graph.nodes) adj.set(n.id, [])
  for (const e of graph.edges) {
    adj.get(e.fromNode)?.push({ to: e.toNode, weight: e.weightM })
    if (e.bidirectional) adj.get(e.toNode)?.push({ to: e.fromNode, weight: e.weightM })
  }
  return adj
}

/** Binary min-heap keyed by distance. Small, dependency-free, good enough for the
 *  low-thousands-node skeletons the engine works with. */
class MinHeap {
  private heap: Array<{ node: number; dist: number }> = []

  get size(): number {
    return this.heap.length
  }

  push(node: number, dist: number): void {
    const h = this.heap
    h.push({ node, dist })
    let i = h.length - 1
    while (i > 0) {
      const parent = (i - 1) >> 1
      if (h[parent].dist <= h[i].dist) break
      ;[h[parent], h[i]] = [h[i], h[parent]]
      i = parent
    }
  }

  pop(): { node: number; dist: number } | undefined {
    const h = this.heap
    if (h.length === 0) return undefined
    const top = h[0]
    const last = h.pop()!
    if (h.length > 0) {
      h[0] = last
      let i = 0
      for (;;) {
        const l = 2 * i + 1
        const r = 2 * i + 2
        let smallest = i
        if (l < h.length && h[l].dist < h[smallest].dist) smallest = l
        if (r < h.length && h[r].dist < h[smallest].dist) smallest = r
        if (smallest === i) break
        ;[h[smallest], h[i]] = [h[i], h[smallest]]
        i = smallest
      }
    }
    return top
  }
}

/**
 * Dijkstra from a single source. Returns nodeId → shortest distance in metres for
 * every reachable node (unreachable nodes are absent from the map).
 */
export function dijkstra(graph: WarehouseGraph, sourceNodeId: number): Map<number, number> {
  const adj = toAdjacency(graph)
  const dist = new Map<number, number>()
  const heap = new MinHeap()
  dist.set(sourceNodeId, 0)
  heap.push(sourceNodeId, 0)

  while (heap.size > 0) {
    const { node, dist: d } = heap.pop()!
    if (d > (dist.get(node) ?? Infinity)) continue
    for (const { to, weight } of adj.get(node) ?? []) {
      const nd = d + weight
      if (nd < (dist.get(to) ?? Infinity)) {
        dist.set(to, nd)
        heap.push(to, nd)
      }
    }
  }
  return dist
}

export interface TravelDistanceRow {
  fromNodeId: number
  toNodeId: number
  distanceM: number
}

/**
 * Precompute shortest-path distances from each anchor node (docks + zone entries)
 * to every reachable node. Bounded by |anchors| × |nodes|; anchors are a small
 * set so this stays well under the 250k-row ceiling even for large warehouses.
 */
export function computeAnchorDistances(
  graph: WarehouseGraph,
  anchorNodeIds: number[],
): TravelDistanceRow[] {
  const rows: TravelDistanceRow[] = []
  for (const anchor of anchorNodeIds) {
    const dist = dijkstra(graph, anchor)
    for (const [toNodeId, distanceM] of dist) {
      rows.push({ fromNodeId: anchor, toNodeId, distanceM })
    }
  }
  return rows
}

/**
 * Snap a storage footprint to the nearest walkway node, returning that node's id
 * and the access offset (perpendicular metres from node centre to the footprint
 * edge). A footprint with no reachable walk node returns `graphNodeId: null` —
 * the publish validator flags it as unreachable.
 */
export function snapPlacementToNode(
  footprint: PlacementFootprint,
  nodes: GraphNode[],
  cellSizeM: number,
): { graphNodeId: number | null; accessOffsetM: number } {
  let best: { id: number; d2: number } | null = null
  const cx = footprint.x + footprint.w / 2
  const cy = footprint.y + footprint.h / 2
  for (const n of nodes) {
    if (n.floor !== footprint.floor) continue
    const dx = n.x - cx
    const dy = n.y - cy
    const d2 = dx * dx + dy * dy
    if (best === null || d2 < best.d2) best = { id: n.id, d2 }
  }
  if (best === null) return { graphNodeId: null, accessOffsetM: 0 }
  return { graphNodeId: best.id, accessOffsetM: Math.sqrt(best.d2) * cellSizeM }
}

/** True if every node is reachable from at least one anchor — the publish gate. */
export function allNodesReachable(graph: WarehouseGraph, anchorNodeIds: number[]): boolean {
  if (graph.nodes.length === 0) return true
  const reached = new Set<number>()
  for (const anchor of anchorNodeIds) {
    for (const nodeId of dijkstra(graph, anchor).keys()) reached.add(nodeId)
  }
  return graph.nodes.every((n) => reached.has(n.id))
}
