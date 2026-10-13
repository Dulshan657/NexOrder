import { describe, expect, it } from 'vitest'
import { mayBeShort, toShortLines, type MayBeShortLine } from '@/lib/qr/mayBeShort'
import { buildReorderPlan } from '@/lib/kitchen/reorderPlan'
import { UserRole } from '@/types'
import type { ProductUom } from '@/types'
import { mkCartItem, mkHoReCa, mkProduct, mkUser } from '../fixtures'

// "May this order be short?" -- the question a kitchen is asked at submit, before
// an approver finds out the hard way. It must agree with what the server will
// decide (stock counted in BASE units, per product, from the product's own UOM
// rows) and it must never say how much is in stock: it returns names only.

const uom = (over: Partial<ProductUom>): ProductUom => ({
  id: 0,
  productId: 1,
  code: 'jar',
  factorToBase: 1,
  isBase: true,
  price: 4,
  isOrderable: true,
  isReceivable: true,
  sortOrder: 0,
  ...over,
})

const line = (over: Partial<MayBeShortLine> = {}): MayBeShortLine => ({ productId: 1, quantity: 1, ...over })

const rice = mkProduct({ id: 1, name: 'Rice Noodles', available: 10 })
const oil = mkProduct({ id: 2, sku: 'SKU-2', name: 'Chilli Oil', available: 5 })

describe('mayBeShort', () => {
  it('names nothing for an empty order', () => {
    expect(mayBeShort([], [rice])).toEqual([])
  })

  it('names nothing when everything asked for is available', () => {
    expect(mayBeShort([line({ quantity: 3 }), line({ productId: 2, quantity: 5 })], [rice, oil])).toEqual([])
  })

  it('names a product asked for in a larger quantity than is available', () => {
    expect(mayBeShort([line({ quantity: 11 })], [rice])).toEqual(['Rice Noodles'])
  })

  it('does not call it short when the order takes exactly what is available', () => {
    expect(mayBeShort([line({ quantity: 10 })], [rice])).toEqual([])
  })

  it('ignores a product it has never heard of', () => {
    expect(mayBeShort([line({ productId: 99, quantity: 1000 })], [rice])).toEqual([])
  })

  it('adds up the lines of one product before comparing', () => {
    // 6 + 6 against 10: neither line is short alone, the order is.
    expect(mayBeShort([line({ quantity: 6 }), line({ quantity: 6 })], [rice])).toEqual(['Rice Noodles'])
  })

  it('names each short product once, in the order the order lists them', () => {
    const lines = [line({ productId: 2, quantity: 9 }), line({ quantity: 11 }), line({ productId: 2, quantity: 1 })]
    expect(mayBeShort(lines, [rice, oil])).toEqual(['Chilli Oil', 'Rice Noodles'])
  })

  it('names only the products that are short, not the whole order', () => {
    expect(mayBeShort([line({ quantity: 11 }), line({ productId: 2, quantity: 1 })], [rice, oil])).toEqual(['Rice Noodles'])
  })

  it('treats anything asked for of a product with none available as short', () => {
    expect(mayBeShort([line({ quantity: 1 })], [{ ...rice, available: 0 }])).toEqual(['Rice Noodles'])
  })

  it('treats a negative available (over-allocated) as none', () => {
    expect(mayBeShort([line({ quantity: 1 })], [{ ...rice, available: -4 }])).toEqual(['Rice Noodles'])
  })

  it('does not call a zero-quantity line short, even with nothing available', () => {
    expect(mayBeShort([line({ quantity: 0 })], [{ ...rice, available: 0 }])).toEqual([])
  })

  describe('units of measure (stock is counted in base units)', () => {
    it('counts a carton line as quantity x pack size', () => {
      // 2 cartons of 6 = 12 units against 10.
      expect(mayBeShort([line({ quantity: 2, packSize: 6 })], [rice])).toEqual(['Rice Noodles'])
      // 1 carton of 6 = 6 units against 10.
      expect(mayBeShort([line({ quantity: 1, packSize: 6 })], [rice])).toEqual([])
    })

    it('reads a missing or null pack size as single units', () => {
      expect(mayBeShort([line({ quantity: 10, packSize: null })], [rice])).toEqual([])
      expect(mayBeShort([line({ quantity: 11, packSize: undefined })], [rice])).toEqual(['Rice Noodles'])
    })

    it('takes the factor from the unit of measure by id, as the server does, over a stale pack size', () => {
      const tray = mkProduct({
        id: 1,
        name: 'Rice Noodles',
        available: 30,
        uoms: [
          uom({ id: 11, code: 'jar' }),
          uom({ id: 12, code: 'tray', factorToBase: 12, isBase: false, price: 40, sortOrder: 1 }),
        ],
      })
      // The line says pack size 1, but uom 12 is a tray of 12: 3 trays = 36 > 30.
      expect(mayBeShort([line({ quantity: 3, packSize: 1, uomId: 12 })], [tray])).toEqual(['Rice Noodles'])
      // And 2 trays = 24 <= 30.
      expect(mayBeShort([line({ quantity: 2, packSize: 1, uomId: 12 })], [tray])).toEqual([])
    })

    it('counts the base unit as one, whatever pack size the line carries', () => {
      const tray = mkProduct({
        id: 1,
        name: 'Rice Noodles',
        available: 10,
        uoms: [uom({ id: 11, code: 'jar' }), uom({ id: 12, code: 'tray', factorToBase: 12, isBase: false, sortOrder: 1 })],
      })
      expect(mayBeShort([line({ quantity: 10, packSize: 6, uomId: 11 })], [tray])).toEqual([])
    })

    it('falls back to the pack size when the unit of measure is not found', () => {
      expect(mayBeShort([line({ quantity: 2, packSize: 6, uomId: 404 })], [rice])).toEqual(['Rice Noodles'])
    })

    it('adds a carton line and a single-unit line of one product together', () => {
      // 1 carton of 6 + 5 singles = 11 > 10.
      expect(mayBeShort([line({ quantity: 1, packSize: 6 }), line({ quantity: 5 })], [rice])).toEqual(['Rice Noodles'])
    })
  })

  it('never returns a number: the answer is names only', () => {
    const answer = mayBeShort([line({ quantity: 11 })], [rice])
    expect(answer.every((n) => typeof n === 'string')).toBe(true)
  })

  it('does not mutate what it was given', () => {
    const lines = [line({ quantity: 11 })]
    const products = [rice]
    const before = JSON.stringify({ lines, products })
    mayBeShort(lines, products)
    expect(JSON.stringify({ lines, products })).toBe(before)
  })
})

