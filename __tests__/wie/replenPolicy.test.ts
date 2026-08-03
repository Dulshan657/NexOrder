import { describe, expect, it } from 'vitest'
import {
  DEFAULT_REPLEN_POLICY,
  capacityBaseUnits,
  proposeHomeBins,
  suggestMinMax,
  validateReplenRow,
  type ReplenConfigRow,
  type ReplenFreeBin,
  type ReplenPolicy,
} from '../../supabase/functions/_shared/wie/replenPolicy'
import {
  draftFigures,
  draftVerdict,
  formatEntry,
  initialDraft,
  isDraftDirty,
  parseQtyEntry,
  willBeArmed,
} from '../../lib/replenPolicy'

function row(overrides: Partial<ReplenConfigRow> = {}): ReplenConfigRow {
  return {
    productId: 1,
    sku: 'SKU-1',
    name: 'Product 1',
    category: null,
    sizeFactor: 1,
    packFactor: 12,
    palletFactor: null,
    stockedHere: true,
    onHandHere: 0,
    demandQty: 0,
    homeBinId: null,
    homeBinCode: null,
    homeBinLevelRole: null,
    homeBinCapacitySlots: null,
    homeBinSlotKind: null,
    minQty: null,
    maxQty: null,
    replenEnabled: false,
    stockBinId: null,
    stockBinCode: null,
    stockBinLevelRole: null,
    stockBinCapacitySlots: null,
    stockBinSlotKind: null,
    ...overrides,
  }
}

function freeBin(binId: number, distanceM: number | null = binId): ReplenFreeBin {
  return {
    binId,
    code: `BIN-${binId}`,
    name: null,
    levelRole: 'pick',
    capacitySlots: 240,
    slotKind: 'carton',
    distanceM,
  }
}

describe('capacityBaseUnits', () => {
  it('divides a carton bay by size_factor — the inverse of positionsRequired', () => {
    expect(capacityBaseUnits(240, 'carton', 1, null)).toBe(240)
    expect(capacityBaseUnits(240, 'carton', 2, null)).toBe(120)
  })

  it('treats a null slot_kind as carton-denominated (every legacy bin)', () => {
    expect(capacityBaseUnits(96, null, 1, null)).toBe(96)
  })

  it('multiplies a pallet bay by units-per-pallet, taken from the largest UOM', () => {
    expect(capacityBaseUnits(10, 'pallet', 1, 120)).toBe(1200)
  })

  it('refuses a pallet bay when the product has no pallet UOM', () => {
    // The whole point: an invented figure here becomes a real transfer to a real
    // rack. No units-per-pallet means no capacity, not a guess.
    expect(capacityBaseUnits(10, 'pallet', 1, null)).toBeNull()
    expect(capacityBaseUnits(10, 'pallet', 1, 1)).toBeNull()
  })

  it('refuses a bin with no capacity recorded', () => {
    expect(capacityBaseUnits(null, 'carton', 1, null)).toBeNull()
    expect(capacityBaseUnits(0, 'carton', 1, null)).toBeNull()
    expect(capacityBaseUnits(-5, 'carton', 1, null)).toBeNull()
  })
})

describe('suggestMinMax', () => {
  const input = (over: Partial<Parameters<typeof suggestMinMax>[0]> = {}) => ({
    capacitySlots: 240,
    slotKind: 'carton' as const,
    sizeFactor: 1,
    packFactor: 12,
    palletFactor: null,
    ...over,
  })

  it('fills the slot and takes a quarter of it as the minimum', () => {
    expect(suggestMinMax(input())).toEqual({ minQty: 60, maxQty: 240, basis: 'capacity' })
  })

  it('rounds both figures DOWN to whole packs', () => {
    // 250 units of capacity is 20 whole cartons of 12, not 20.83.
    const result = suggestMinMax(input({ capacitySlots: 250 }))
    expect(result.maxQty).toBe(240)
    expect(result.minQty).toBe(60)
  })

  it('never suggests a max above what fits', () => {
    const result = suggestMinMax(input({ capacitySlots: 100 }))
    expect(result.maxQty).toBeLessThanOrEqual(100)
  })

  it('applies the minimum floor when a quarter rounds away to nothing', () => {
    // 24 units = 2 cartons. A quarter is half a carton, which floors to zero;
    // the one-pack floor lifts it back to a real number.
    expect(suggestMinMax(input({ capacitySlots: 24 }))).toEqual({
      minQty: 12, maxQty: 24, basis: 'capacity',
    })
  })

  it('drops the minimum to zero on a slot that holds a single pack', () => {
    expect(suggestMinMax(input({ capacitySlots: 12 }))).toEqual({
      minQty: 0, maxQty: 12, basis: 'capacity',
    })
  })

  it('gives no suggestion, with a reason, for a pallet slot it cannot size', () => {
    const result = suggestMinMax(input({ slotKind: 'pallet', palletFactor: null }))
    expect(result.basis).toBe('none')
    expect(result.minQty).toBeNull()
    expect(result.maxQty).toBeNull()
    expect(result.reason).toMatch(/pallet/i)
  })

  it('gives no suggestion when less than one pack fits', () => {
    const result = suggestMinMax(input({ capacitySlots: 6 }))
    expect(result.basis).toBe('none')
    expect(result.reason).toMatch(/pack/i)
  })

  it('holds max > min across every policy and capacity it can size', () => {
    const policies: ReplenPolicy[] = [
      DEFAULT_REPLEN_POLICY,
      { maxFillPercent: 80, minPercentOfMax: 50, minFloorPacks: 1, roundTo: 'pack' },
      { maxFillPercent: 100, minPercentOfMax: 99, minFloorPacks: 5, roundTo: 'pack' },
      { maxFillPercent: 60, minPercentOfMax: 0, minFloorPacks: 0, roundTo: 'base' },
      { maxFillPercent: 100, minPercentOfMax: 100, minFloorPacks: 3, roundTo: 'base' },
    ]
    for (const policy of policies) {
      for (const slots of [1, 7, 12, 13, 24, 100, 240, 1000]) {
        for (const packFactor of [null, 1, 6, 12, 48]) {
          const result = suggestMinMax(input({ capacitySlots: slots, packFactor }), policy)
          if (result.basis === 'none') {
            expect(result.minQty).toBeNull()
            expect(result.maxQty).toBeNull()
            continue
          }
          // Exactly what product_home_bins' CHECKs demand.
          expect(result.minQty).toBeGreaterThanOrEqual(0)
          expect(result.maxQty).toBeGreaterThan(result.minQty as number)
          expect(result.maxQty).toBeLessThanOrEqual(slots)
        }
      }
    }
  })
})

