import { describe, it, expect } from 'vitest'
import { filterCandidates, scoreCandidates } from '../../supabase/functions/_shared/wie/scoring'
import { recommendPutaway } from '../../supabase/functions/_shared/wie/putaway'
import { DEFAULT_WEIGHTS } from '../../supabase/functions/_shared/wie/types'
import type { CandidateBin, PutawayRequest, RuleDefinition, SkuProfile } from '../../supabase/functions/_shared/wie/types'

const SKU: SkuProfile = {
  productId: 1,
  code: 'SKU-1',
  name: 'Widget',
  sizeFactor: 1,
  category: null,
  hazardClass: null,
  tempMin: null,
  tempMax: null,
  handlingType: null,
  stackable: null,
  velocityClass: null,
}

function bin(id: number, overrides: Partial<CandidateBin> = {}): CandidateBin {
  return {
    locationId: id,
    code: `BIN-${id}`,
    zoneId: 1,
    zoneTag: null,
    capacitySlots: 100,
    usedSlots: 0,
    graphNodeId: id,
    accessOffsetM: 0,
    hasSameProduct: false,
    distanceFromDockM: 10,
    zoneType: null,
    zonePriorityWeight: null,
    zoneAllowedCategories: null,
    zoneMaxUtilizationPct: null,
    occupantCategories: [],
    pickVisits30d: 0,
    ...overrides,
  }
}

function request(candidates: CandidateBin[], rules: RuleDefinition[] = [], quantity = 5): PutawayRequest {
  return { layoutId: 1, warehouseId: 1, sku: SKU, quantity, candidates, rules, compatibility: [], weights: DEFAULT_WEIGHTS }
}

describe('filterCandidates', () => {
  it('rejects bins without room for the putaway', () => {
    const req = request([bin(1, { capacitySlots: 10, usedSlots: 8 })], [], 5)
    const res = filterCandidates(req)
    expect(res.valid).toHaveLength(0)
    expect(res.hardFilters[0].code).toBe('capacity')
    expect(res.hardFilters[0].sample[0].locationId).toBe(1)
  })

  it('rejects unreachable bins', () => {
    const res = filterCandidates(request([bin(1, { distanceFromDockM: null })]))
    expect(res.hardFilters[0].code).toBe('unreachable')
  })

  it('rejects bins vetoed by a hard rule and records the rule id', () => {
    const rule: RuleDefinition = {
      id: 7,
      name: 'Frozen → Cold',
      enforcement: 'hard',
      priority: 100,
      conditions: [{ subject: 'product', attr: 'category', op: 'eq', value: 'frozen' }],
      action: { effect: 'require', target: { scope: 'zone', attr: 'zoneTag', op: 'eq', value: 'cold' } },
    }
    const req: PutawayRequest = { ...request([bin(1, { zoneTag: 'ambient' })], [rule]), sku: { ...SKU, category: 'frozen' } }
    const res = filterCandidates(req)
    expect(res.valid).toHaveLength(0)
    expect(res.hardFilters[0].ruleId).toBe(7)
  })

  it('keeps valid bins and threads their soft triggers', () => {
    const soft: RuleDefinition = {
      id: 3,
      name: 'Group',
      enforcement: 'soft',
      priority: 50,
      conditions: [{ subject: 'bin', attr: 'hasSameProduct', op: 'eq', value: true }],
      action: { effect: 'boost', delta: 0.2 },
    }
    const res = filterCandidates(request([bin(1, { hasSameProduct: true })], [soft]))
    expect(res.valid).toHaveLength(1)
    expect(res.softByLocation.get(1)?.[0].delta).toBe(0.2)
  })
})

describe('scoreCandidates', () => {
  it('ranks the nearer bin first', () => {
    const req = request([bin(1, { distanceFromDockM: 50 }), bin(2, { distanceFromDockM: 5 })])
    const ranked = scoreCandidates(req, filterCandidates(req))
    expect(ranked[0].locationId).toBe(2)
  })

  it('normalizes a single candidate to a full travel score', () => {
    const req = request([bin(1, { distanceFromDockM: 42 })])
    const ranked = scoreCandidates(req, filterCandidates(req))
    const travel = ranked[0].factors.find((f) => f.factor === 'travel_distance')
    expect(travel?.normalized).toBe(1)
  })

  it('is deterministic across runs', () => {
    const build = () => {
      const req = request([bin(1, { distanceFromDockM: 20 }), bin(2, { distanceFromDockM: 20, hasSameProduct: true })])
      return scoreCandidates(req, filterCandidates(req)).map((c) => c.locationId)
    }
    expect(build()).toEqual(build())
  })

  it('prefers a bin already holding the product on a distance tie', () => {
    const req = request([bin(1, { distanceFromDockM: 20 }), bin(2, { distanceFromDockM: 20, hasSameProduct: true })])
    const ranked = scoreCandidates(req, filterCandidates(req))
    expect(ranked[0].locationId).toBe(2)
  })
})

