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

const cart = (line: Partial<OrderItem>, promotion: Promotion, onProduct = product, venue = hoReCa) =>
  applyPromotionMinimums([{ ...onProduct, quantity: 1, price: 1, ...line } as OrderItem], [onProduct], {
    hoReCa: venue,
    promotions: [promotion],
    currentUser,
    cartonDiscountPercent: 5,
  }).items[0].price

const server = (
  line: { packSize?: number; uomId?: number; quantity?: number },
  promotion: Promotion,
  onProduct: PricedProduct = serverProduct,
  venue = hoReCa,
) => {
  const aggregated = [{ productId: onProduct.id, quantity: 1, ...line }]
  const map = new Map([[onProduct.id, onProduct]])
  const user = { id: 'rep-uuid', role: 'Field Sales Rep' }
  const value = orderValueBeforePromotions(aggregated, map, venue as never, user, 5)
  const eligible = eligibleForOrderValue([promotion], value) as never[]
  return priceOrderLines(aggregated, map, venue as never, user, eligible, 5)[0].unitPrice
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

  it('a venue with a percent discount is measured the same on both sides', () => {
    // The gate's case on dev: $3.90 at Bunnings' 5%, 27 of them, a $100 minimum and 10% stacking.
    // Measured unrounded the cart read $89.91, and the server charged $99.90.
    const bunnings = mkHoReCa({ id: 4, discountPercent: 5 })
    const stacking = (minOrderValue: number) =>
      mkPercentPromo({ id: 'MIN', percentOff: 10, stackWithHoReCaPricing: true, minOrderValue })
    const coconut = mkProduct({ id: 2, price: 3.9 }) as Product
    const onServer = { ...coconut, uoms: [] } as unknown as PricedProduct

    const atBunnings = stacking(100)
    expect(server({ quantity: 27 }, atBunnings, onServer, bunnings)).toBe(3.7)
    expect(cart({ quantity: 27 }, atBunnings, coconut, bunnings)).toBe(3.7)

    // A small sweep, since each of these flipped somewhere on dev's catalogue.
    for (const price of [3.9, 5.55, 7.95, 4.1, 12.3]) {
      for (const discountPercent of [5, 8, 10]) {
        for (const quantity of [3, 27, 40]) {
          const venue = mkHoReCa({ discountPercent })
          const item = mkProduct({ id: 7, price }) as Product
          const itemOnServer = { ...item, uoms: [] } as unknown as PricedProduct
          for (const minimum of [50, 100, 200]) {
            const promotion = stacking(minimum)
            expect(cart({ quantity }, promotion, item, venue)).toBe(server({ quantity }, promotion, itemOnServer, venue))
          }
        }
      }
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
