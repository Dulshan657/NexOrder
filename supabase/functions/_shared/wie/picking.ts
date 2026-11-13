// Warehouse Intelligence Engine — pick-route sequencing.
//
// Orders a set of bin "stops" into the shortest walk that starts (and implicitly
// ends) at the dock, minimizing picker travel. Distances come from Dijkstra over
// the walkway skeleton (the same graph the publish pipeline builds); the route is
// a nearest-neighbour tour improved by 2-opt — cheap and good enough for the
// dozens-of-stops orders real pick lists have. Pure: graph + stops in, ordered
// route out. Batch picking layers on top by merging several orders' stops.

import { dijkstra, dijkstraWithPaths, pathTo, toAdjacency } from './graph.ts'
import type { WarehouseGraph } from './types.ts'

export interface PickStop {
  locationId: number
  /** Snapped walkway node for this bin; null ⇒ unreachable (appended, no leg). */
  graphNodeId: number | null
  /** Perpendicular metres from the node into the bin (added to the arriving leg). */
  accessOffsetM: number
  /** Optional passthrough payload (product, qty, batch, order…) — untouched. */
  meta?: Record<string, unknown>
}

export interface RoutedStop extends PickStop {
  sequence: number
  /** Travel from the previous stop (or the dock for the first) to this bin. */
  legDistanceM: number
}

export interface PickRoute {
  stops: RoutedStop[]
  totalDistanceM: number
  /** Stops with no route from the dock, returned unsequenced for visibility. */
  unreachable: PickStop[]
}

/** Cache Dijkstra results per source node so we build the small stop×stop matrix
 *  without recomputing shortest paths. A caller (e.g. the simulator, which routes
 *  many orders over the same graph) may pass a shared cache to reuse across calls. */
export type DistanceCache = Map<number, Map<number, number>>

function distanceLookup(graph: WarehouseGraph, cache: DistanceCache): (from: number, to: number) => number {
  const distsFrom = (n: number): Map<number, number> => {
    let d = cache.get(n)
    if (!d) {
      d = dijkstra(graph, n)
      cache.set(n, d)
    }
    return d
  }
  return (from, to) => distsFrom(from).get(to) ?? Infinity
}

function tourLength(order: number[], nodeOf: number[], dist: (a: number, b: number) => number, startNode: number): number {
  let total = 0
  let prev = startNode
  for (const idx of order) {
    total += dist(prev, nodeOf[idx])
    prev = nodeOf[idx]
  }
  return total
}

/**
 * Sequence pick stops into a shortest-travel route from `startNodeId` (the dock).
 * Unreachable stops (no graph node, or no path from the dock) are excluded from
 * the tour and returned in `unreachable`.
 */