describe('mayBeShort agrees with the reorder plan', () => {
  // The kitchen sees a "low" flag on a same-again line and, at submit, this
  // answer. For one line they are the same question and must give the same answer.
  const kitchen = mkUser({ id: 7, role: UserRole.QR_STAFF, hoReCaId: 10 })
  const venue = mkHoReCa({ id: 10 })

  const planSaysLow = (quantity: number, packSize: number | undefined, available: number): boolean => {
    const product = mkProduct({ id: 1, available })
    const plan = buildReorderPlan({
      order: { items: [mkCartItem(product, quantity, packSize)] },
      products: [product],
      hoReCa: venue,
      promotions: [],
      currentUser: kitchen,
      cartonDiscountPercent: 5,
    })
    return plan.included.some((l) => l.status === 'low')
  }

  it.each([
    [5, undefined, 3],
    [3, undefined, 3],
    [2, undefined, 3],
    [2, 6, 10],
    [2, 6, 12],
    [1, 6, 5],
  ])('quantity %s, pack %s, available %s', (quantity, packSize, available) => {
    const product = mkProduct({ id: 1, name: 'Rice Noodles', available })
    const names = mayBeShort([line({ quantity, packSize })], [product])
    expect(names.length > 0).toBe(planSaysLow(quantity, packSize, available))
  })
})

describe('toShortLines', () => {
  it('reads cart lines the way a held request is filed', () => {
    const cart = [
      { ...mkCartItem(rice, 3), packSize: 6, uomId: 12 },
      mkCartItem(oil, 2),
    ]
    expect(toShortLines(cart)).toEqual([
      { productId: 1, quantity: 3, packSize: 6, uomId: 12 },
      { productId: 2, quantity: 2, packSize: null, uomId: null },
    ])
  })

  it('does not mutate the cart', () => {
    const cart = [mkCartItem(rice, 3)]
    const before = JSON.stringify(cart)
    toShortLines(cart)
    expect(JSON.stringify(cart)).toBe(before)
  })
})