describe('proposeHomeBins', () => {
  it('prefers the bin the stock is already in over any free bin', () => {
    const rows = [row({ productId: 1, stockBinId: 900, stockBinCode: 'STOCK-900' })]
    const proposals = proposeHomeBins(rows, [freeBin(1)])
    expect(proposals.get(1)).toMatchObject({ binId: 900, source: 'stock' })
  })

  it('never hands the same free bin to two products', () => {
    const rows = [
      row({ productId: 1, sku: 'A', demandQty: 100 }),
      row({ productId: 2, sku: 'B', demandQty: 90 }),
      row({ productId: 3, sku: 'C', demandQty: 80 }),
    ]
    const proposals = proposeHomeBins(rows, [freeBin(10), freeBin(11), freeBin(12)])
    const assigned = [...proposals.values()].map((p) => p.binId)
    expect(assigned).toHaveLength(3)
    expect(new Set(assigned).size).toBe(3)
  })

  it('gives the nearest bin to the fastest mover, whatever order rows arrive in', () => {
    const rows = [
      row({ productId: 1, sku: 'SLOW', demandQty: 5 }),
      row({ productId: 2, sku: 'FAST', demandQty: 500 }),
    ]
    const proposals = proposeHomeBins(rows, [freeBin(10, 3), freeBin(11, 40)])
    expect(proposals.get(2)?.binId).toBe(10)
    expect(proposals.get(1)?.binId).toBe(11)
  })

  it('leaves rows that already have a home bin alone, and never re-offers it', () => {
    const rows = [
      row({ productId: 1, homeBinId: 10 }),
      row({ productId: 2 }),
    ]
    const proposals = proposeHomeBins(rows, [freeBin(10), freeBin(11)])
    expect(proposals.has(1)).toBe(false)
    expect(proposals.get(2)?.binId).toBe(11)
  })

  it('proposes nothing rather than doubling up when the free bins run out', () => {
    const rows = [row({ productId: 1, sku: 'A' }), row({ productId: 2, sku: 'B' })]
    const proposals = proposeHomeBins(rows, [freeBin(10)])
    expect(proposals.size).toBe(1)
  })

  it('does not steal a stock bin that another row already calls home', () => {
    const rows = [
      row({ productId: 1, homeBinId: 900 }),
      row({ productId: 2, stockBinId: 900, stockBinCode: 'SHARED' }),
    ]
    const proposals = proposeHomeBins(rows, [freeBin(11)])
    expect(proposals.get(2)).toMatchObject({ binId: 11, source: 'free' })
  })
})

