import { describe, it, expect } from 'vitest'

import { validateStockRow, type StockImportContext } from '../lib/stockImportRow'

function ctx(bins?: Map<string, number>): StockImportContext {
  return {
    productIdBySku: new Map([
      ['AYM-COC-010', 101],
      ['AYM-COC-011', 102],
    ]),
    ...(bins ? { binIdByCode: bins } : {}),
  }
}

const BINS = (): Map<string, number> => new Map([
  ['MAIN-A-01-1', 5001],
  ['MAIN-A-01-2', 5002],
])

const validRec: Record<string, string> = {
  sku: 'AYM-COC-010',
  quantity: '24',
  lot_code: '',
  expiry_date: '',
  barcode: '',
}

describe('validateStockRow', () => {
  it('resolves a known SKU to its product id', () => {
    const result = validateStockRow(validRec, ctx())
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected ok result')
    expect(result.line.product_id).toBe(101)
    expect(result.sku).toBe('AYM-COC-010')
  })

  it('resolves a SKU case-insensitively as a fallback', () => {
    const result = validateStockRow({ ...validRec, sku: 'aym-coc-010' }, ctx())
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected ok result')
    expect(result.line.product_id).toBe(101)
  })

  it('rejects an unknown SKU with a friendly message', () => {
    const result = validateStockRow({ ...validRec, sku: 'NOT-A-REAL-SKU' }, ctx())
    expect(result).toEqual({
      ok: false,
      error: 'No product with SKU NOT-A-REAL-SKU — import it in the catalog first',
      sku: 'NOT-A-REAL-SKU',
    })
  })

  it('passes quantity through untouched in base units (no pack_size multiplication)', () => {
    const result = validateStockRow({ ...validRec, quantity: '24' }, ctx())
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected ok result')
    expect(result.line.quantity).toBe(24)
    expect(result.line).not.toHaveProperty('pack_size')
  })

  it('rejects a non-numeric quantity', () => {
    const result = validateStockRow({ ...validRec, quantity: '10 units' }, ctx())
    expect(result.ok).toBe(false)
  })

  it('rejects a thousands-separator quantity ("1,000")', () => {
    const result = validateStockRow({ ...validRec, quantity: '1,000' }, ctx())
    expect(result.ok).toBe(false)
  })

  it('rejects a zero quantity', () => {
    const result = validateStockRow({ ...validRec, quantity: '0' }, ctx())
    expect(result.ok).toBe(false)
  })

  it('rejects a negative quantity', () => {
    const result = validateStockRow({ ...validRec, quantity: '-5' }, ctx())
    expect(result.ok).toBe(false)
  })

  it('omits optional fields when blank', () => {
    const result = validateStockRow(validRec, ctx())
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected ok result')
    expect(result.line).not.toHaveProperty('lot_code')
    expect(result.line).not.toHaveProperty('expiry_date')
    expect(result.line).not.toHaveProperty('barcode')
  })

  it('passes through optional lot_code and barcode when present', () => {
    const result = validateStockRow({ ...validRec, lot_code: 'LOT-1', barcode: '9312345678904' }, ctx())
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected ok result')
    expect(result.line.lot_code).toBe('LOT-1')
    expect(result.line.barcode).toBe('9312345678904')
  })

  it('accepts a well-formed expiry_date', () => {
    const result = validateStockRow({ ...validRec, expiry_date: '2026-07-08' }, ctx())
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected ok result')
    expect(result.line.expiry_date).toBe('2026-07-08')
  })

  it('rejects a malformed expiry_date', () => {
    const result = validateStockRow({ ...validRec, expiry_date: '07/08/2026' }, ctx())
    expect(result.ok).toBe(false)
  })

  it('rejects an over-length lot_code', () => {
    const result = validateStockRow({ ...validRec, lot_code: 'x'.repeat(121) }, ctx())
    expect(result.ok).toBe(false)
  })
})

// bin_code is what turns a counted-by-bin stocktake into a one-pass import.
// It is optional on purpose: without it the file behaves exactly as it did
// before, receiving to the warehouse root.
describe('validateStockRow — bin_code', () => {
  it('leaves the destination unset when the column is absent', () => {
    const result = validateStockRow(validRec, ctx(BINS()))
    if (!result.ok) throw new Error('expected ok result')
    expect(result.binLocationId).toBeUndefined()
    expect(result.binCode).toBeUndefined()
  })

  it('treats a blank bin_code as "no bin", not as an error', () => {
    const result = validateStockRow({ ...validRec, bin_code: '   ' }, ctx(BINS()))
    if (!result.ok) throw new Error('expected ok result')
    expect(result.binLocationId).toBeUndefined()
  })

  it('resolves a bin code to its location id', () => {
    const result = validateStockRow({ ...validRec, bin_code: 'MAIN-A-01-2' }, ctx(BINS()))
    if (!result.ok) throw new Error('expected ok result')
    expect(result.binLocationId).toBe(5002)
    expect(result.binCode).toBe('MAIN-A-01-2')
  })

  it('resolves case-insensitively but reports the STORED spelling', () => {
    const result = validateStockRow({ ...validRec, bin_code: 'main-a-01-1' }, ctx(BINS()))
    if (!result.ok) throw new Error('expected ok result')
    expect(result.binLocationId).toBe(5001)
    expect(result.binCode).toBe('MAIN-A-01-1')
  })

  it('rejects a bin that is not in this warehouse, naming it', () => {
    const result = validateStockRow({ ...validRec, bin_code: 'OTHER-Z-99' }, ctx(BINS()))
    expect(result.ok).toBe(false)
    // `!result.ok` does NOT narrow with `strict` off — only `=== false` does.
    if (result.ok !== false) throw new Error('expected failure')
    expect(result.error).toContain('OTHER-Z-99')
  })

  it('explains itself when the warehouse has no bins at all', () => {
    const result = validateStockRow({ ...validRec, bin_code: 'MAIN-A-01-1' }, ctx())
    expect(result.ok).toBe(false)
    // `!result.ok` does NOT narrow with `strict` off — only `=== false` does.
    if (result.ok !== false) throw new Error('expected failure')
    expect(result.error).toMatch(/no addressable bins/i)
  })

  it('rejects an over-length bin_code', () => {
    const result = validateStockRow({ ...validRec, bin_code: 'x'.repeat(121) }, ctx(BINS()))
    expect(result.ok).toBe(false)
  })
})