export function sequencePickRoute(
  graph: WarehouseGraph,
  startNodeId: number,
  stops: PickStop[],
  distanceCache?: DistanceCache,
): PickRoute {
  const dist = distanceLookup(graph, distanceCache ?? new Map())

  // Partition into routable (reachable from the dock) and unreachable.
  const routable: PickStop[] = []
  const unreachable: PickStop[] = []
  for (const s of stops) {
    if (s.graphNodeId !== null && dist(startNodeId, s.graphNodeId) !== Infinity) routable.push(s)
    else unreachable.push(s)
  }

  const n = routable.length
  if (n === 0) return { stops: [], totalDistanceM: 0, unreachable }

  const nodeOf = routable.map((s) => s.graphNodeId as number)

  // Nearest-neighbour tour from the dock.
  const visited = new Array<boolean>(n).fill(false)
  const order: number[] = []
  let current = startNodeId
  for (let step = 0; step < n; step++) {
    let bestIdx = -1
    let bestDist = Infinity
    for (let i = 0; i < n; i++) {
      if (visited[i]) continue
      const d = dist(current, nodeOf[i])
      if (d < bestDist) { bestDist = d; bestIdx = i }
    }
    visited[bestIdx] = true
    order.push(bestIdx)
    current = nodeOf[bestIdx]
  }

  // 2-opt: reverse segments while it shortens the open tour (dock → last stop).
  // Skip it for very large tours (batch mode) — nearest-neighbour alone keeps the
  // per-request cost bounded; 2-opt here is O(n³) and only worth it at pick-list
  // sizes. `currentLen` is tracked so we don't recompute the invariant baseline.
  const TWO_OPT_MAX = 150
  if (n <= TWO_OPT_MAX) {
    let currentLen = tourLength(order, nodeOf, dist, startNodeId)
    let improved = true
    let guard = 0
    while (improved && guard < 60) {
      improved = false
      guard++
      for (let i = 0; i < n - 1; i++) {
        for (let k = i + 1; k < n; k++) {
          const candidate = order.slice(0, i).concat(order.slice(i, k + 1).reverse(), order.slice(k + 1))
          const after = tourLength(candidate, nodeOf, dist, startNodeId)
          if (after < currentLen - 1e-6) {
            order.splice(0, order.length, ...candidate)
            currentLen = after
            improved = true
          }
        }
      }
    }
  }

  // Materialize the ordered route, adding each bin's access offset to its leg.
  const routed: RoutedStop[] = []
  let total = 0
  let prevNode = startNodeId
  order.forEach((idx, seq) => {
    const stop = routable[idx]
    const leg = dist(prevNode, nodeOf[idx]) + stop.accessOffsetM
    total += leg
    routed.push({ ...stop, sequence: seq + 1, legDistanceM: leg })
    prevNode = nodeOf[idx]
  })

  return { stops: routed, totalDistanceM: total, unreachable }
}

/**
 * Batch several orders' stops into ONE route (batch picking). Stops keep their
 * `meta` so the caller can split picked quantities back to their orders. This is
 * a single shortest tour over the union of stops.
 */
export function sequenceBatchRoute(
  graph: WarehouseGraph,
  startNodeId: number,
  stopsByOrder: Record<string, PickStop[]>,
): PickRoute {
  const merged: PickStop[] = []
  for (const [orderId, stops] of Object.entries(stopsByOrder)) {
    for (const s of stops) merged.push({ ...s, meta: { ...(s.meta ?? {}), orderId } })
  }
  return sequencePickRoute(graph, startNodeId, merged)
}

/**
 * The walk behind each leg of a sequenced route (NX-0037): node paths from the
 * same Dijkstra the sequencer measured with, so the drawn path is the measured
 * one. Leg i runs from the previous stop's node (the start node for the first)
 * to stop i's node; null where no path exists (the sequencer excludes those
 * stops, so in practice none).
 */
export function legPaths(graph: WarehouseGraph, startNodeId: number, stops: readonly RoutedStop[]): (number[] | null)[] {
  // One adjacency for the whole route, and each search stops as soon as its
  // leg's target is settled — a big batch route must not cost a second full
  // Dijkstra per stop on top of the sequencer's.
  const adj = toAdjacency(graph)
  const out: (number[] | null)[] = []
  let from = startNodeId
  for (const s of stops) {
    if (s.graphNodeId == null) {
      out.push(null)
      continue
    }
    const { prev } = dijkstraWithPaths(graph, from, { adj, target: s.graphNodeId })
    out.push(pathTo(prev, from, s.graphNodeId))
    from = s.graphNodeId
  }
  return out
}

export interface PathPoint {
  floor: number
  x: number
  y: number
}

/**
 * Corners only. Walk-graph nodes are grid cells, so a 40-cell aisle is 40 points
 * that draw the same as its two ends; keeping only direction changes (and floor
 * changes — a lift) keeps the response small without changing the line.
 */
export function simplifyPath<T extends PathPoint>(points: readonly T[]): T[] {
  if (points.length <= 2) return [...points]
  const out: T[] = [points[0]]
  for (let i = 1; i < points.length - 1; i++) {
    const a = points[i - 1]
    const b = points[i]
    const c = points[i + 1]
    const straight =
      a.floor === b.floor && b.floor === c.floor &&
      (b.x - a.x) * (c.y - b.y) === (b.y - a.y) * (c.x - b.x)
    if (!straight) out.push(b)
  }
  out.push(points[points.length - 1])
  return out
}

