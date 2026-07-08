import { describe, it, expect } from 'vitest'
import { planReslot, type ReslotDemand } from '../../supabase/functions/_shared/wie/reslot'
import { DEFAULT_WEIGHTS } from '../../supabase/functions/_shared/wie/types'
import type { CandidateBin, SkuProfile } from '../../supabase/functions/_shared/wie/types'

function bin(locationId: number, code: string, opts: { capacity?: number | null; used?: number; dist?: number } = {}): CandidateBin {
  return {
    locationId, code,
    zoneId: null, zoneTag: null,
    capacitySlots: opts.capacity === undefined ? null : opts.capacity,
    usedSlots: opts.used ?? 0,
    graphNodeId: 1,
    accessOffsetM: 0,
    hasSameProduct: false,
    distanceFromDockM: opts.dist ?? 10,
    zoneType: null, zonePriorityWeight: null, zoneAllowedCategories: null, zoneMaxUtilizationPct: null,
    occupantCategories: [], pickVisits30d: 0,
  }
}

function sku(productId: number, opts: { sizeFactor?: number; velocity?: 'A' | 'B' | 'C' } = {}): SkuProfile {
  return {
    productId, code: `P${productId}`, name: `Product ${productId}`,
    sizeFactor: opts.sizeFactor ?? 1, category: null,
    hazardClass: null, tempMin: null, tempMax: null, handlingType: null, stackable: null,
    velocityClass: opts.velocity ?? null,
  }
}

const W = DEFAULT_WEIGHTS

describe('planReslot', () => {
  it('places a SKU from an old bin into the best new bin', () => {
    const demands: ReslotDemand[] = [{ sku: sku(1), sources: [{ locationId: 99, qty: 10 }] }]
    const plan = planReslot({ demands, candidates: [bin(10, 'N1', { capacity: 100, dist: 5 })], rules: [], compatibility: [], weights: W })
    expect(plan.moves).toHaveLength(1)
    expect(plan.moves[0]).toMatchObject({ productId: 1, fromLocationId: 99, toLocationId: 10, qty: 10 })
    expect(plan.overflow).toHaveLength(0)
    expect(plan.requiredSlots).toBe(10)
    expect(plan.providedFreeSlots).toBe(100)
  })

  it('splits a SKU across bins when the best one is too small', () => {
    const demands: ReslotDemand[] = [{ sku: sku(1), sources: [{ locationId: 99, qty: 10 }] }]
    const plan = planReslot({
      demands,
      candidates: [bin(10, 'N1', { capacity: 6, dist: 5 }), bin(11, 'N2', { capacity: 100, dist: 8 })],
      rules: [], compatibility: [], weights: W,
    })
    const byBin = Object.fromEntries(plan.moves.map((m) => [m.toLocationId, m.qty]))
    expect(byBin[10]).toBe(6) // nearer bin filled first
    expect(byBin[11]).toBe(4) // remainder spills to next-best
    expect(plan.moves.reduce((s, m) => s + m.qty, 0)).toBe(10)
    expect(plan.overflow).toHaveLength(0)
  })

  it('consumes capacity across SKUs so a filled bin is gone for the next', () => {
    const demands: ReslotDemand[] = [
      { sku: sku(1), sources: [{ locationId: 98, qty: 5 }] },
      { sku: sku(2), sources: [{ locationId: 99, qty: 5 }] },
    ]
    const plan = planReslot({
      demands,
      candidates: [bin(10, 'N1', { capacity: 5, dist: 5 }), bin(11, 'N2', { capacity: 100, dist: 9 })],
      rules: [], compatibility: [], weights: W,
    })
    const p1 = plan.moves.find((m) => m.productId === 1)
    const p2 = plan.moves.find((m) => m.productId === 2)
    expect(p1?.toLocationId).toBe(10) // first SKU fills the nearer bin
    expect(p2?.toLocationId).toBe(11) // second SKU pushed to the next bin
  })

  it('reports overflow when total capacity is insufficient', () => {
    const demands: ReslotDemand[] = [{ sku: sku(1), sources: [{ locationId: 99, qty: 10 }] }]
    const plan = planReslot({ demands, candidates: [bin(10, 'N1', { capacity: 3, dist: 5 })], rules: [], compatibility: [], weights: W })
    expect(plan.moves.reduce((s, m) => s + m.qty, 0)).toBe(3)
    expect(plan.overflow).toEqual([{ productId: 1, productCode: 'P1', productName: 'Product 1', qty: 7 }])
  })

  it('orders A-movers ahead of C-movers so fast movers claim the near bin', () => {
    const demands: ReslotDemand[] = [
      { sku: sku(2, { velocity: 'C' }), sources: [{ locationId: 98, qty: 5 }] },
      { sku: sku(1, { velocity: 'A' }), sources: [{ locationId: 99, qty: 5 }] },
    ]
    const plan = planReslot({
      demands,
      candidates: [bin(10, 'NEAR', { capacity: 5, dist: 2 }), bin(11, 'FAR', { capacity: 5, dist: 50 })],
      rules: [], compatibility: [], weights: W,
    })
    expect(plan.moves.find((m) => m.productId === 1)?.toLocationId).toBe(10) // A-mover → near
    expect(plan.moves.find((m) => m.productId === 2)?.toLocationId).toBe(11) // C-mover → far
  })

  it('places everything into an uncapped bin', () => {
    const demands: ReslotDemand[] = [{ sku: sku(1), sources: [{ locationId: 99, qty: 1000 }] }]
    const plan = planReslot({ demands, candidates: [bin(10, 'N1', { capacity: null, dist: 5 })], rules: [], compatibility: [], weights: W })
    expect(plan.moves.reduce((s, m) => s + m.qty, 0)).toBe(1000)
    expect(plan.overflow).toHaveLength(0)
    expect(plan.hasUncapped).toBe(true)
  })

  it('accounts for pack size in slot demand (sizeFactor)', () => {
    const demands: ReslotDemand[] = [{ sku: sku(1, { sizeFactor: 2 }), sources: [{ locationId: 99, qty: 10 }] }]
    // 10 units × 2 slots = 20 slots needed; a 10-slot bin holds only 5 units.
    const plan = planReslot({
      demands,
      candidates: [bin(10, 'N1', { capacity: 10, dist: 5 }), bin(11, 'N2', { capacity: 100, dist: 8 })],
      rules: [], compatibility: [], weights: W,
    })
    expect(plan.requiredSlots).toBe(20)
    const byBin = Object.fromEntries(plan.moves.map((m) => [m.toLocationId, m.qty]))
    expect(byBin[10]).toBe(5) // 5 units × 2 = 10 slots fills N1
    expect(byBin[11]).toBe(5)
  })
})
