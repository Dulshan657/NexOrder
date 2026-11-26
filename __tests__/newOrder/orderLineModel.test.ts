import { describe, expect, it } from 'vitest'

import {
  lineBaseQuantity,
  mergeLines,
  orderableUoms,
  overStockByProduct,
  toPlaceOrderItems,
  type DraftLine,
} from '../../lib/newOrder/orderLineModel'
import { mkProduct } from '../fixtures'
import type { Product, ProductUom } from '../../types'

const uom = (over: Partial<ProductUom>): ProductUom => ({
  id: 11,
  productId: 1,
  code: 'each',
  factorToBase: 1,
  isBase: true,
  price: 4,
  isOrderable: true,
  isReceivable: true,
  sortOrder: 0,
  ...over,
})

const EACH = uom({})
const CARTON = uom({ id: 12, code: 'carton', factorToBase: 12, isBase: false, price: 45, sortOrder: 1 })
const PALLET = uom({ id: 13, code: 'pallet', factorToBase: 600, isBase: false, isOrderable: false, sortOrder: 2 })

const coconut: Product = mkProduct({ id: 1, sku: 'CM-1', name: 'Coconut Milk', available: 30, uoms: [EACH, CARTON, PALLET] })
const sauce: Product = mkProduct({ id: 2, sku: 'FS-2', name: 'Fish Sauce', available: 5, uoms: undefined })

describe('orderLineModel', () => {
  it('converts a carton line to base units', () => {
    expect(lineBaseQuantity({ productId: 1, uomId: CARTON.id, quantity: 3 }, coconut)).toBe(36)
    expect(lineBaseQuantity({ productId: 1, uomId: null, quantity: 3 }, coconut)).toBe(3)
    expect(lineBaseQuantity({ productId: 1, uomId: EACH.id, quantity: 3 }, coconut)).toBe(3)
  })

  it('flags a line whose base quantity exceeds available stock', () => {
    const lines: DraftLine[] = [
      { productId: 1, uomId: CARTON.id, quantity: 3 }, // 36 > 30
      { productId: 2, uomId: null, quantity: 5 }, // 5 = 5, fine
    ]
    const over = overStockByProduct(lines, [coconut, sauce])
    expect([...over.keys()]).toEqual([1])
    expect(over.get(1)).toEqual({ requested: 36, available: 30 })
  })

  it('counts every line of one product against its stock together', () => {
    const lines: DraftLine[] = [
      { productId: 1, uomId: CARTON.id, quantity: 2 }, // 24
      { productId: 1, uomId: EACH.id, quantity: 7 }, // + 7 = 31 > 30
    ]
    expect(overStockByProduct(lines, [coconut]).get(1)).toEqual({ requested: 31, available: 30 })
  })

  it('merges a repeated product and unit into one line, keeping different units apart', () => {
    const merged = mergeLines(
      [{ productId: 1, uomId: CARTON.id, quantity: 1 }],
      [
        { productId: 1, uomId: CARTON.id, quantity: 2 },
        { productId: 1, uomId: EACH.id, quantity: 4 },
      ],
    )
    expect(merged).toEqual([
      { productId: 1, uomId: CARTON.id, quantity: 3 },
      { productId: 1, uomId: EACH.id, quantity: 4 },
    ])
  })

  it('does not mutate the lines it merges into', () => {
    const current: DraftLine[] = [{ productId: 1, uomId: null, quantity: 1 }]
    mergeLines(current, [{ productId: 1, uomId: null, quantity: 1 }])
    expect(current[0].quantity).toBe(1)
  })

  it('offers only orderable units, base first', () => {
    expect(orderableUoms(coconut).map((u) => u.code)).toEqual(['each', 'carton'])
    expect(orderableUoms(sauce)).toEqual([])
  })

  it('sends each line in its own unit, never pre-multiplied', () => {
    expect(
      toPlaceOrderItems([
        { productId: 1, uomId: CARTON.id, quantity: 3 },
        { productId: 2, uomId: null, quantity: 2 },
      ]),
    ).toEqual([
      { productId: 1, quantity: 3, uomId: CARTON.id },
      { productId: 2, quantity: 2, uomId: null },
    ])
  })
})
