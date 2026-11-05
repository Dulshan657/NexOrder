// The cart under promotions that have a minimum order value.
//
// A cart line's price is set when it is added, but whether such a promotion applies depends on the
// whole cart, so lines must be repriced as the cart changes or the cart would disagree with what
// place-order charges. Nothing is repriced unless a live promotion has a minimum: a cart holding
// none behaves exactly as it did.
//
// The price is chosen the way the server chooses it (`normalizeOrderItems` and `priceOrderLines` in
// `_shared/orderPricing.ts`): an explicit non-base unit is priced from that unit, and anything else
// from the unit price, with the carton formula when it has a pack. `priceReorderLine` is NOT used
// here: it finds a line with no unit id by its pack factor, which the server does not do, and the
// two then differ wherever a carton unit's own price differs from the formula.

import type { HoReCa, OrderItem, Product, Promotion, User } from '@/types'
import { cartonPrice, isPromotionActive, resolvePromotionPrice, resolveUomLinePrice } from '@/pricing'
import { eligibleForOrderValue } from '@/supabase/functions/_shared/promotionMinimum'

export interface CartPricingContext {
  hoReCa: HoReCa | null
  promotions: Promotion[]
  currentUser: User | null
  cartonDiscountPercent: number
}

export interface CartUnderMinimums {
  items: OrderItem[]
  /** The promotions this cart qualifies for. Everything else about a promotion still applies. */
  eligiblePromotions: Promotion[]
}

function priceAsServer(item: OrderItem, product: Product, ctx: CartPricingContext, promotions: Promotion[]): number {
  const uom = item.uomId != null ? product.uoms?.find((u) => u.id === item.uomId) : undefined
  if (uom && !uom.isBase) return resolveUomLinePrice(product, uom, ctx.hoReCa, ctx.currentUser, promotions)

  const perUnit = resolvePromotionPrice(product, ctx.hoReCa, ctx.currentUser, promotions).finalPrice
  const packSize = uom ? null : item.packSize
  return packSize != null && packSize > 1 ? cartonPrice(perUnit, packSize, ctx.cartonDiscountPercent) : perUnit
}

export function applyPromotionMinimums(
  items: OrderItem[],
  products: readonly Product[],
  ctx: CartPricingContext,
): CartUnderMinimums {
  const now = new Date()
  const hasMinimum = ctx.promotions.some((p) => (p.minOrderValue ?? 0) > 0 && isPromotionActive(p, now))
  if (!hasMinimum) return { items, eligiblePromotions: ctx.promotions }

  const byId = new Map(products.map((p): [number, Product] => [p.id, p]))
  // A line whose product is gone keeps the price it has. The server will refuse it.
  const priceWith = (item: OrderItem, promotions: Promotion[]): number => {
    const product = byId.get(item.id)
    return product ? priceAsServer(item, product, ctx, promotions) : item.price
  }

  const orderValue = items.reduce((sum, item) => sum + priceWith(item, []) * item.quantity, 0)
  const eligiblePromotions = eligibleForOrderValue(ctx.promotions, orderValue)
  return {
    items: items.map((item) => ({ ...item, price: priceWith(item, eligiblePromotions) })),
    eligiblePromotions,
  }
}