describe('zone semantics', () => {
  it('rejects a bin whose zone does not allow the product category', () => {
    const req: PutawayRequest = {
      ...request([bin(1, { zoneType: 'cold', zoneAllowedCategories: ['Fish'] })]),
      sku: { ...SKU, category: 'Noodles' },
    }
    const res = filterCandidates(req)
    expect(res.valid).toHaveLength(0)
    expect(res.hardFilters[0].code).toBe('zone_category')
  })

  it('keeps a bin whose zone allows the category', () => {
    const req: PutawayRequest = {
      ...request([bin(1, { zoneType: 'cold', zoneAllowedCategories: ['Fish'] })]),
      sku: { ...SKU, category: 'Fish' },
    }
    expect(filterCandidates(req).valid).toHaveLength(1)
  })

  it('prefers the higher-priority zone when travel and capacity tie', () => {
    const req = request([
      bin(1, { zoneType: 'quarantine', zonePriorityWeight: 0.1 }),
      bin(2, { zoneType: 'fast_moving', zonePriorityWeight: 1.0 }),
    ])
    const ranked = scoreCandidates(req, filterCandidates(req))
    expect(ranked[0].locationId).toBe(2)
  })
})

describe('category compatibility', () => {
  const forbid = { categoryA: 'Chemicals', categoryB: 'Food', level: 'forbidden' as const }
  const restrict = { categoryA: 'Food', categoryB: 'Produce', level: 'restricted' as const }

  it('rejects a bin whose occupants are forbidden with the SKU category', () => {
    const req: PutawayRequest = {
      ...request([bin(1, { occupantCategories: ['Chemicals'] })]),
      sku: { ...SKU, category: 'Food' },
      compatibility: [forbid],
    }
    const res = filterCandidates(req)
    expect(res.valid).toHaveLength(0)
    expect(res.hardFilters[0].code).toBe('compatibility')
  })

  it('penalizes but keeps a bin with a restricted occupant', () => {
    const req: PutawayRequest = {
      ...request([bin(1, { occupantCategories: ['Produce'] })]),
      sku: { ...SKU, category: 'Food' },
      compatibility: [restrict],
    }
    const res = filterCandidates(req)
    expect(res.valid).toHaveLength(1)
    expect(res.softByLocation.get(1)?.some((t) => t.effect === 'penalty')).toBe(true)
  })

  it('is symmetric regardless of category order in the matrix', () => {
    const req: PutawayRequest = {
      ...request([bin(1, { occupantCategories: ['Food'] })]),
      sku: { ...SKU, category: 'Chemicals' },
      compatibility: [forbid], // stored as (Chemicals, Food)
    }
    expect(filterCandidates(req).valid).toHaveLength(0)
  })

  it('does not gate an empty bin or an empty matrix', () => {
    const req: PutawayRequest = { ...request([bin(1)]), sku: { ...SKU, category: 'Food' }, compatibility: [] }
    expect(filterCandidates(req).valid).toHaveLength(1)
  })
})

describe('velocity + congestion factors', () => {
  it('sends an A-mover to the bin nearest the dock', () => {
    const req: PutawayRequest = {
      ...request([bin(1, { distanceFromDockM: 60 }), bin(2, { distanceFromDockM: 5 })]),
      sku: { ...SKU, velocityClass: 'A' },
    }
    const ranked = scoreCandidates(req, filterCandidates(req))
    expect(ranked[0].locationId).toBe(2)
  })

  it('pushes a C-mover toward the far bin (velocity outweighs the smaller factors)', () => {
    const req: PutawayRequest = {
      ...request([bin(1, { distanceFromDockM: 5 }), bin(2, { distanceFromDockM: 60 })]),
      sku: { ...SKU, velocityClass: 'C' },
      weights: { travelDistance: 0, capacityFit: 0, grouping: 0, zonePreference: 0, congestion: 0, velocityMatch: 1 },
    }
    const ranked = scoreCandidates(req, filterCandidates(req))
    expect(ranked[0].locationId).toBe(2)
  })

  it('prefers the less-congested bin on a distance tie', () => {
    const req = request([bin(1, { pickVisits30d: 40 }), bin(2, { pickVisits30d: 2 })])
    const ranked = scoreCandidates(req, filterCandidates(req))
    expect(ranked[0].locationId).toBe(2)
  })
})

describe('recommendPutaway', () => {
  it('returns a winner, alternatives, and a well-formed explanation', () => {
    const req = request([
      bin(1, { distanceFromDockM: 50 }),
      bin(2, { distanceFromDockM: 5, hasSameProduct: true }),
      bin(3, { distanceFromDockM: 30 }),
    ])
    const rec = recommendPutaway(req)
    expect(rec.recommendedLocationId).toBe(2)
    expect(rec.explanation.engineVersion).toMatch(/^wie-/)
    expect(rec.explanation.candidatesConsidered).toBe(3)
    expect(rec.explanation.winner?.locationId).toBe(2)
    expect(rec.explanation.winner?.factors.map((f) => f.factor)).toEqual([
      'travel_distance',
      'capacity_fit',
      'grouping',
      'zone_preference',
      'congestion',
      'velocity_match',
    ])
    expect(rec.alternatives.length).toBe(2)
  })

  it('recommends nothing and surfaces reasons when all bins are filtered out', () => {
    const rec = recommendPutaway(request([bin(1, { distanceFromDockM: null })]))
    expect(rec.recommendedLocationId).toBeNull()
    expect(rec.explanation.winner).toBeNull()
    expect(rec.explanation.hardFilters[0].code).toBe('unreachable')
  })
})
