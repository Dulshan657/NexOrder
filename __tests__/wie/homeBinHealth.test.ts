import { describe, it, expect } from 'vitest'
import {
  homeBinCandidateFactsFromRow,
  homeBinChoices,
  homeBinFactsFromRow,
  homeBinProblems,
  homeBinReport,
  homeChoiceRefusal,
  slottingRefusalFor,
  type HomeBinCandidateFacts,
  type HomeBinCandidateFactsRow,
  type HomeBinFacts,
  type HomeBinFactsRow,
  type HomeBinProblemCode,
} from '../../supabase/functions/_shared/wie/homeBinHealth'
import type { SlottingInput, SlottingRuleSpec } from '../../supabase/functions/_shared/wie/slotting'

// A healthy home: active, outside any hold zone, on a pick-zone level that takes
// cartons, on the published layout with a route from a dock, 10 slots with 2
// used. Every test changes ONE thing, so the code that comes back can only be
// the one that field owns.
const healthy = (o: Partial<HomeBinFacts> = {}): HomeBinFacts => ({
  productId: 1,
  sku: 'TST-HOME-200',
  binId: 20,
  binCode: 'TST-A-01-1',
  warehouseId: 7,
  binWarehouseId: 7,
  isActive: true,
  isHold: false,
  levelRole: 'pick',
  isPickZone: true,
  levelHuTypes: ['carton'],
  allowedLevelRoles: [],
  inActiveLayout: true,
  hasDockRoute: true,
  zoneAllowedCategories: null,
  category: 'Dry',
  capacitySlots: 10,
  usedSlots: 2,
  pendingSlots: 0,
  sizeFactor: 1,
  maxQty: null,
  onHandAtHome: 2,
  pendingQty: 0,
  slottingRefusal: null,
  ...o,
})

const codes = (f: HomeBinFacts): HomeBinProblemCode[] => homeBinProblems(f).map((p) => p.code)

