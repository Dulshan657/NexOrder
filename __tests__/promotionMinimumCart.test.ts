import { describe, expect, it } from 'vitest'

import { applyPromotionMinimums } from '../lib/promotionMinimumCart'
import {
  orderValueBeforePromotions,
  priceOrderLines,
  type PricedProduct,
} from '../supabase/functions/_shared/orderPricing'
import { eligibleForOrderValue } from '../supabase/functions/_shared/promotionMinimum'
import { mkHoReCa, mkPercentPromo, mkProduct, mkUser } from './fixtures'
import type { OrderItem, Product, Promotion } from '../types'

// The cart is a preview of what place-order charges, so these run the two side by side. Dev's
// product 250 has this shape: a carton unit priced at 147.60, while the carton formula gives
// 12.30 x 12 x 0.95 = 140.22. Reorders and banner offers build carton lines with no unit id.

const CARTON = { id: 5, code: 'CTN', factorToBase: 12, price: 147.6, isBase: false, isActive: true, isOrderable: true }
const product = mkProduct({ id: 250, price: 12.3, cartonSize: 12, uoms: [CARTON] as never }) as Product
const serverProduct = { ...product, uoms: [CARTON] } as unknown as PricedProduct
const hoReCa = mkHoReCa()
const currentUser = mkUser({ profileId: 'rep-uuid' })

const promoWith = (minOrderValue: number) => mkPercentPromo({ id: 'MIN', percentOff: 10, minOrderValue })

const cart = (line: Partial<OrderItem>, promotion: Promotion) =>
  applyPromotionMinimums([{ ...product, quantity: 1, price: 1, ...line } as OrderItem], [product], {
    hoReCa,
    promotions: [promotion],
    currentUser,
    cartonDiscountPercent: 5,
  }).items[0].price

const server = (line: { packSize?: number; uomId?: number }, promotion: Promotion) => {
  const aggregated = [{ productId: 250, quantity: 1, ...line }]
  const map = new Map([[250, serverProduct]])
  const user = { id: 'rep-uuid', role: 'Field Sales Rep' }
  const value = orderValueBeforePromotions(aggregated, map, hoReCa as never, user, 5)
  const eligible = eligibleForOrderValue([promotion], value) as never[]
  return priceOrderLines(aggregated, map, hoReCa as never, user, eligible, 5)[0].unitPrice
}

describe('applyPromotionMinimums', () => {
  it('a carton line with no unit id costs what the server charges, on both sides of a minimum', () => {
    for (const [minimum, expected] of [[100, 126.2], [140.22, 126.2], [145, 140.22], [200, 140.22]]) {
      const promotion = promoWith(minimum)
      expect(server({ packSize: 12 }, promotion)).toBe(expected)
      expect(cart({ packSize: 12 }, promotion)).toBe(expected)
    }
  })

  it('a line in an explicit unit costs what the server charges', () => {
    for (const [minimum, expected] of [[100, 132.84], [147.6, 132.84], [147.61, 147.6]]) {
      const promotion = promoWith(minimum)
      expect(server({ packSize: 12, uomId: 5 }, promotion)).toBe(expected)
      expect(cart({ packSize: 12, uomId: 5 }, promotion)).toBe(expected)
    }
  })

  it('a loose line costs what the server charges', () => {
    for (const [minimum, expected] of [[12.3, 11.07], [12.31, 12.3]]) {
      const promotion = promoWith(minimum)
      expect(server({}, promotion)).toBe(expected)
      expect(cart({}, promotion)).toBe(expected)
    }
  })

  it('a line whose product is gone keeps its price and counts at it', () => {
    const result = applyPromotionMinimums(
      [{ ...product, id: 999, quantity: 1, price: 300 } as OrderItem],
      [product],
      { hoReCa, promotions: [promoWith(200)], currentUser, cartonDiscountPercent: 5 },
    )
    expect(result.items[0].price).toBe(300)
    expect(result.eligiblePromotions).toHaveLength(1)
  })
})
