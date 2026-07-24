// Advisory checks for a manually-chosen putaway bin. These are warnings the
// operator can proceed past — the tests pin WHICH findings fire, not that any
// of them block, because none of them do.

import { describe, it, expect } from 'vitest'
import {
  binFillFromBalances,
  evaluateBinWarnings,
  resolveZoneProfileId,
} from '@/components/inventory/putaway/putawayGuards'
import type { InventoryLocation, Product, ZoneProfile } from '@/types'

function bin(over: Partial<InventoryLocation> = {}): InventoryLocation {
  return {
    id: 10,
    kind: 'BIN',
    code: 'A-01-01',
    name: 'Bay 1',
    materializedPath: '/1/5/10',
    isActive: true,
    capacitySlots: 100,
    ...over,
  } as InventoryLocation
}

function product(over: Partial<Product> = {}): Product {
  return {
    id: 1,
    sku: 'SKU-1',
    name: 'Fish Sauce',
    description: '',
    price: 5,
    category: 'Sauces',
    inventory: 0,
    available: 0,
    unit: 'bottle',
    cartonSize: 12,
    supplierId: 1,
    sizeFactor: 1,
    ...over,
  } as Product
}

const zone = (over: Partial<ZoneProfile> = {}): ZoneProfile => ({
  id: 3,
  name: 'Chilled',
  zoneType: 'chilled',
  priorityWeight: 0.5,
  isActive: true,
  ...over,
}) as ZoneProfile

describe('binFillFromBalances', () => {
  it('sums on_hand × size_factor per location', () => {
    const fill = binFillFromBalances([
      { locationId: 10, productId: 1, productName: 'a', sizeFactor: 2, onHand: 5, allocated: 0, huId: null, huType: null },
      { locationId: 10, productId: 2, productName: 'b', sizeFactor: 1, onHand: 3, allocated: 0, huId: null, huType: null },
      { locationId: 11, productId: 1, productName: 'a', sizeFactor: 2, onHand: 1, allocated: 0, huId: null, huType: null },
    ])
    expect(fill.get(10)).toBe(13)
    expect(fill.get(11)).toBe(2)
  })

  it('treats a missing balance list as an empty map', () => {
    expect(binFillFromBalances(undefined).size).toBe(0)
  })
})

describe('resolveZoneProfileId', () => {
  const bay = bin({ id: 10, parentId: 5, zoneProfileId: undefined })
  const aisle = bin({ id: 5, kind: 'AISLE', parentId: 2, zoneProfileId: undefined })
  const zoneNode = bin({ id: 2, kind: 'ZONE', parentId: 1, zoneProfileId: 7 })
  const byId = new Map([bay, aisle, zoneNode].map((l) => [l.id, l]))

  it('walks up to the nearest ancestor carrying a profile', () => {
    expect(resolveZoneProfileId(bay, byId)).toBe(7)
  })

  it('prefers the node itself over an ancestor', () => {
    expect(resolveZoneProfileId(bin({ id: 10, parentId: 5, zoneProfileId: 99 }), byId)).toBe(99)
  })

  it('returns undefined when nothing in the chain has one', () => {
    const orphan = bin({ id: 40, parentId: undefined })
    expect(resolveZoneProfileId(orphan, new Map([[40, orphan]]))).toBeUndefined()
  })

  it('does not hang on a parent cycle', () => {
    const a = bin({ id: 1, parentId: 2, zoneProfileId: undefined })
    const b = bin({ id: 2, parentId: 1, zoneProfileId: undefined })
    expect(resolveZoneProfileId(a, new Map([[1, a], [2, b]]))).toBeUndefined()
  })
})