describe('homeBinProblems', () => {
  it('a healthy home has no problems', () => {
    expect(homeBinProblems(healthy())).toEqual([])
  })

  it('is_active = false gives inactive', () => {
    expect(codes(healthy({ isActive: false }))).toEqual(['inactive'])
  })

  it('is_hold gives hold_zone', () => {
    expect(codes(healthy({ isHold: true }))).toEqual(['hold_zone'])
  })

  it('is_pick_zone = false gives not_pick_level', () => {
    expect(codes(healthy({ isPickZone: false }))).toEqual(['not_pick_level'])
  })

  it('a level that does not take cartons gives carton_not_allowed', () => {
    expect(codes(healthy({ levelHuTypes: ['pallet'] }))).toEqual(['carton_not_allowed'])
    expect(codes(healthy({ levelHuTypes: [] }))).toEqual(['carton_not_allowed'])
  })

  it('allowed_level_roles that leave out the home level give level_role_not_allowed', () => {
    expect(codes(healthy({ allowedLevelRoles: ['bulk'] }))).toEqual(['level_role_not_allowed'])
  })

  it('allowed_level_roles that include the home level, or none at all, are fine', () => {
    expect(codes(healthy({ allowedLevelRoles: ['bulk', 'pick'] }))).toEqual([])
    expect(codes(healthy({ allowedLevelRoles: [] }))).toEqual([])
  })

  it('a bin with no level role is legacy and passes every level test, as putaway reads it', () => {
    // wie_putaway_candidates and wie_home_block both accept a NULL level_role.
    expect(codes(healthy({
      levelRole: null, isPickZone: false, levelHuTypes: [], allowedLevelRoles: ['bulk'],
    }))).toEqual([])
  })

  it('in_active_layout = false gives not_on_layout', () => {
    expect(codes(healthy({ inActiveLayout: false }))).toEqual(['not_on_layout'])
  })

  it('has_dock_route = false gives no_dock_route', () => {
    expect(codes(healthy({ hasDockRoute: false }))).toEqual(['no_dock_route'])
  })

  it('a category outside the zone allow-list gives zone_category', () => {
    expect(codes(healthy({ zoneAllowedCategories: ['Frozen', 'Chilled'], category: 'Dry' })))
      .toEqual(['zone_category'])
  })

  it('a category inside the allow-list, an empty list, no list or no category is fine', () => {
    expect(codes(healthy({ zoneAllowedCategories: ['Dry'], category: 'Dry' }))).toEqual([])
    expect(codes(healthy({ zoneAllowedCategories: [], category: 'Dry' }))).toEqual([])
    expect(codes(healthy({ zoneAllowedCategories: null, category: 'Dry' }))).toEqual([])
    expect(codes(healthy({ zoneAllowedCategories: ['Frozen'], category: null }))).toEqual([])
  })

  it('a slotting refusal gives slotting_refused and carries its words', () => {
    const problems = homeBinProblems(healthy({ slottingRefusal: 'reserved for X' }))
    expect(problems.map((p) => p.code)).toEqual(['slotting_refused'])
    expect(problems[0].message).toContain('reserved for X')
  })

  it('capacity 10, used 10 gives full', () => {
    expect(codes(healthy({ capacitySlots: 10, usedSlots: 10 }))).toEqual(['full'])
  })

  it('capacity null (blank) with 900 used is never full', () => {
    expect(codes(healthy({ capacitySlots: null, usedSlots: 900 }))).toEqual([])
  })

  it('space promised to open tasks counts, like the stock already there', () => {
    expect(codes(healthy({ capacitySlots: 10, usedSlots: 6, pendingSlots: 4 }))).toEqual(['full'])
    expect(codes(healthy({ capacitySlots: 10, usedSlots: 6, pendingSlots: 3 }))).toEqual([])
  })

  it('the room is in whole base units: under one unit left is full', () => {
    // wie_home_block floors the room, so half a unit left is room 0.
    expect(codes(healthy({ capacitySlots: 10, usedSlots: 9 }))).toEqual([])
    expect(codes(healthy({ capacitySlots: 10, usedSlots: 9.5 }))).toEqual(['full'])
    // One free slot at size factor 2 is half a unit.
    expect(codes(healthy({ capacitySlots: 10, usedSlots: 9, sizeFactor: 2 }))).toEqual(['full'])
    expect(codes(healthy({ capacitySlots: 10, usedSlots: 8, sizeFactor: 2 }))).toEqual([])
  })

  it('max_qty fills the home on its own, counting open tasks to it', () => {
    expect(codes(healthy({ maxQty: 5, onHandAtHome: 5 }))).toEqual(['full'])
    expect(codes(healthy({ maxQty: 5, onHandAtHome: 3, pendingQty: 2 }))).toEqual(['full'])
    expect(codes(healthy({ maxQty: 5, onHandAtHome: 3, pendingQty: 1 }))).toEqual([])
    expect(codes(healthy({ capacitySlots: null, maxQty: 5, onHandAtHome: 5 }))).toEqual(['full'])
  })

  it('a bin in another warehouse gives other_warehouse', () => {
    expect(codes(healthy({ binWarehouseId: 8 }))).toEqual(['other_warehouse'])
    expect(codes(healthy({ binWarehouseId: null }))).toEqual(['other_warehouse'])
  })

  it('reports every problem, in a fixed order, each naming the bin', () => {
    const problems = homeBinProblems(healthy({
      isActive: false, isHold: true, inActiveLayout: false, capacitySlots: 10, usedSlots: 10,
    }))
    expect(problems.map((p) => p.code)).toEqual(['inactive', 'hold_zone', 'not_on_layout', 'full'])
    for (const p of problems) {
      expect(p.message.length).toBeGreaterThan(0)
      expect(p.message).toContain('TST-A-01-1')
    }
  })
})

describe('homeBinFactsFromRow', () => {
  const row = (o: Partial<HomeBinFactsRow> = {}): HomeBinFactsRow => ({
    product_id: 1,
    sku: 'TST-HOME-200',
    bin_id: 20,
    bin_code: 'TST-A-01-1',
    bin_warehouse_id: 7,
    is_active: true,
    is_hold: false,
    level_role: 'pick',
    is_pick_zone: true,
    level_hu_types: ['carton'],
    allowed_level_roles: null,
    in_active_layout: true,
    has_dock_route: true,
    zone_allowed_categories: null,
    category: 'Dry',
    capacity_slots: 10,
    used_slots: 2,
    pending_slots: 0,
    size_factor: 1,
    max_qty: null,
    on_hand_at_home: 2,
    pending_qty: 0,
    ...o,
  })

  it('maps the row, takes the warehouse from the caller and starts with no slotting refusal', () => {
    expect(homeBinFactsFromRow(row(), 7)).toEqual(healthy({ onHandAtHome: 2 }))
  })

  it('reads blank arrays as empty and numbers that arrive as text as numbers', () => {
    const facts = homeBinFactsFromRow(row({
      allowed_level_roles: null,
      level_hu_types: null,
      capacity_slots: '10' as unknown as number,
      used_slots: '2.5' as unknown as number,
      max_qty: '40' as unknown as number,
    }), 7)
    expect(facts.allowedLevelRoles).toEqual([])
    expect(facts.levelHuTypes).toEqual([])
    expect(facts.capacitySlots).toBe(10)
    expect(facts.usedSlots).toBe(2.5)
    expect(facts.maxQty).toBe(40)
  })

  it('keeps a blank capacity and a blank max blank, not zero', () => {
    const facts = homeBinFactsFromRow(row({ capacity_slots: null, max_qty: null }), 7)
    expect(facts.capacitySlots).toBeNull()
    expect(facts.maxQty).toBeNull()
    expect(codes(facts)).toEqual([])
  })

  it('treats a size factor of zero or less as 1, as the room maths does', () => {
    const facts = homeBinFactsFromRow(row({ size_factor: 0, capacity_slots: 10, used_slots: 9 }), 7)
    expect(codes(facts)).toEqual([])
  })
})

