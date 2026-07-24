import { describe, it, expect } from 'vitest'
import { planPutaway } from '../../supabase/functions/_shared/wie/putawayPlan'
import { DEFAULT_WEIGHTS } from '../../supabase/functions/_shared/wie/types'
import type { CandidateBin, PutawayPlan, PutawayRequest, SkuProfile } from '../../supabase/functions/_shared/wie/types'

function sku(o: Partial<SkuProfile> = {}): SkuProfile {
  return {
    productId: 1, code: 'S1', name: 'S', sizeFactor: 1, weightKg: null, category: null,
    hazardClass: null, tempMin: null, tempMax: null, handlingType: null, stackable: null, velocityClass: null, ...o,
  }
}

function bin(o: Partial<CandidateBin> = {}): CandidateBin {
  return {
    locationId: 1, code: 'B1', zoneId: null, zoneTag: null, capacitySlots: 100, usedSlots: 0,
    weightCapacityKg: null, usedWeightKg: 0, graphNodeId: 1, accessOffsetM: 0, hasSameProduct: false,
    distanceFromDockM: 10, zoneType: null, zonePriorityWeight: null, zoneAllowedCategories: null,
    zoneMaxUtilizationPct: null, occupantCategories: [], pickVisits30d: 0, ...o,
  }
}

function req(candidates: CandidateBin[], s: SkuProfile, quantity: number): PutawayRequest {
  return { layoutId: 1, warehouseId: 1, sku: s, quantity, candidates, rules: [], compatibility: [], weights: DEFAULT_WEIGHTS }
}

const placed = (plan: PutawayPlan) => plan.allocations.filter((a) => a.locationId !== null)
const residual = (plan: PutawayPlan) => plan.allocations.find((a) => a.needsManualPlacement)

describe('planPutaway — single bin', () => {
  it('places the whole line in one bin when it fits', () => {
    const plan = planPutaway(req([bin({ locationId: 5, capacitySlots: 100 })], sku(), 30))
    expect(plan.allocations).toHaveLength(1)
    expect(plan.allocations[0]).toMatchObject({ locationId: 5, quantity: 30, needsManualPlacement: false })
  })

  it('keeps the whole quantity (even fractional) in an uncapped bin', () => {
    const plan = planPutaway(req([bin({ capacitySlots: null })], sku(), 12.5))
    expect(plan.allocations).toHaveLength(1)
    expect(plan.allocations[0].quantity).toBe(12.5)
  })
})

describe('planPutaway — multi-bin split', () => {
  it('splits a line across bins when no single bin can hold it', () => {
    // Two bins with 40 slots free each; 100 units @ sizeFactor 1 needs 3 bins' worth.
    const plan = planPutaway(req([
      bin({ locationId: 1, capacitySlots: 40, distanceFromDockM: 5 }),
      bin({ locationId: 2, capacitySlots: 40, distanceFromDockM: 10 }),
      bin({ locationId: 3, capacitySlots: 40, distanceFromDockM: 15 }),
    ], sku(), 100))
    const p = placed(plan)
    const total = p.reduce((s, a) => s + a.quantity, 0)
    expect(total).toBe(100)
    expect(p.length).toBe(3) // 40 + 40 + 20
    expect(residual(plan)).toBeUndefined()
  })

  it('fills the best-scored (nearest) bin first', () => {
    const plan = planPutaway(req([
      bin({ locationId: 2, capacitySlots: 30, distanceFromDockM: 50 }),
      bin({ locationId: 1, capacitySlots: 30, distanceFromDockM: 1 }),
    ], sku(), 40))
    // Bin 1 (nearest) fills to 30 first, then bin 2 takes the remaining 10.
    expect(plan.allocations[0]).toMatchObject({ locationId: 1, quantity: 30 })
    expect(plan.allocations[1]).toMatchObject({ locationId: 2, quantity: 10 })
  })

  it('accounts for sizeFactor when computing per-bin capacity', () => {
    // sizeFactor 2 → each unit needs 2 slots → a 20-slot bin holds 10 units.
    const plan = planPutaway(req([bin({ capacitySlots: 20 })], sku({ sizeFactor: 2 }), 25))
    expect(placed(plan)[0].quantity).toBe(10)
    expect(residual(plan)?.quantity).toBe(15)
  })
})

describe('planPutaway — weight-limited split', () => {
  it('caps a slot-roomy bin by its weight limit', () => {
    // Slots allow 100, but 50 kg / 10 kg-per-unit = 5 units fit by weight.
    const plan = planPutaway(req([
      bin({ locationId: 1, capacitySlots: 100, weightCapacityKg: 50 }),
      bin({ locationId: 2, capacitySlots: 100, weightCapacityKg: null, distanceFromDockM: 20 }),
    ], sku({ weightKg: 10 }), 8))
    const first = plan.allocations.find((a) => a.locationId === 1)
    const second = plan.allocations.find((a) => a.locationId === 2)
    expect(first?.quantity).toBe(5)
    expect(second?.quantity).toBe(3)
  })
})

