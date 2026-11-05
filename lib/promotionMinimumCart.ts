// The cart under promotions that have a minimum order value.
//
// A cart line's price is set when it is added, but whether such a promotion applies depends on the
// whole cart, so lines must be repriced as the cart changes or the cart would disagree with what
// place-order charges. Nothing is repriced unless a live promotion has a minimum: a cart holding
// none behaves exactly as it did.

import type { HoReCa, OrderItem, Product, Promotion, User } from '@/types'
import { isPromotionActive } from '@/pricing'
import { priceReorderLine } from '@/lib/reorderLinePrice'
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

export function applyPromotionMinimums(
  items: OrderItem[],
  products: readonly Product[],
  ctx: CartPricingContext,
): CartUnderMinimums {
  const now = new Date()
  const hasMinimum = ctx.promotions.some((p) => (p.minOrderValue ?? 0) > 0 && isPromotionActive(p, now))
  if (!hasMinimum) return { items, eligiblePromotions: ctx.promotions }

  const byId = new Map(products.map((p): [number, Product] => [p.id, p]))
  // Priced in the line's own unit. A line that cannot be priced keeps the price it has.
  const priceWith = (item: OrderItem, promotions: Promotion[]): number => {
    const product = byId.get(item.id)
    if (!product) return item.price
    const priced = priceReorderLine(item, product, { ...ctx, promotions })
    return priced.ok === true ? priced.unitPrice : item.price
  }

  const orderValue = items.reduce((sum, item) => sum + priceWith(item, []) * item.quantity, 0)
  const eligiblePromotions = eligibleForOrderValue(ctx.promotions, orderValue)
  return {
    items: items.map((item) => ({ ...item, price: priceWith(item, eligiblePromotions) })),
    eligiblePromotions,
  }
}
