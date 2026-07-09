import { describe, it, expect } from 'vitest'

import { validateStockRow, type StockImportContext } from '../lib/stockImportRow'

function ctx(): StockImportContext {
  return {
    productIdBySku: new Map([
      ['AYM-COC-010', 101],
      ['AYM-COC-011', 102],
    ]),
  }
}

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
