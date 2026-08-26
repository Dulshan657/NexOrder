import { describe, it, expect } from 'vitest'
import {
  foldMatch,
  ruleMatchesProduct,
  resolveSlotting,
  planSlotting,
  tierOf,
  isOffHome,
  describeBin,
} from '../../supabase/functions/_shared/wie/slotting'
import type {
  SlottingRuleSpec,
  SlottingProduct,
  SlottingInput,
} from '../../supabase/functions/_shared/wie/slotting'

// ── Fixtures ─────────────────────────────────────────────────────────────────

/** Specificity is a GENERATED column in mig 00115; these fixtures reproduce the
 *  same bitmask so the tests exercise the ladder the database will hand over. */
function specificityOf(m: Partial<SlottingRuleSpec>): number {
  return (m.matchProductId != null ? 8 : 0)
    + (m.matchBrand != null ? 4 : 0)
    + (m.matchCategory != null ? 2 : 0)
    + (m.matchSupplierId != null ? 1 : 0)
}

let nextId = 1
function rule(over: Partial<SlottingRuleSpec> = {}): SlottingRuleSpec {
  const base = {
    matchProductId: null,
    matchBrand: null,
    matchCategory: null,
    matchSupplierId: null,
    ...over,
  }
  return {
    id: over.id ?? nextId++,
    name: over.name ?? `rule-${nextId}`,
    specificity: over.specificity ?? specificityOf(base),
    matchProductId: base.matchProductId,
    matchBrand: base.matchBrand,
    matchCategory: base.matchCategory,
    matchSupplierId: base.matchSupplierId,
    enforcement: over.enforcement ?? 'soft',
    reserveEmpty: over.reserveEmpty ?? false,
    blockIds: over.blockIds ?? [],
  }
}

const MILWAUKEE_DRILL: SlottingProduct = {
  productId: 1, brand: 'Milwaukee', category: 'Drills', supplierIds: [10],
}
const MILWAUKEE_BATTERY: SlottingProduct = {
  productId: 2, brand: 'Milwaukee', category: 'Batteries', supplierIds: [10],
}
const UNBRANDED: SlottingProduct = {
  productId: 3, brand: null, category: 'Drills', supplierIds: [11],
}

function input(over: Partial<SlottingInput> & { rules: readonly SlottingRuleSpec[] }): SlottingInput {
  return {
    product: over.product ?? MILWAUKEE_DRILL,
    rules: over.rules,
    blockNames: over.blockNames ?? new Map([[1, 'Aisle C'], [2, 'Mezzanine'], [3, 'Cold Room']]),
    candidates: over.candidates ?? [],
    blockIdsByLocation: over.blockIdsByLocation ?? new Map(),
    heldLocationIds: over.heldLocationIds,
  }
}

function bins(...ids: number[]) {
  return ids.map((id) => ({ locationId: id, code: `BIN-${id}` }))
}

// ── 1. Unruled is byte-identical to today ────────────────────────────────────
// The regression guard that matters most: every existing site has zero rules on
// day one, and nothing about their putaway may change.

describe('a product no rule claims', () => {
  it('produces an inert plan — no exclusions, no tiers, no opinion', () => {
    const plan = planSlotting(input({
      rules: [rule({ matchBrand: 'DeWalt', blockIds: [1] })],
      candidates: bins(100, 101),
      blockIdsByLocation: new Map([[100, [1]]]),
    }))

    expect(plan.inert).toBe(true)
    expect(plan.resolution.rule).toBeNull()
    expect(plan.excluded).toHaveLength(0)
    expect(isOffHome(plan, 100)).toBe(false)
    expect(isOffHome(plan, 101)).toBe(false)
  })

  it('gives every bin the same tier, so a stable sort cannot reorder them', () => {
    const plan = planSlotting(input({
      rules: [rule({ matchBrand: 'DeWalt', blockIds: [1] })],
      candidates: bins(100, 101, 102),
      blockIdsByLocation: new Map([[100, [1]], [101, [1]]]),
    }))
    const tiers = [100, 101, 102].map((id) => tierOf(plan, id))
    expect(new Set(tiers).size).toBe(1)
  })

  it('describeBin says nothing at all', () => {
    const plan = planSlotting(input({ rules: [], candidates: bins(100) }))
    expect(describeBin(plan, 100)).toEqual({
      status: 'unruled', rank: null, blockName: null, text: '',
    })
  })
})

// ── 2. The ladder ────────────────────────────────────────────────────────────