describe('planPutaway — residual', () => {
  it('leaves an unplaced residual when capacity runs out', () => {
    const plan = planPutaway(req([bin({ capacitySlots: 10 })], sku(), 25))
    expect(placed(plan).reduce((s, a) => s + a.quantity, 0)).toBe(10)
    const r = residual(plan)
    expect(r).toMatchObject({ locationId: null, quantity: 15, needsManualPlacement: true })
  })

  it('is entirely residual when every bin is ineligible', () => {
    // Unreachable bin is filtered out → nothing to place.
    const plan = planPutaway(req([bin({ distanceFromDockM: null })], sku(), 5))
    expect(placed(plan)).toHaveLength(0)
    expect(residual(plan)).toMatchObject({ quantity: 5, needsManualPlacement: true })
  })
})

describe('planPutaway — eligibility gates still apply', () => {
  it('rejects a bin whose zone forbids the category', () => {
    const plan = planPutaway(req(
      [bin({ zoneAllowedCategories: ['Frozen'], distanceFromDockM: 5 })],
      sku({ category: 'Dry' }), 5,
    ))
    expect(placed(plan)).toHaveLength(0)
    expect(residual(plan)?.quantity).toBe(5)
  })
})

// ── Unit loads (mig 00078) ───────────────────────────────────────────────────
// A pallet arriving into a pallet-denominated bin is ONE physical object: it
// costs a whole position whatever is on it, and it can never be split.

function palletReq(candidates: CandidateBin[], s: SkuProfile, quantity: number): PutawayRequest {
  return { ...req(candidates, s, quantity), huType: 'pallet' }
}

const palletBin = (o: Partial<CandidateBin> = {}) => bin({ slotKind: 'pallet', capacitySlots: 10, ...o })

describe('planPutaway — unit loads', () => {
  it('costs one position however many units are on the pallet', () => {
    // The WIE-DEMO bug: 130 units used to read as 130 slots against 10.
    const bins = [palletBin({ locationId: 1 })]
    const plan = planPutaway(palletReq(bins, sku(), 130))
    expect(placed(plan)).toHaveLength(1)
    expect(placed(plan)[0]).toMatchObject({ locationId: 1, quantity: 130 })
    expect(residual(plan)).toBeUndefined()
    expect(bins[0].usedSlots).toBe(1)
  })

  it('never splits a pallet across bins', () => {
    const plan = planPutaway(palletReq([
      palletBin({ locationId: 1, capacitySlots: 10, usedSlots: 9.5 }),
      palletBin({ locationId: 2, distanceFromDockM: 40 }),
    ], sku(), 200))
    // Bin 1 has under a full free position → skipped entirely, not part-filled.
    expect(placed(plan)).toHaveLength(1)
    expect(placed(plan)[0]).toMatchObject({ locationId: 2, quantity: 200 })
  })

  it('goes wholly to manual placement when no bin has a free position', () => {
    const plan = planPutaway(palletReq([
      palletBin({ locationId: 1, capacitySlots: 10, usedSlots: 10 }),
      palletBin({ locationId: 2, capacitySlots: 10, usedSlots: 10, distanceFromDockM: 40 }),
    ], sku(), 200))
    expect(placed(plan)).toHaveLength(0)
    expect(residual(plan)).toMatchObject({ quantity: 200, needsManualPlacement: true })
  })

  it('still honours the bin weight limit', () => {
    const plan = planPutaway(palletReq([
      palletBin({ locationId: 1, weightCapacityKg: 50 }),
      palletBin({ locationId: 2, weightCapacityKg: 5000, distanceFromDockM: 40 }),
    ], sku({ weightKg: 10 }), 200))
    expect(placed(plan)[0]).toMatchObject({ locationId: 2, quantity: 200 })
  })

  it('keeps per-unit maths for a pallet landing in a carton bin', () => {
    // A pallet decanted onto a carton shelf is counted in cartons, so the
    // split behaviour is exactly as before.
    const plan = planPutaway(palletReq([bin({ slotKind: 'carton', capacitySlots: 10 })], sku(), 25))
    expect(placed(plan).reduce((s, a) => s + a.quantity, 0)).toBe(10)
    expect(residual(plan)?.quantity).toBe(15)
  })

  it('keeps per-unit maths for loose stock in a pallet bin', () => {
    const plan = planPutaway(req([palletBin({ capacitySlots: 10 })], sku(), 25))
    expect(placed(plan).reduce((s, a) => s + a.quantity, 0)).toBe(10)
    expect(residual(plan)?.quantity).toBe(15)
  })
})