describe('slottingRefusalFor', () => {
  const rule = (o: Partial<SlottingRuleSpec> = {}): SlottingRuleSpec => ({
    id: 1, name: 'Test rule', specificity: 1, matchProductId: 1, matchBrand: null,
    matchCategory: null, matchSupplierId: null, enforcement: 'hard', reserveEmpty: false,
    blockIds: [10], ...o,
  })
  const input = (o: Partial<SlottingInput> = {}): SlottingInput => ({
    product: { productId: 1, brand: null, category: 'Dry', supplierIds: [] },
    rules: [rule()],
    blockNames: new Map([[10, 'Block A'], [11, 'Block B']]),
    candidates: [],
    blockIdsByLocation: new Map([[20, [11]], [21, [10]]]),
    ...o,
  })

  it('a hard rule whose blocks leave out the home refuses it', () => {
    const refusal = slottingRefusalFor(input(), 20, 'TST-A-01-1')
    expect(refusal).not.toBeNull()
    expect(refusal).toContain('Block A')
  })

  it('a hard rule whose block holds the home does not refuse it', () => {
    expect(slottingRefusalFor(input(), 21, 'TST-A-01-2')).toBeNull()
  })

  it('a soft rule never refuses, it only ranks', () => {
    expect(slottingRefusalFor(input({ rules: [rule({ enforcement: 'soft' })] }), 20, 'TST-A-01-1')).toBeNull()
  })

  it('a block held empty for another rule refuses a product it does not admit', () => {
    const rules = [rule({ id: 2, name: 'Held for X', matchProductId: 99, reserveEmpty: true, blockIds: [11] })]
    const refusal = slottingRefusalFor(input({ rules }), 20, 'TST-A-01-1')
    expect(refusal).not.toBeNull()
    expect(refusal).toContain('Block B')
  })

  it('a product no rule claims is not refused', () => {
    expect(slottingRefusalFor(input({ rules: [] }), 20, 'TST-A-01-1')).toBeNull()
  })

  it('a hold bin is never refused: slotting has no opinion on it', () => {
    expect(slottingRefusalFor(input({ heldLocationIds: new Set([20]) }), 20, 'TST-A-01-1')).toBeNull()
  })
})

describe('homeBinReport', () => {
  it('keeps only the homes that have problems, with their codes and messages, and counts every home', () => {
    const report = homeBinReport(7, [
      healthy({ productId: 1, sku: 'TST-HOME-200' }),
      healthy({ productId: 2, sku: 'TST-HOME-201', binId: 21, binCode: 'TST-A-01-2', isActive: false }),
      healthy({ productId: 3, sku: 'TST-HOME-202', binId: 22, binCode: 'TST-A-01-3', capacitySlots: 10, usedSlots: 10 }),
    ])
    expect(report.warehouseId).toBe(7)
    expect(report.checked).toBe(3)
    expect(report.rows.map((r) => [r.sku, r.binCode, r.problems.map((p) => p.code)])).toEqual([
      ['TST-HOME-201', 'TST-A-01-2', ['inactive']],
      ['TST-HOME-202', 'TST-A-01-3', ['full']],
    ])
  })

  it('is empty when every home is healthy', () => {
    expect(homeBinReport(7, [healthy()])).toEqual({ warehouseId: 7, checked: 1, rows: [] })
    expect(homeBinReport(7, [])).toEqual({ warehouseId: 7, checked: 0, rows: [] })
  })
})

// ── Which bins can be a product's home (NX-0033, C6) ─────────────────────────
// A candidate is a bin read as if it were the product's home. Same facts as a
// real home, plus the bin's name and the OTHER products already homed there.
const candidate = (o: Partial<HomeBinCandidateFacts> = {}): HomeBinCandidateFacts => ({
  ...healthy({ sku: 'TST-WALK-100', binCode: 'TST-WALK-B1' }),
  binName: null,
  otherHomeSkus: [],
  ...o,
})

