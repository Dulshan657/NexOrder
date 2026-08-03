import { describe, expect, it } from 'vitest'
import { applyReplenCsv } from '../../components/inventory/replen/replenCsv'
import type { ReplenConfigRow } from '../../lib/replenPolicy'

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
    homeBinId: 5,
    homeBinCode: 'BIN-5',
    homeBinLevelRole: 'pick',
    homeBinCapacitySlots: 240,
    homeBinSlotKind: 'carton',
    minQty: 24,
    maxQty: 120,
    replenEnabled: false,
    stockBinId: null,
    stockBinCode: null,
    stockBinLevelRole: null,
    stockBinCapacitySlots: null,
    stockBinSlotKind: null,
    ...overrides,
  }
}

const BINS = new Map([['bin-5', 5], ['bin-9', 9]])

const csv = (body: string) =>
  `sku,product,bin_code,min_packs,max_packs,pack_units,min_base,max_base,replenishing\n${body}`

describe('applyReplenCsv', () => {
  it('reads packs into the draft', () => {
    const result = applyReplenCsv(csv('SKU-1,Product 1,BIN-5,3,15,12,36,180,no'), [row()], {}, BINS)
    expect(result.matched).toBe(1)
    expect(result.drafts[1]).toEqual({ binId: 5, minText: '3', maxText: '15' })
    expect(result.problems).toHaveLength(0)
  })

  it('leaves a blank cell exactly as it was — a partial file never wipes a column', () => {
    const result = applyReplenCsv(csv('SKU-1,Product 1,,,,12,,,no'), [row()], {}, BINS)
    // The stored 24/120 base is 2/10 packs, and nothing in the file changed it.
    expect(result.drafts[1]).toEqual({ binId: 5, minText: '2', maxText: '10' })
  })

  it('treats a typed 0 as a real zero, not as blank', () => {
    const result = applyReplenCsv(csv('SKU-1,Product 1,BIN-5,0,10,12,0,120,no'), [row()], {}, BINS)
    expect(result.drafts[1].minText).toBe('0')
  })

  it('moves the home bin when the code resolves', () => {
    const result = applyReplenCsv(csv('SKU-1,Product 1,BIN-9,1,5,12,12,60,no'), [row()], {}, BINS)
    expect(result.drafts[1].binId).toBe(9)
  })

  it('reports an unknown bin and keeps the old one rather than silently dropping it', () => {
    const result = applyReplenCsv(csv('SKU-1,Product 1,NOPE-1,1,5,12,12,60,no'), [row()], {}, BINS)
    expect(result.drafts[1].binId).toBe(5)
    expect(result.problems[0]).toMatch(/NOPE-1/)
  })

  it('reports a SKU that is not in the grid', () => {
    const result = applyReplenCsv(csv('GHOST,Ghost,BIN-5,1,5,12,12,60,no'), [row()], {}, BINS)
    expect(result.matched).toBe(0)
    expect(result.problems[0]).toMatch(/GHOST/)
  })

  it('reports unusable text and keeps the previous figure', () => {
    const result = applyReplenCsv(csv('SKU-1,Product 1,BIN-5,abc,15,12,,,no'), [row()], {}, BINS)
    expect(result.drafts[1].minText).toBe('2')
    expect(result.drafts[1].maxText).toBe('15')
    expect(result.problems[0]).toMatch(/minimum/)
  })

  it('merges onto a draft the operator has already edited, not onto the stored row', () => {
    const drafts = { 1: { binId: 9, minText: '7', maxText: '' } }
    const result = applyReplenCsv(csv('SKU-1,Product 1,,,20,12,,,no'), [row()], drafts, BINS)
    expect(result.drafts[1]).toEqual({ binId: 9, minText: '7', maxText: '20' })
  })

  it('ignores min_base / max_base — one column has to be authoritative', () => {
    const result = applyReplenCsv(csv('SKU-1,Product 1,BIN-5,1,5,12,999,999,no'), [row()], {}, BINS)
    expect(result.drafts[1]).toEqual({ binId: 5, minText: '1', maxText: '5' })
  })

  it('matches a SKU case-insensitively and skips blank lines', () => {
    const result = applyReplenCsv(csv('sku-1,Product 1,BIN-5,1,5,12,,,no\n,,,,,,,,\n'), [row()], {}, BINS)
    expect(result.matched).toBe(1)
    expect(result.problems).toHaveLength(0)
  })

  it('reads base units for a product with no pack UOM', () => {
    const base = row({ packFactor: null, minQty: 30, maxQty: 180 })
    const result = applyReplenCsv(csv('SKU-1,Product 1,BIN-5,45,200,1,,,no'), [base], {}, BINS)
    expect(result.drafts[1]).toEqual({ binId: 5, minText: '45', maxText: '200' })
  })
})
