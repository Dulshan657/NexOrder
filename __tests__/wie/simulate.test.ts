import { describe, it, expect } from 'vitest'
import { buildWalkGraph } from '../../supabase/functions/_shared/wie/graph'
import { simulateLayout, diffKpis, type SimBin, type SimOrder } from '../../supabase/functions/_shared/wie/simulate'
import type { WalkCell } from '../../supabase/functions/_shared/wie/types'

const CORRIDOR: WalkCell[] = Array.from({ length: 6 }, (_, x) => ({ x, y: 0, floor: 0, isDock: x === 0 }))
const graph = buildWalkGraph(CORRIDOR, 1)
const DOCK = 0

function bin(node: number, cap: number | null, used: number): SimBin {
  return { locationId: node * 10, graphNodeId: node, capacitySlots: cap, usedSlots: used }
}

describe('simulateLayout', () => {
  const orders: SimOrder[] = [
    { orderId: 'A', stops: [{ locationId: 10, graphNodeId: 1, accessOffsetM: 0 }, { locationId: 30, graphNodeId: 3, accessOffsetM: 0 }] },
    { orderId: 'B', stops: [{ locationId: 50, graphNodeId: 5, accessOffsetM: 0 }] },
  ]
  const bins: SimBin[] = [bin(1, 10, 5), bin(3, 10, 5), bin(5, 10, 0)]

  it('rolls up total and average pick travel', () => {
    const kpis = simulateLayout(graph, DOCK, orders, bins)
    // A: dock→1→3 = 3; B: dock→5 = 5 → total 8, avg 4
    expect(kpis.totalTravelM).toBeCloseTo(8, 5)
    expect(kpis.avgTravelPerOrderM).toBeCloseTo(4, 5)
    expect(kpis.orderCount).toBe(2)
  })

  it('computes utilization from capacitied bins', () => {
    const kpis = simulateLayout(graph, DOCK, orders, bins)
    // used 5+5+0 = 10 of capacity 30
    expect(kpis.utilizationPct).toBeCloseTo(10 / 30, 4)
    expect(kpis.binsUsed).toBe(2)
    expect(kpis.binsTotal).toBe(3)
  })

  it('reports null utilization when no bin has capacity set', () => {
    const kpis = simulateLayout(graph, DOCK, orders, [bin(1, null, 5)])
    expect(kpis.utilizationPct).toBeNull()
  })

  it('builds a per-node congestion ranking', () => {
    const busy: SimOrder[] = [
      { orderId: 'A', stops: [{ locationId: 10, graphNodeId: 1, accessOffsetM: 0 }] },
      { orderId: 'B', stops: [{ locationId: 10, graphNodeId: 1, accessOffsetM: 0 }] },
      { orderId: 'C', stops: [{ locationId: 30, graphNodeId: 3, accessOffsetM: 0 }] },
    ]
    const kpis = simulateLayout(graph, DOCK, busy, bins)
    expect(kpis.congestionByNode[0]).toEqual({ graphNodeId: 1, visits: 2 })
  })

  it('counts unreachable stops (bins not placed in this layout)', () => {
    const orders2: SimOrder[] = [{ orderId: 'A', stops: [{ locationId: 99, graphNodeId: null, accessOffsetM: 0 }] }]
    const kpis = simulateLayout(graph, DOCK, orders2, bins)
    expect(kpis.unreachableStops).toBe(1)
    expect(kpis.totalTravelM).toBe(0)
  })

  it('handles no orders without dividing by zero', () => {
    const kpis = simulateLayout(graph, DOCK, [], bins)
    expect(kpis.avgTravelPerOrderM).toBe(0)
  })
})

describe('diffKpis', () => {
  it('reports a travel reduction as a negative percentage', () => {
    const baseline = simulateLayout(graph, DOCK, [{ orderId: 'A', stops: [{ locationId: 50, graphNodeId: 5, accessOffsetM: 0 }] }], [bin(5, 10, 5)])
    const candidate = simulateLayout(graph, DOCK, [{ orderId: 'A', stops: [{ locationId: 10, graphNodeId: 1, accessOffsetM: 0 }] }], [bin(1, 10, 5)])
    const d = diffKpis(baseline, candidate)
    // baseline travel 5, candidate 1 → -80%
    expect(d.totalTravelDeltaM).toBeCloseTo(-4, 5)
    expect(d.travelDeltaPct).toBeCloseTo(-80, 2)
  })
})