describe('homeBinCandidateFactsFromRow', () => {
  const row = (o: Partial<HomeBinCandidateFactsRow> = {}): HomeBinCandidateFactsRow => ({
    product_id: 1,
    sku: 'TST-WALK-100',
    bin_id: 20,
    bin_code: 'TST-WALK-B1',
    bin_warehouse_id: 7,
    is_active: true,
    is_hold: false,
    level_role: 'pick',
    is_pick_zone: true,
    level_hu_types: ['carton'],
    allowed_level_roles: null,
    in_active_layout: true,
    has_dock_route: true,
    zone_allowed_categories: null,
    category: 'Dry',
    capacity_slots: 10,
    used_slots: 2,
    pending_slots: 0,
    size_factor: 1,
    max_qty: null,
    on_hand_at_home: 2,
    pending_qty: 0,
    bin_name: 'Bay one',
    other_home_skus: ['TST-WALK-900'],
    ...o,
  })

  it('maps the shared columns like a home, and adds the bin name and the other homes', () => {
    const facts = homeBinCandidateFactsFromRow(row(), 7)
    expect(facts).toEqual({
      ...homeBinFactsFromRow(row(), 7),
      binName: 'Bay one',
      otherHomeSkus: ['TST-WALK-900'],
    })
  })

  it('reads a blank name as null and a blank list of homes as none', () => {
    const facts = homeBinCandidateFactsFromRow(row({ bin_name: null, other_home_skus: null }), 7)
    expect(facts.binName).toBeNull()
    expect(facts.otherHomeSkus).toEqual([])
  })
})

describe('homeChoiceRefusal', () => {
  it("names the other product's home first, then the first problem, else null", () => {
    // Another product's home wins over any other problem the bin has.
    expect(homeChoiceRefusal(candidate({ isActive: false, otherHomeSkus: ['TST-WALK-900', 'TST-WALK-901'] })))
      .toBe('TST-WALK-B1 is the home bin of TST-WALK-900; choose another bin.')
    // Otherwise the first problem, in homeBinProblems' fixed order.
    expect(homeChoiceRefusal(candidate({ isActive: false, capacitySlots: 10, usedSlots: 10 })))
      .toBe('Bin TST-WALK-B1 is inactive, so putaway never offers it.')
    // A healthy bin that is nobody's home has no refusal.
    expect(homeChoiceRefusal(candidate())).toBeNull()
  })
})

describe('homeBinChoices', () => {
  it("keeps only bins with no problems that are not another product's home, by code", () => {
    const choices = homeBinChoices([
      candidate({ binId: 22, binCode: 'TST-WALK-B2', binName: 'Bay two' }),
      candidate({ binId: 21, binCode: 'TST-WALK-B1', binName: null }),
      candidate({ binId: 23, binCode: 'TST-WALK-B3', isActive: false }),
      candidate({ binId: 24, binCode: 'TST-WALK-B4', capacitySlots: 10, usedSlots: 10 }),
      candidate({ binId: 25, binCode: 'TST-WALK-B5', otherHomeSkus: ['TST-WALK-900'] }),
    ])
    expect(choices).toEqual([
      { binId: 21, binCode: 'TST-WALK-B1', binName: null },
      { binId: 22, binCode: 'TST-WALK-B2', binName: 'Bay two' },
    ])
  })

  it('lists the bins in code order, whatever order the facts came in', () => {
    const choices = homeBinChoices([
      candidate({ binId: 2, binCode: 'TST-WALK-C' }),
      candidate({ binId: 1, binCode: 'TST-WALK-A' }),
      candidate({ binId: 3, binCode: 'TST-WALK-B' }),
    ])
    expect(choices.map((c) => c.binCode)).toEqual(['TST-WALK-A', 'TST-WALK-B', 'TST-WALK-C'])
  })

  it('is empty when no bin qualifies, and for no facts at all', () => {
    expect(homeBinChoices([candidate({ isActive: false })])).toEqual([])
    expect(homeBinChoices([])).toEqual([])
  })

  it('does not change the list it is given', () => {
    const facts = [candidate({ binId: 2, binCode: 'TST-WALK-B2' }), candidate({ binId: 1, binCode: 'TST-WALK-B1' })]
    const before = facts.map((f) => f.binCode)
    homeBinChoices(facts)
    expect(facts.map((f) => f.binCode)).toEqual(before)
  })
})
