// Warehouse Intelligence Engine — analytical what-if simulation.
//
// Scores a layout by replaying historical order pick-stops through it and rolling
// up KPIs: total/avg picker travel (via the pick-route sequencer), space
// utilization, per-node congestion, and unreachable stops. Deterministic and
// pure — no simulated clock or agents; it re-derives what the KPIs WOULD be for a
// given layout so a draft can be compared against the active one before publish.

import { sequencePickRoute, type DistanceCache, type PickStop } from './picking.ts'
import type { WarehouseGraph } from './types.ts'

/** One allocated bin an order was picked from, for one historical order. */
export interface SimStop {
  locationId: number
  graphNodeId: number | null
  accessOffsetM: number
}

export interface SimOrder {
  orderId: string
  stops: SimStop[]
}

/** Current fill of a storage bin, for the utilization KPI. */
export interface SimBin {
  locationId: number
  graphNodeId: number | null
  capacitySlots: number | null
  usedSlots: number
}

export interface NodeCongestion {
  graphNodeId: number
  visits: number
}

export interface SimulationKpis {
  orderCount: number
  totalTravelM: number
  avgTravelPerOrderM: number
  /** Σ used / Σ capacity across capacitied bins, 0..1; null if no capacities set. */
  utilizationPct: number | null
  binsUsed: number
  binsTotal: number
  /** Pick visits per graph node, busiest first — the congestion heatmap source. */
  congestionByNode: NodeCongestion[]
  unreachableStops: number
}

function round(n: number, dp = 2): number {
  const f = 10 ** dp
  return Math.round(n * f) / f
}

/**
 * Replay `orders` through `graph` (dock at `dockNodeId`) and roll up KPIs. Each
 * order's travel is the shortest routed walk over its allocated bins; congestion
 * counts routed visits per node; utilization comes from `bins`.
 */
export function simulateLayout(
  graph: WarehouseGraph,
  dockNodeId: number,
  orders: SimOrder[],
  bins: SimBin[],
): SimulationKpis {
  let totalTravelM = 0
  let unreachableStops = 0
  const visitsByNode = new Map<number, number>()
  // One Dijkstra cache shared across every order — the same bin nodes recur, so
  // the hit rate is near-total and we never recompute a source's distances twice.
  const distCache: DistanceCache = new Map()

  for (const order of orders) {
    const stops: PickStop[] = order.stops.map((s) => ({
      locationId: s.locationId, graphNodeId: s.graphNodeId, accessOffsetM: s.accessOffsetM,
    }))
    const route = sequencePickRoute(graph, dockNodeId, stops, distCache)
    totalTravelM += route.totalDistanceM
    unreachableStops += route.unreachable.length
    for (const rs of route.stops) {
      if (rs.graphNodeId !== null) visitsByNode.set(rs.graphNodeId, (visitsByNode.get(rs.graphNodeId) ?? 0) + 1)
    }
  }

  const orderCount = orders.length
  const cappedBins = bins.filter((b) => b.capacitySlots !== null && b.capacitySlots > 0)
  const totalCapacity = cappedBins.reduce((s, b) => s + (b.capacitySlots as number), 0)
  const totalUsed = cappedBins.reduce((s, b) => s + Math.min(b.usedSlots, b.capacitySlots as number), 0)

  const congestionByNode: NodeCongestion[] = [...visitsByNode.entries()]
    .map(([graphNodeId, visits]) => ({ graphNodeId, visits }))
    .sort((a, b) => b.visits - a.visits || a.graphNodeId - b.graphNodeId)

  return {
    orderCount,
    totalTravelM: round(totalTravelM),
    avgTravelPerOrderM: orderCount === 0 ? 0 : round(totalTravelM / orderCount),
    utilizationPct: totalCapacity > 0 ? round(totalUsed / totalCapacity, 4) : null,
    binsUsed: bins.filter((b) => b.usedSlots > 0).length,
    binsTotal: bins.length,
    congestionByNode,
    unreachableStops,
  }
}

export interface KpiDiff {
  totalTravelDeltaM: number
  /** Negative = the candidate reduces travel (an improvement). */
  travelDeltaPct: number | null
  avgTravelDeltaM: number
  utilizationDeltaPct: number | null
}

/** Compare a candidate layout's KPIs against a baseline (usually the active layout). */
export function diffKpis(baseline: SimulationKpis, candidate: SimulationKpis): KpiDiff {
  const travelDeltaPct = baseline.totalTravelM > 0
    ? round(((candidate.totalTravelM - baseline.totalTravelM) / baseline.totalTravelM) * 100, 2)
    : null
  const utilizationDeltaPct = baseline.utilizationPct !== null && candidate.utilizationPct !== null
    ? round((candidate.utilizationPct - baseline.utilizationPct) * 100, 2)
    : null
  return {
    totalTravelDeltaM: round(candidate.totalTravelM - baseline.totalTravelM),
    travelDeltaPct,
    avgTravelDeltaM: round(candidate.avgTravelPerOrderM - baseline.avgTravelPerOrderM),
    utilizationDeltaPct,
  }
}
