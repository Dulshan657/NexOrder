import { describe, expect, it } from 'vitest'

import {
  QR_MAX_DELIVERY_DAYS_AHEAD,
  QR_MAX_LINES,
  QR_MAX_LINE_QUANTITY,
  deliveryDateProblem,
  findInvalidRequestLines,
  firstInactiveProduct,
  linesDiffer,
  parseStoredLines,
  toOrderLines,
  withSnapshot,
  type QrRequestLine,
} from '../supabase/functions/_shared/qrRequestItems'

const line = (over: Partial<QrRequestLine> = {}): QrRequestLine => ({
  productId: 1,
  quantity: 2,
  packSize: null,
  uomId: null,
  ...over,
})

describe('toOrderLines', () => {
  it('strips the display snapshot so a name can never reach pricing', () => {
    const out = toOrderLines([line({ productName: 'Fresh Cream 1L', productSku: 'FC-1' })])
    expect(out).toEqual([{ productId: 1, quantity: 2, packSize: null, uomId: null }])
    expect(Object.keys(out[0]).sort()).toEqual(['packSize', 'productId', 'quantity', 'uomId'])
  })

  it('does not mutate its input', () => {
    const input = [line({ productName: 'X' })]
    toOrderLines(input)
    expect(input[0].productName).toBe('X')
  })
})

describe('findInvalidRequestLines', () => {
  it('accepts a normal cart', () => {
    expect(findInvalidRequestLines([line(), line({ productId: 2, uomId: 7, packSize: 12 })])).toBeNull()
  })

  it('refuses an empty order', () => {
    expect(findInvalidRequestLines([])).toMatch(/at least one/)
  })

  it('reuses place-order\'s wording for malformed lines', () => {
    expect(findInvalidRequestLines([line({ quantity: 0 })])).toMatch(/positive integer quantity/)
    expect(findInvalidRequestLines([line({ quantity: 1.5 })])).toMatch(/positive integer quantity/)
    expect(findInvalidRequestLines([line({ productId: '3' as unknown as number })])).toMatch(/integer productId/)
    expect(findInvalidRequestLines([line({ uomId: -1 })])).toMatch(/uomId/)
  })

  it('bounds the number of lines and the quantity on one line', () => {
    const many = Array.from({ length: QR_MAX_LINES + 1 }, (_, i) => line({ productId: i + 1 }))
    expect(findInvalidRequestLines(many)).toMatch(/at most/)
    expect(findInvalidRequestLines(many.slice(0, QR_MAX_LINES))).toBeNull()
    expect(findInvalidRequestLines([line({ quantity: QR_MAX_LINE_QUANTITY })])).toBeNull()
    expect(findInvalidRequestLines([line({ quantity: QR_MAX_LINE_QUANTITY + 1 })])).toMatch(/at most/)
  })

  it('refuses a non-positive packSize', () => {
    expect(findInvalidRequestLines([line({ packSize: 0 })])).toMatch(/packSize/)
    expect(findInvalidRequestLines([line({ packSize: -4 })])).toMatch(/packSize/)
    expect(findInvalidRequestLines([line({ packSize: 6 })])).toBeNull()
  })
})

describe('parseStoredLines', () => {
  it('reads back what was stored, snapshot included', () => {
    const stored = [{ productId: 4, quantity: 3, packSize: 6, uomId: 9, productName: 'Butter', productSku: 'B-1' }]
    expect(parseStoredLines(stored)).toEqual(stored)
  })

  it('defaults a missing packSize / uomId to null', () => {
    expect(parseStoredLines([{ productId: 4, quantity: 3 }])).toEqual([
      { productId: 4, quantity: 3, packSize: null, uomId: null },
    ])
  })

  it('returns null for anything that is not a usable cart', () => {
    expect(parseStoredLines(null)).toBeNull()
    expect(parseStoredLines({})).toBeNull()
    expect(parseStoredLines([])).toBeNull()
    expect(parseStoredLines([null])).toBeNull()
    expect(parseStoredLines(['x'])).toBeNull()
    expect(parseStoredLines([{ productId: 'a', quantity: 1 }])).toBeNull()
    expect(parseStoredLines([{ productId: 1, quantity: 0 }])).toBeNull()
    expect(parseStoredLines([{ productId: 1, quantity: 2.5 }])).toBeNull()
  })

  it('ignores a snapshot field of the wrong type instead of trusting it', () => {
    expect(parseStoredLines([{ productId: 1, quantity: 1, productName: 42 }])).toEqual([
      { productId: 1, quantity: 1, packSize: null, uomId: null },
    ])
  })
})

