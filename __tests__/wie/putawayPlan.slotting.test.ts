import { describe, it, expect } from 'vitest'
import { planPutaway } from '../../supabase/functions/_shared/wie/putawayPlan'
import { DEFAULT_WEIGHTS } from '../../supabase/functions/_shared/wie/types'
import type {
  CandidateBin, PutawayPlan, PutawayRequest, SkuProfile, SlottingContext,
} from '../../supabase/functions/_shared/wie/types'
import type { SlottingRuleSpec } from '../../supabase/functions/_shared/wie/slotting'

// Slotting through the REAL planner. slotting.test.ts proves the decision;
// this proves the integration — that a tier ordering actually steers the greedy
// fill, and that the fill's own capacity handling supplies the overflow.

function sku(o: Partial<SkuProfile> = {}): SkuProfile {
  return {
    productId: 1, code: 'S1', name: 'S', sizeFactor: 1, weightKg: null, category: 'Drills',
    hazardClass: null, tempMin: null, tempMax: null, handlingType: null, stackable: null,
    velocityClass: null, brand: 'Milwaukee', supplierIds: [10], ...o,
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

function rule(o: Partial<SlottingRuleSpec> = {}): SlottingRuleSpec {
  return {
    id: 1, name: 'Milwaukee', specificity: 4,
    matchProductId: null, matchBrand: 'Milwaukee', matchCategory: null, matchSupplierId: null,
    enforcement: 'soft', reserveEmpty: false, blockIds: [1, 2], ...o,
  }
}

function slotting(o: Partial<SlottingContext> = {}): SlottingContext {
  return {
    product: { productId: 1, brand: 'Milwaukee', category: 'Drills', supplierIds: [10] },
    rules: [rule()],
    blockNames: new Map([[1, 'Aisle C'], [2, 'Mezzanine']]),
    blockIdsByLocation: new Map(),
    ...o,
  }
}

function req(
  candidates: CandidateBin[], quantity: number, slot?: SlottingContext, s: SkuProfile = sku(),
): PutawayRequest {
  return {
    layoutId: 1, warehouseId: 1, sku: s, quantity, candidates,
    rules: [], compatibility: [], weights: DEFAULT_WEIGHTS, slotting: slot,
  }
}

const placed = (p: PutawayPlan) => p.allocations.filter((a) => a.locationId !== null)
const residual = (p: PutawayPlan) => p.allocations.find((a) => a.needsManualPlacement)

// The bin FAR from the dock is the assigned one, so any test that finds stock
// there has proved slotting beat the travel-distance score rather than
// coinciding with it.
//
// FACTORIES, NOT CONSTANTS. planPutaway mutates bin.usedSlots as it fills (its
// own comment says so -- that is how a later portion of the same plan sees the
// bin as fuller). Shared constants would carry one test's fill into the next.
const NEAR  = (o: Partial<CandidateBin> = {}) => bin({ locationId: 100, code: 'NEAR',  distanceFromDockM: 1,  capacitySlots: 1000, ...o })
const HOME1 = (o: Partial<CandidateBin> = {}) => bin({ locationId: 200, code: 'HOME1', distanceFromDockM: 90, capacitySlots: 1000, ...o })
const HOME2 = (o: Partial<CandidateBin> = {}) => bin({ locationId: 300, code: 'HOME2', distanceFromDockM: 95, capacitySlots: 1000, ...o })

describe('slotting steers the fill', () => {
  it('sends stock to the assigned block over the nearer unassigned bin', () => {
    const plan = planPutaway(req([NEAR(), HOME1()], 50, slotting({
      blockIdsByLocation: new Map([[200, [1]]]),
    })))
    expect(placed(plan)).toHaveLength(1)
    expect(plan.allocations[0]).toMatchObject({ locationId: 200, quantity: 50, offHome: false })
    expect(plan.allocations[0].slotting).toMatchObject({ ruleName: 'Milwaukee', rank: 1, blockName: 'Aisle C' })
  })

  it('is completely inert when no rule matches the product', () => {
    const withRules = planPutaway(req([NEAR(), HOME1()], 50, slotting({
      product: { productId: 9, brand: 'DeWalt', category: 'Saws', supplierIds: [99] },
      blockIdsByLocation: new Map([[200, [1]]]),
    })))
    const without = planPutaway(req([NEAR(), HOME1()], 50))
    // Same bin, same quantity, and no slotting provenance attached at all.
    expect(withRules.allocations[0].locationId).toBe(without.allocations[0].locationId)
    expect(withRules.allocations[0].locationId).toBe(100)
    expect(withRules.allocations[0].offHome).toBeUndefined()
    expect(withRules.allocations[0].slotting).toBeUndefined()
  })
})

describe('ranked overflow', () => {
  it('fills block 1, spills into block 2, then goes anywhere — flagged', () => {
    // 250 units; block-1 bin holds 100, block-2 bin holds 100, then the
    // unassigned NEAR bin takes the last 50.
    const plan = planPutaway(req([
      NEAR(),
      HOME1({ capacitySlots: 100 }),
      HOME2({ capacitySlots: 100 }),
    ], 250, slotting({
      blockIdsByLocation: new Map([[200, [1]], [300, [2]]]),
    })))

    const p = placed(plan)
    expect(p.map((a) => a.locationId)).toEqual([200, 300, 100])
    expect(p.map((a) => a.quantity)).toEqual([100, 100, 50])
    expect(residual(plan)).toBeUndefined()

    // Only the last one is off-home, and it says so.
    expect(p.map((a) => a.offHome)).toEqual([false, false, true])
    expect(p[2].slotting?.text).toContain('Off-home')
    expect(p[2].slotting?.text).toContain('Aisle C or Mezzanine')
  })

  it('reports the overflow rank on a block-2 placement', () => {
    const plan = planPutaway(req([
      HOME1({ capacitySlots: 10 }),
      HOME2({ capacitySlots: 100 }),
    ], 50, slotting({
      blockIdsByLocation: new Map([[200, [1]], [300, [2]]]),
    })))
    const p = placed(plan)
    expect(p[1]).toMatchObject({ locationId: 300, offHome: false })
    expect(p[1].slotting).toMatchObject({ rank: 2, blockName: 'Mezzanine' })
  })
})

describe('hard enforcement through the planner', () => {
  const HARD = rule({ enforcement: 'hard', blockIds: [1] })

  it('refuses the unassigned bin entirely', () => {
    const plan = planPutaway(req([NEAR(), HOME1()], 50, slotting({
      rules: [HARD],
      blockIdsByLocation: new Map([[200, [1]]]),
    })))
    expect(placed(plan).map((a) => a.locationId)).toEqual([200])
  })

  it('never wedges: a full home block yields a residual, not an empty plan', () => {
    // The home bin holds 10 of the 50 units and NEAR is refused, so 40 must
    // come back as manual placement rather than silently vanishing.
    const plan = planPutaway(req([NEAR(), HOME1({ capacitySlots: 10 })], 50, slotting({
      rules: [HARD],
      blockIdsByLocation: new Map([[200, [1]]]),
    })))
    expect(placed(plan)).toHaveLength(1)
    expect(residual(plan)).toMatchObject({ locationId: null, quantity: 40, needsManualPlacement: true })
    const total = plan.allocations.reduce((s, a) => s + a.quantity, 0)
    expect(total).toBe(50)
  })

  it('names the rule in the explanation so the queue can say why', () => {
    const plan = planPutaway(req([NEAR(), HOME1()], 50, slotting({
      rules: [HARD],
      blockIdsByLocation: new Map([[200, [1]]]),
    })))
    const codes = plan.allocations[0].explanation.hardFilters.map((h) => h.code)
    expect(codes).toContain('slotting_hard')
    const f = plan.allocations[0].explanation.hardFilters.find((h) => h.code === 'slotting_hard')
    expect(f?.label).toBe('Milwaukee')
    expect(f?.sample[0]?.code).toBe('NEAR')
  })
})

describe('reservation through the planner', () => {
  it('keeps a foreign product out of a reserved block', () => {
    const plan = planPutaway(req([NEAR(), HOME1()], 50, slotting({
      product: { productId: 9, brand: 'DeWalt', category: 'Saws', supplierIds: [99] },
      rules: [rule({ reserveEmpty: true, blockIds: [1] })],
      blockIdsByLocation: new Map([[200, [1]]]),
    })))
    expect(placed(plan).map((a) => a.locationId)).toEqual([100])
    const codes = plan.allocations[0].explanation.hardFilters.map((h) => h.code)
    expect(codes).toContain('slotting_reserved')
  })
})

describe('quarantine', () => {
  it('places a held line normally under a hard rule, with no off-home flag', () => {
    // p_hold_only is a switch, so a quarantined receipt sees ONLY hold bins —
    // none of which is in any block. Without the exemption this would be
    // refused outright at the very bin the engine recommended.
    const HOLD = bin({ locationId: 900, code: 'HOLD-1', distanceFromDockM: 20, isHold: true })
    const plan = planPutaway(req([HOLD], 50, slotting({
      rules: [rule({ enforcement: 'hard', blockIds: [1] })],
      blockIdsByLocation: new Map(),
      heldLocationIds: new Set([900]),
    })))
    expect(placed(plan)).toHaveLength(1)
    expect(plan.allocations[0]).toMatchObject({ locationId: 900, quantity: 50, offHome: false })
    expect(residual(plan)).toBeUndefined()
  })
})