describe('evaluateBinWarnings', () => {
  it('is silent when the drop fits and breaks no rule', () => {
    expect(evaluateBinWarnings({
      bin: bin(), product: product(), baseQty: 10, usedSlots: 0,
    })).toEqual([])
  })

  it('flags capacity in SLOTS, not base units', () => {
    // size_factor 3 ⇒ 40 units consume 120 slots in a 100-slot bin.
    const warnings = evaluateBinWarnings({
      bin: bin({ capacitySlots: 100 }),
      product: product({ sizeFactor: 3 }),
      baseQty: 40,
      usedSlots: 0,
    })
    expect(warnings.map((w) => w.code)).toEqual(['capacity'])
    expect(warnings[0].message).toContain('120')
  })

  it('counts stock already in the bin toward capacity', () => {
    expect(evaluateBinWarnings({
      bin: bin({ capacitySlots: 100 }), product: product(), baseQty: 10, usedSlots: 95,
    }).map((w) => w.code)).toEqual(['capacity'])
  })

  it('ignores capacity when the bin has none recorded', () => {
    expect(evaluateBinWarnings({
      bin: bin({ capacitySlots: undefined }), product: product(), baseQty: 9999, usedSlots: 0,
    })).toEqual([])
  })

  it('flags a category the zone does not allow', () => {
    const warnings = evaluateBinWarnings({
      bin: bin(),
      zoneProfile: zone({ allowedCategories: ['Fish', 'Noodles'] }),
      product: product({ category: 'Sauces' as Product['category'] }),
      baseQty: 1,
      usedSlots: 0,
    })
    expect(warnings.map((w) => w.code)).toEqual(['zone_category'])
  })

  it('matches allowed categories case-insensitively', () => {
    expect(evaluateBinWarnings({
      bin: bin(),
      zoneProfile: zone({ allowedCategories: ['sauces'] }),
      product: product({ category: 'Sauces' as Product['category'] }),
      baseQty: 1,
      usedSlots: 0,
    })).toEqual([])
  })

  it('treats an empty allowed-category list as "any category"', () => {
    expect(evaluateBinWarnings({
      bin: bin(), zoneProfile: zone({ allowedCategories: [] }), product: product(),
      baseQty: 1, usedSlots: 0,
    })).toEqual([])
  })

  it('flags a drop that exceeds the bin weight limit on its own', () => {
    const warnings = evaluateBinWarnings({
      bin: bin({ weightCapacityKg: 100 }),
      product: product(),
      baseQty: 20,
      usedSlots: 0,
      unitWeightKg: 8,
    })
    expect(warnings.map((w) => w.code)).toEqual(['weight'])
  })

  it('stays silent on weight when the product has none on file', () => {
    // capacitySlots undefined so only the weight rule is in play.
    expect(evaluateBinWarnings({
      bin: bin({ weightCapacityKg: 1, capacitySlots: undefined }), product: product(),
      baseQty: 999, usedSlots: 0, unitWeightKg: null,
    })).toEqual([])
  })

  it('warns that a staging node is not storage', () => {
    expect(evaluateBinWarnings({
      bin: bin({ kind: 'STAGING', capacitySlots: undefined }), product: product(),
      baseQty: 1, usedSlots: 0,
    }).map((w) => w.code)).toEqual(['not_storage'])
  })

  it('reports every finding at once, in a stable order', () => {
    const warnings = evaluateBinWarnings({
      bin: bin({ kind: 'STAGING', capacitySlots: 5, weightCapacityKg: 1 }),
      zoneProfile: zone({ allowedCategories: ['Fish'] }),
      product: product({ category: 'Sauces' as Product['category'] }),
      baseQty: 10,
      usedSlots: 0,
      unitWeightKg: 5,
    })
    expect(warnings.map((w) => w.code)).toEqual(['capacity', 'zone_category', 'weight', 'not_storage'])
  })
})

// ── Per-plate capacity (mig 00078) ───────────────────────────────────────────
// The client half of the rule: the picker's fill and its capacity warning must
// agree with the engine, or a pallet bay the engine just called fine gets a red
// "over capacity" banner from the manual picker.

const balance = (over: Partial<Parameters<typeof binFillFromBalances>[0][number]> = {}) => ({
  locationId: 10, productId: 1, productName: 'a', sizeFactor: 1,
  onHand: 130, allocated: 0, huId: 7, huType: 'pallet' as const, ...over,
})

describe('binFillFromBalances — pallet bins', () => {
  const palletBins = new Map([[10, { slotKind: 'pallet' as const }]])

  it('counts one position per pallet, not one per unit', () => {
    expect(binFillFromBalances([balance()], palletBins).get(10)).toBe(1)
  })

  it('counts a mixed-SKU pallet once', () => {
    const fill = binFillFromBalances(
      [balance({ productId: 1, onHand: 40 }), balance({ productId: 2, onHand: 25 })],
      palletBins,
    )
    expect(fill.get(10)).toBe(1)
  })

  it('keeps per-unit maths for a carton bin', () => {
    expect(binFillFromBalances([balance()], new Map([[10, { slotKind: 'carton' as const }]])).get(10)).toBe(130)
  })

  it('keeps per-unit maths when no location map is supplied', () => {
    expect(binFillFromBalances([balance()]).get(10)).toBe(130)
  })
})

describe('evaluateBinWarnings — pallet bins', () => {
  it('does not cry over-capacity for a pallet into a bay with a free position', () => {
    const warnings = evaluateBinWarnings({
      bin: bin({ capacitySlots: 10, slotKind: 'pallet' }),
      product: product(),
      baseQty: 130,
      usedSlots: 3,
      huType: 'pallet',
    })
    expect(warnings.find((w) => w.code === 'capacity')).toBeUndefined()
  })

  it('still warns when every position is taken, and says "positions"', () => {
    const warnings = evaluateBinWarnings({
      bin: bin({ capacitySlots: 10, slotKind: 'pallet' }),
      product: product(),
      baseQty: 130,
      usedSlots: 10,
      huType: 'pallet',
    })
    expect(warnings.find((w) => w.code === 'capacity')?.message).toContain('positions')
  })

  it('keeps per-unit maths — and "slots" — for a carton bin', () => {
    const warnings = evaluateBinWarnings({
      bin: bin({ capacitySlots: 10, slotKind: 'carton' }),
      product: product(),
      baseQty: 130,
      usedSlots: 0,
      huType: 'pallet',
    })
    expect(warnings.find((w) => w.code === 'capacity')?.message).toContain('slots')
  })
})
