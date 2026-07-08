import { describe, it, expect } from 'vitest'
import { conditionsMatch, evaluateRules, type RuleContext } from '../../supabase/functions/_shared/wie/rules'
import type { CandidateBin, RuleDefinition, SkuProfile } from '../../supabase/functions/_shared/wie/types'

function sku(overrides: Partial<SkuProfile> = {}): SkuProfile {
  return {
    productId: 1,
    code: 'SKU-1',
    name: 'Widget',
    sizeFactor: 1,
    weightKg: null,
    category: null,
    hazardClass: null,
    tempMin: null,
    tempMax: null,
    handlingType: null,
    stackable: null,
    velocityClass: null,
    ...overrides,
  }
}

function bin(overrides: Partial<CandidateBin> = {}): CandidateBin {
  return {
    locationId: 10,
    code: 'A-01',
    zoneId: 5,
    zoneTag: null,
    capacitySlots: 100,
    usedSlots: 0,
    weightCapacityKg: null,
    usedWeightKg: 0,
    graphNodeId: 1,
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

// Seed template 1: frozen products must go in a cold zone.
const FROZEN_TO_COLD: RuleDefinition = {
  id: 1,
  name: 'Frozen → Cold zone',
  enforcement: 'hard',
  priority: 100,
  conditions: [{ subject: 'product', attr: 'category', op: 'eq', value: 'frozen' }],
  action: { effect: 'require', target: { scope: 'zone', attr: 'zoneTag', op: 'eq', value: 'cold' } },
}

// Seed template 2: any hazardous SKU must go in a hazardous zone.
const HAZARD_TO_HAZZONE: RuleDefinition = {
  id: 2,
  name: 'Hazardous → Hazardous zone',
  enforcement: 'hard',
  priority: 90,
  conditions: [{ subject: 'product', attr: 'hazardClass', op: 'exists' }],
  action: { effect: 'require', target: { scope: 'zone', attr: 'zoneTag', op: 'eq', value: 'hazardous' } },
}

// Seed template 3 (soft): prefer a bin already holding this product.
const PREFER_GROUPING: RuleDefinition = {
  id: 3,
  name: 'Consolidate same product',
  enforcement: 'soft',
  priority: 50,
  conditions: [{ subject: 'bin', attr: 'hasSameProduct', op: 'eq', value: true }],
  action: { effect: 'boost', delta: 0.15 },
}

describe('conditionsMatch', () => {
  it('matches when the product attribute equals the value', () => {
    const ctx: RuleContext = { sku: sku({ category: 'frozen' }), bin: bin() }
    expect(conditionsMatch(FROZEN_TO_COLD.conditions, ctx)).toBe(true)
  })

  it('AND logic requires every condition; OR logic requires any', () => {
    const conds = [
      { subject: 'product' as const, attr: 'category', op: 'eq' as const, value: 'frozen' },
      { subject: 'product' as const, attr: 'hazardClass', op: 'exists' as const },
    ]
    const ctx: RuleContext = { sku: sku({ category: 'frozen', hazardClass: null }), bin: bin() }
    expect(conditionsMatch(conds, ctx, 'and')).toBe(false) // hazardClass missing
    expect(conditionsMatch(conds, ctx, 'or')).toBe(true) // category matches
  })

  it('treats an empty condition set as an unconditional match', () => {
    expect(conditionsMatch([], { sku: sku(), bin: bin() })).toBe(true)
  })

  it('does not match a different category', () => {
    const ctx: RuleContext = { sku: sku({ category: 'dry' }), bin: bin() }
    expect(conditionsMatch(FROZEN_TO_COLD.conditions, ctx)).toBe(false)
  })

  it('supports the exists operator on nullable attributes', () => {
    expect(conditionsMatch(HAZARD_TO_HAZZONE.conditions, { sku: sku({ hazardClass: 'flammable' }), bin: bin() })).toBe(true)
    expect(conditionsMatch(HAZARD_TO_HAZZONE.conditions, { sku: sku(), bin: bin() })).toBe(false)
  })
})

describe('evaluateRules — hard', () => {
  it('vetoes a frozen SKU placed outside a cold zone', () => {
    const res = evaluateRules([FROZEN_TO_COLD], { sku: sku({ category: 'frozen' }), bin: bin({ zoneTag: 'ambient' }) })
    expect(res.hardViolation?.rule.id).toBe(1)
  })

  it('allows a frozen SKU in a cold zone', () => {
    const res = evaluateRules([FROZEN_TO_COLD], { sku: sku({ category: 'frozen' }), bin: bin({ zoneTag: 'cold' }) })
    expect(res.hardViolation).toBeNull()
  })

  it('ignores rules whose conditions do not match', () => {
    const res = evaluateRules([FROZEN_TO_COLD], { sku: sku({ category: 'dry' }), bin: bin({ zoneTag: 'ambient' }) })
    expect(res.hardViolation).toBeNull()
  })

  it('reports the highest-priority violation when several apply', () => {
    const hazardSku = sku({ category: 'frozen', hazardClass: 'flammable' })
    const wrongBin = bin({ zoneTag: 'ambient' })
    const res = evaluateRules([HAZARD_TO_HAZZONE, FROZEN_TO_COLD], { sku: hazardSku, bin: wrongBin })
    expect(res.hardViolation?.rule.id).toBe(1) // priority 100 > 90
  })
})

describe('evaluateRules — soft', () => {
  it('emits a positive boost trigger when the bin holds the same product', () => {
    const res = evaluateRules([PREFER_GROUPING], { sku: sku(), bin: bin({ hasSameProduct: true }) })
    expect(res.softTriggers).toHaveLength(1)
    expect(res.softTriggers[0]).toMatchObject({ ruleId: 3, effect: 'boost', delta: 0.15 })
  })

  it('emits nothing when the soft condition does not match', () => {
    const res = evaluateRules([PREFER_GROUPING], { sku: sku(), bin: bin({ hasSameProduct: false }) })
    expect(res.softTriggers).toHaveLength(0)
  })
})