describe('precedence: most specific wins', () => {
  it('SKU beats brand beats category beats supplier', () => {
    const sku = rule({ matchProductId: 1, name: 'sku', blockIds: [1] })
    const brand = rule({ matchBrand: 'Milwaukee', name: 'brand', blockIds: [2] })
    const cat = rule({ matchCategory: 'Drills', name: 'cat', blockIds: [3] })
    const sup = rule({ matchSupplierId: 10, name: 'sup', blockIds: [1] })

    // Shuffled input order must not matter.
    expect(resolveSlotting([sup, cat, brand, sku], MILWAUKEE_DRILL).rule?.name).toBe('sku')
    expect(resolveSlotting([sup, cat, brand], MILWAUKEE_DRILL).rule?.name).toBe('brand')
    expect(resolveSlotting([sup, cat], MILWAUKEE_DRILL).rule?.name).toBe('cat')
    expect(resolveSlotting([sup], MILWAUKEE_DRILL).rule?.name).toBe('sup')
  })

  it('brand+category outranks brand alone — the case an enum would tie', () => {
    const brandOnly = rule({ matchBrand: 'Milwaukee', name: 'brand-only', blockIds: [1] })
    const both = rule({ matchBrand: 'Milwaukee', matchCategory: 'Drills', name: 'both', blockIds: [2] })
    expect(resolveSlotting([brandOnly, both], MILWAUKEE_DRILL).rule?.name).toBe('both')
    expect(both.specificity).toBeGreaterThan(brandOnly.specificity)
  })

  it('only the WINNER’s blocks apply — never the union', () => {
    const sku = rule({ matchProductId: 1, name: 'sku', blockIds: [1] })
    const brand = rule({ matchBrand: 'Milwaukee', name: 'brand', blockIds: [2, 3] })
    const res = resolveSlotting([brand, sku], MILWAUKEE_DRILL)
    expect(res.homeBlockIds).toEqual([1])
    // ...but the loser is still reported, for the "why" panel.
    expect(res.matched.map((r) => r.name)).toEqual(['sku', 'brand'])
  })

  it('breaks a specificity tie deterministically by id', () => {
    const a = rule({ id: 7, matchBrand: 'Milwaukee', name: 'a', blockIds: [1] })
    const b = rule({ id: 3, matchBrand: 'milwaukee', name: 'b', blockIds: [2] })
    expect(resolveSlotting([a, b], MILWAUKEE_DRILL).rule?.name).toBe('b')
    expect(resolveSlotting([b, a], MILWAUKEE_DRILL).rule?.name).toBe('b')
  })
})

// ── 3. AND semantics ─────────────────────────────────────────────────────────

describe('conditions combine with AND', () => {
  it('brand + category does not match a product with only the brand', () => {
    const r = rule({ matchBrand: 'Milwaukee', matchCategory: 'Batteries' })
    expect(ruleMatchesProduct(r, MILWAUKEE_BATTERY)).toBe(true)
    expect(ruleMatchesProduct(r, MILWAUKEE_DRILL)).toBe(false)
  })

  it('a null axis is "no opinion", not "must be null"', () => {
    const r = rule({ matchCategory: 'Drills' })
    expect(ruleMatchesProduct(r, MILWAUKEE_DRILL)).toBe(true)
    expect(ruleMatchesProduct(r, UNBRANDED)).toBe(true)
  })

  it('matches any of a product’s linked suppliers, not just the first', () => {
    const r = rule({ matchSupplierId: 12 })
    expect(ruleMatchesProduct(r, { ...MILWAUKEE_DRILL, supplierIds: [10, 12] })).toBe(true)
    expect(ruleMatchesProduct(r, MILWAUKEE_DRILL)).toBe(false)
  })

  it('never matches everything, even given a rule with no axes', () => {
    // mig 00115's CHECK refuses this row, but a silent claim on the whole
    // catalogue is the worst possible failure so the engine refuses it too.
    expect(ruleMatchesProduct(rule({}), MILWAUKEE_DRILL)).toBe(false)
  })
})

// ── 4. Fold parity with SQL ──────────────────────────────────────────────────

describe('foldMatch agrees with lower(btrim(x))', () => {
  it('folds case and surrounding spaces', () => {
    expect(foldMatch('  Milwaukee ')).toBe('milwaukee')
    expect(foldMatch('MILWAUKEE')).toBe('milwaukee')
  })

  it('treats null, undefined and blank as "no value"', () => {
    expect(foldMatch(null)).toBeNull()
    expect(foldMatch(undefined)).toBeNull()
    expect(foldMatch('   ')).toBeNull()
  })

  it('strips ASCII spaces ONLY, exactly as btrim does — not tabs or newlines', () => {
    // JS .trim() would return 'milwaukee' here and diverge from Postgres.
    expect(foldMatch('\tMilwaukee')).toBe('\tmilwaukee')
    expect(foldMatch('Milwaukee\n')).toBe('milwaukee\n')
  })

  it('matches a rule typed with stray spaces against a stored value', () => {
    const r = rule({ matchBrand: ' milwaukee ' })
    expect(ruleMatchesProduct(r, MILWAUKEE_DRILL)).toBe(true)
  })
})