describe('linesDiffer', () => {
  it('is false for identical carts', () => {
    expect(linesDiffer([line()], [line()])).toBe(false)
  })

  it('ignores line order', () => {
    const a = [line({ productId: 1 }), line({ productId: 2, quantity: 5 })]
    const b = [line({ productId: 2, quantity: 5 }), line({ productId: 1 })]
    expect(linesDiffer(a, b)).toBe(false)
  })

  it('ignores the display snapshot', () => {
    expect(linesDiffer([line({ productName: 'Old name' })], [line({ productName: 'New name' })])).toBe(false)
  })

  it('treats splitting a line into two that add up as no edit', () => {
    expect(linesDiffer([line({ quantity: 6 })], [line({ quantity: 4 }), line({ quantity: 2 })])).toBe(false)
  })

  it('detects a changed quantity, an added line, a removed line', () => {
    expect(linesDiffer([line({ quantity: 2 })], [line({ quantity: 3 })])).toBe(true)
    expect(linesDiffer([line()], [line(), line({ productId: 2 })])).toBe(true)
    expect(linesDiffer([line(), line({ productId: 2 })], [line()])).toBe(true)
  })

  it('distinguishes the same product in a different unit of measure or pack', () => {
    expect(linesDiffer([line({ uomId: 1 })], [line({ uomId: 2 })])).toBe(true)
    expect(linesDiffer([line({ packSize: 6 })], [line({ packSize: 12 })])).toBe(true)
    expect(linesDiffer([line({ packSize: null })], [line({ packSize: 6 })])).toBe(true)
  })

  it('detects a swap of one product for another with the same quantity', () => {
    expect(linesDiffer([line({ productId: 1 })], [line({ productId: 2 })])).toBe(true)
  })
})

describe('withSnapshot', () => {
  const priced = [
    { productId: 1, productName: 'Cream', productSku: 'C-1' },
    { productId: 2, productName: 'Butter', productSku: 'B-1' },
  ]

  it('attaches a name and SKU to every known product', () => {
    const out = withSnapshot([line({ productId: 1 }), line({ productId: 2, uomId: 5 })], priced)
    expect(out[0]).toMatchObject({ productId: 1, productName: 'Cream', productSku: 'C-1' })
    expect(out[1]).toMatchObject({ productId: 2, uomId: 5, productName: 'Butter', productSku: 'B-1' })
  })

  it('leaves an unknown product without a snapshot rather than inventing one', () => {
    const [out] = withSnapshot([line({ productId: 99 })], priced)
    expect(out.productName).toBeUndefined()
    expect(out.productSku).toBeUndefined()
  })

  it('does not mutate its input', () => {
    const input = [line({ productId: 1 })]
    withSnapshot(input, priced)
    expect(input[0].productName).toBeUndefined()
  })
})

describe('deliveryDateProblem', () => {
  const NOW = new Date('2026-10-12T09:30:00.000Z')

  it('accepts today, tomorrow and the last allowed day', () => {
    expect(deliveryDateProblem('2026-10-12', NOW)).toBeNull()
    expect(deliveryDateProblem('2026-10-13', NOW)).toBeNull()
    expect(deliveryDateProblem('2027-01-10', NOW)).toBeNull() // today + 90 days
  })

  it('is exactly 90 days, not 89 or 91', () => {
    expect(QR_MAX_DELIVERY_DAYS_AHEAD).toBe(90)
    expect(deliveryDateProblem('2027-01-11', NOW)).toMatch(/within the next 90 days/)
  })

  it('refuses yesterday and anything earlier', () => {
    expect(deliveryDateProblem('2026-10-11', NOW)).toMatch(/past/)
    expect(deliveryDateProblem('2020-01-01', NOW)).toMatch(/past/)
  })

  it('refuses a date years out', () => {
    expect(deliveryDateProblem('2099-12-31', NOW)).toMatch(/within the next 90 days/)
  })

  it('treats no date as fine -- it is optional', () => {
    expect(deliveryDateProblem(null, NOW)).toBeNull()
    expect(deliveryDateProblem(undefined, NOW)).toBeNull()
    expect(deliveryDateProblem('', NOW)).toBeNull()
  })

  it('judges by the UTC calendar date, even a minute before midnight', () => {
    const lateEvening = new Date('2026-10-12T23:59:59.000Z')
    expect(deliveryDateProblem('2026-10-12', lateEvening)).toBeNull()
    expect(deliveryDateProblem('2026-10-11', lateEvening)).toMatch(/past/)
  })
})

describe('firstInactiveProduct', () => {
  const rows = [
    { id: 1, name: 'Fresh Cream 1L', is_active: true },
    { id: 2, name: ' Retired Jar ', is_active: false },
    { id: 3, name: null, is_active: false },
  ]

  it('finds a retired product among the requested lines, by name', () => {
    expect(firstInactiveProduct(rows, [line({ productId: 1 }), line({ productId: 2 })])).toEqual({
      id: 2,
      name: 'Retired Jar',
    })
  })

  it('falls back to the id when the row has no name', () => {
    expect(firstInactiveProduct(rows, [line({ productId: 3 })])).toEqual({ id: 3, name: 'Product 3' })
  })

  it('is null when every requested product is active', () => {
    expect(firstInactiveProduct(rows, [line({ productId: 1 })])).toBeNull()
  })

  it('ignores a product with no row -- that is PRODUCT_NOT_FOUND from the pricing dry run', () => {
    expect(firstInactiveProduct(rows, [line({ productId: 999 })])).toBeNull()
  })

  it('ignores an inactive product that was not asked for', () => {
    expect(firstInactiveProduct(rows, [line({ productId: 1 })])).toBeNull()
  })
})