describe('validateReplenRow', () => {
  const base = {
    binId: 5, binInWarehouse: true, binIsPickZone: true,
    minQty: 10, maxQty: 100, arming: false,
  }

  it('accepts a well-formed row', () => {
    expect(validateReplenRow(base).ok).toBe(true)
  })

  it('accepts a row with neither figure when it is not being armed', () => {
    expect(validateReplenRow({ ...base, minQty: null, maxQty: null }).ok).toBe(true)
  })

  it('refuses a row with no bin', () => {
    expect(validateReplenRow({ ...base, binId: null }).ok).toBe(false)
  })

  it('refuses a bin outside the warehouse', () => {
    expect(validateReplenRow({ ...base, binInWarehouse: false }).ok).toBe(false)
  })

  it('refuses half a pair', () => {
    expect(validateReplenRow({ ...base, maxQty: null }).ok).toBe(false)
    expect(validateReplenRow({ ...base, minQty: null }).ok).toBe(false)
  })

  it('refuses a max at or below the min, matching the table CHECK', () => {
    expect(validateReplenRow({ ...base, minQty: 100, maxQty: 100 }).ok).toBe(false)
    expect(validateReplenRow({ ...base, minQty: 101, maxQty: 100 }).ok).toBe(false)
  })

  it('refuses a negative minimum', () => {
    expect(validateReplenRow({ ...base, minQty: -1 }).ok).toBe(false)
  })

  it('refuses arming without figures, and arming a bin that is not a pick zone', () => {
    expect(validateReplenRow({ ...base, arming: true, minQty: null, maxQty: null }).ok).toBe(false)
    const verdict = validateReplenRow({ ...base, arming: true, binIsPickZone: false })
    expect(verdict.ok).toBe(false)
    expect(verdict.reason).toMatch(/pick.zone/i)
  })

  it('accepts a non-pick-zone bin when nothing is being armed', () => {
    // Naming a home bin is putaway configuration; only replenishment needs a
    // pick zone. Refusing here would block the commoner use of the column.
    expect(validateReplenRow({ ...base, binIsPickZone: false, arming: false }).ok).toBe(true)
  })
})

describe('draft entry (browser side)', () => {
  it('treats blank as untouched and 0 as a real number', () => {
    expect(parseQtyEntry('')).toBeNull()
    expect(parseQtyEntry('   ')).toBeNull()
    expect(parseQtyEntry('0')).toBe(0)
  })

  it('marks unusable text invalid rather than silently empty', () => {
    expect(parseQtyEntry('abc')).toBeUndefined()
    expect(parseQtyEntry('-4')).toBeUndefined()
    expect(parseQtyEntry('1e3')).toBeUndefined()
  })

  it('converts typed packs into the base units the column stores', () => {
    const r = row({ packFactor: 12 })
    const figures = draftFigures(r, { binId: 1, minText: '2', maxText: '10' })
    expect(figures).toMatchObject({ minQty: 24, maxQty: 120, invalid: false })
  })

  it('types base units for a product with no pack UOM', () => {
    const r = row({ packFactor: null })
    expect(draftFigures(r, { binId: 1, minText: '30', maxText: '180' })).toMatchObject({
      minQty: 30, maxQty: 180,
    })
  })

  it('round-trips a stored figure back into the entry box', () => {
    const r = row({ packFactor: 12, minQty: 24, maxQty: 120, homeBinId: 7 })
    const draft = initialDraft(r)
    expect(draft).toEqual({ binId: 7, minText: '2', maxText: '10' })
    expect(draftFigures(r, draft)).toMatchObject({ minQty: 24, maxQty: 120 })
  })

  it('keeps a legacy figure that does not divide into whole packs', () => {
    expect(formatEntry(25, row({ packFactor: 12 }))).toBe('2.083')
  })

  it('reports an unchanged draft as clean, so nothing pointless is sent', () => {
    const r = row({ packFactor: 12, minQty: 24, maxQty: 120, homeBinId: 7 })
    expect(isDraftDirty(r, initialDraft(r))).toBe(false)
    expect(isDraftDirty(r, { binId: 7, minText: '3', maxText: '10' })).toBe(true)
  })

  it('an invalid draft is never dirty — it cannot be sent anywhere', () => {
    const r = row({ packFactor: 12 })
    expect(isDraftDirty(r, { binId: 1, minText: 'oops', maxText: '10' })).toBe(false)
  })
})

describe('arming', () => {
  it('leaves an armed row armed on a numbers-only apply', () => {
    expect(willBeArmed(row({ replenEnabled: true }), 'leave')).toBe(true)
    expect(willBeArmed(row({ replenEnabled: false }), 'leave')).toBe(false)
    expect(willBeArmed(row({ replenEnabled: false }), 'arm')).toBe(true)
    expect(willBeArmed(row({ replenEnabled: true }), 'disarm')).toBe(false)
  })

  it('still enforces the pick-zone rule when an armed row is merely edited', () => {
    // The case a naive `arming: false` misses: nobody is arming anything, but
    // the row stays armed, so its bin still has to be a pick zone.
    const r = row({ replenEnabled: true, packFactor: 12 })
    const verdict = draftVerdict(r, { binId: 3, minText: '2', maxText: '10' }, {
      warehouseBinIds: new Set([3]),
      pickZoneBinIds: new Set<number>(),
      action: 'leave',
    })
    expect(verdict.ok).toBe(false)
    expect(verdict.reason).toMatch(/pick.zone/i)
  })

  it('lets the same edit through once the row is being disarmed', () => {
    const r = row({ replenEnabled: true, packFactor: 12 })
    const verdict = draftVerdict(r, { binId: 3, minText: '2', maxText: '10' }, {
      warehouseBinIds: new Set([3]),
      pickZoneBinIds: new Set<number>(),
      action: 'disarm',
    })
    expect(verdict.ok).toBe(true)
  })
})