// ── 5-6. Ranked overflow, and sort stability ─────────────────────────────────

describe('ranked homes then anywhere', () => {
  const R = rule({ matchBrand: 'Milwaukee', name: 'Milwaukee', blockIds: [1, 2] })
  const plan = planSlotting(input({
    rules: [R],
    candidates: bins(100, 101, 102, 103),
    blockIdsByLocation: new Map([[100, [1]], [101, [2]], [102, [2]]]),
  }))

  it('tiers by the operator’s rank order', () => {
    expect(tierOf(plan, 100)).toBe(0)
    expect(tierOf(plan, 101)).toBe(1)
    expect(tierOf(plan, 102)).toBe(1)
  })

  it('puts every non-member last, and flags it off-home', () => {
    expect(tierOf(plan, 103)).toBe(plan.offHomeTier)
    expect(plan.offHomeTier).toBe(2)
    expect(isOffHome(plan, 103)).toBe(true)
    expect(isOffHome(plan, 100)).toBe(false)
  })

  it('removes nothing for a soft rule — fall-through is structural', () => {
    expect(plan.excluded).toHaveLength(0)
    expect(plan.tierByLocation.size).toBe(4)
  })

  it('takes the BEST rank when a bin sits in two of the winner’s blocks', () => {
    const p = planSlotting(input({
      rules: [R],
      candidates: bins(100),
      blockIdsByLocation: new Map([[100, [2, 1]]]),
    }))
    expect(tierOf(p, 100)).toBe(0)
  })

  it('preserves score order within a tier under a stable sort', () => {
    // The integration contract with putawayPlan: sorting by tier alone must not
    // disturb the relative order of equal-tier bins.
    const scored = [103, 101, 100, 102]
    const sorted = [...scored].sort((a, b) => tierOf(plan, a) - tierOf(plan, b))
    expect(sorted).toEqual([100, 101, 102, 103])
  })
})

// ── 7. A hard rule refuses, but never wedges ─────────────────────────────────

describe('hard enforcement', () => {
  const HARD = rule({ matchBrand: 'Milwaukee', name: 'Milwaukee', enforcement: 'hard', blockIds: [1] })

  it('excludes every bin outside the assigned blocks, naming the rule', () => {
    const plan = planSlotting(input({
      rules: [HARD],
      candidates: bins(100, 200),
      blockIdsByLocation: new Map([[100, [1]]]),
    }))
    expect(plan.excluded).toHaveLength(1)
    expect(plan.excluded[0]).toMatchObject({
      locationId: 200, code: 'slotting_hard', ruleId: HARD.id, ruleName: 'Milwaukee',
    })
    expect(plan.excluded[0].reason).toContain('Aisle C')
  })

  it('still returns the home bins — a refusal is never an empty plan', () => {
    const plan = planSlotting(input({
      rules: [HARD],
      candidates: bins(100, 200),
      blockIdsByLocation: new Map([[100, [1]]]),
    }))
    expect([...plan.tierByLocation.keys()]).toEqual([100])
  })

  it('leaves an unmatched product completely alone', () => {
    const plan = planSlotting(input({
      product: UNBRANDED,
      rules: [HARD],
      candidates: bins(100, 200),
      blockIdsByLocation: new Map([[100, [1]]]),
    }))
    expect(plan.excluded).toHaveLength(0)
    expect(plan.tierByLocation.size).toBe(2)
  })
})

// ── 8-9. Reservation ─────────────────────────────────────────────────────────

describe('reserve_empty', () => {
  it('defaults OFF: anyone may use an assigned bin, flagged off-home', () => {
    const owner = rule({ matchBrand: 'Milwaukee', name: 'Milwaukee', blockIds: [1] })
    const plan = planSlotting(input({
      product: UNBRANDED,
      rules: [owner],
      candidates: bins(100),
      blockIdsByLocation: new Map([[100, [1]]]),
    }))
    expect(plan.excluded).toHaveLength(0)
    expect(plan.tierByLocation.has(100)).toBe(true)
  })

  it('refuses a product no rule homes there, naming the reserving rule', () => {
    const owner = rule({ matchBrand: 'Milwaukee', name: 'Milwaukee', reserveEmpty: true, blockIds: [1] })
    const plan = planSlotting(input({
      product: UNBRANDED,
      rules: [owner],
      candidates: bins(100, 200),
      blockIdsByLocation: new Map([[100, [1]]]),
    }))
    expect(plan.excluded).toHaveLength(1)
    expect(plan.excluded[0]).toMatchObject({ locationId: 100, code: 'slotting_reserved' })
    expect(plan.excluded[0].reason).toContain('Aisle C')
    expect(plan.excluded[0].reason).toContain('Milwaukee')
  })

  it('ADMITS a product homed there by a different, non-reserving rule', () => {
    // The union rule. Refusing here would make a second rule's products
    // off-home in a block they are explicitly homed in.
    const reserver = rule({ matchBrand: 'Milwaukee', name: 'Milwaukee', reserveEmpty: true, blockIds: [1] })
    const sharer = rule({ matchCategory: 'Drills', name: 'Drills', blockIds: [1] })
    const plan = planSlotting(input({
      product: UNBRANDED, // category Drills -> matched by `sharer`
      rules: [reserver, sharer],
      candidates: bins(100),
      blockIdsByLocation: new Map([[100, [1]]]),
    }))
    expect(plan.excluded).toHaveLength(0)
    expect(tierOf(plan, 100)).toBe(0)
  })

  it('reserves even when the reserving rule is not the winner for anyone here', () => {
    const reserver = rule({ matchProductId: 99, name: 'Special', reserveEmpty: true, blockIds: [3] })
    const plan = planSlotting(input({
      rules: [reserver],
      candidates: bins(300),
      blockIdsByLocation: new Map([[300, [3]]]),
    }))
    expect(plan.excluded[0]).toMatchObject({ locationId: 300, code: 'slotting_reserved' })
    expect(plan.inert).toBe(false)
  })
})

// ── Quarantine exemption ─────────────────────────────────────────────────────

describe('held (quarantine) bins', () => {
  const HARD = rule({ matchBrand: 'Milwaukee', name: 'Milwaukee', enforcement: 'hard', blockIds: [1] })

  it('are never excluded, even under a hard rule', () => {
    const plan = planSlotting(input({
      rules: [HARD],
      candidates: bins(900, 901),
      blockIdsByLocation: new Map(),
      heldLocationIds: new Set([900, 901]),
    }))
    expect(plan.excluded).toHaveLength(0)
    expect(plan.tierByLocation.size).toBe(2)
  })

  it('are never off-home — quarantined stock is not misplaced', () => {
    const plan = planSlotting(input({
      rules: [HARD],
      candidates: bins(900),
      blockIdsByLocation: new Map(),
      heldLocationIds: new Set([900]),
    }))
    expect(isOffHome(plan, 900)).toBe(false)
    expect(tierOf(plan, 900)).toBe(0)
  })

  it('are never excluded by a reservation either', () => {
    const reserver = rule({ matchProductId: 99, name: 'Special', reserveEmpty: true, blockIds: [1] })
    const plan = planSlotting(input({
      rules: [reserver],
      candidates: bins(900),
      blockIdsByLocation: new Map([[900, [1]]]),
      heldLocationIds: new Set([900]),
    }))
    expect(plan.excluded).toHaveLength(0)
  })
})

// ── Operator-facing text ─────────────────────────────────────────────────────

describe('describeBin', () => {
  const R = rule({ matchBrand: 'Milwaukee', name: 'Milwaukee', blockIds: [1, 2] })
  const plan = planSlotting(input({
    rules: [R],
    candidates: bins(100, 101, 999),
    blockIdsByLocation: new Map([[100, [1]], [101, [2]]]),
  }))

  it('names the block and the rule for a primary home', () => {
    expect(describeBin(plan, 100)).toMatchObject({
      status: 'home', rank: 1, blockName: 'Aisle C',
    })
    expect(describeBin(plan, 100).text).toBe('Aisle C — Milwaukee')
  })

  it('says which overflow a lower-ranked block is', () => {
    expect(describeBin(plan, 101)).toMatchObject({ status: 'home', rank: 2, blockName: 'Mezzanine' })
    expect(describeBin(plan, 101).text).toContain('overflow 1')
  })

  it('announces off-home and says where it should have gone', () => {
    const v = describeBin(plan, 999)
    expect(v.status).toBe('off_home')
    expect(v.text).toContain('Off-home')
    expect(v.text).toContain('Aisle C or Mezzanine')
  })
})
