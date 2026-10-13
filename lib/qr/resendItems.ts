// "Edit and resend": a kitchen order the approver turned down, as cart lines again.
//
// A held order stores only what place-order takes (productId, quantity, packSize,
// uomId) plus a display-only name snapshot -- no prices, because it is priced at
// approval. To edit it the cart needs full product lines, so each is resolved
// against TODAY's catalogue and priced the way the Shop prices the same pick
// (`priceReorderLine`, shared with the Reorder tab and "Order same again"), which
// keeps the cart from disagreeing with the rest of the app.
//
// What is LEFT OUT, and counted so the person can be told:
//   - a product that is gone from the catalogue, or inactive;
//   - a carton line whose pack size no longer exists (reading "2 cartons" as "2
//     units" would be a quietly different order).
// What is deliberately KEPT: a product that is out of stock. The rejection may have
// been about something else entirely, and the short-stock warning at send time is
// where "may be short" is said, by name and without a count.
//
// Pure: no React, no Supabase.

import type { HoReCa, OrderItem, Product, Promotion, QrOrderRequest, User } from '@/types'
import type { ReorderDetails } from '@/context/OrderContext'
import { priceReorderLine } from '@/lib/reorderLinePrice'

export interface ResendContext {
  /** The catalogue as the signed-in login sees it. */
  products: readonly Product[]
  /** The venue, for its own prices. May still be loading. */
  hoReCa: HoReCa | null | undefined
  promotions: readonly Promotion[]
  currentUser: User | null
  cartonDiscountPercent: number
}

export interface ResendLines {
  /** Cart lines, in the order they were requested. */
  items: OrderItem[]
  /** How many lines could not be carried over. */
  skipped: number
}

export function qrRequestToCartItems(request: Pick<QrOrderRequest, 'items'>, ctx: ResendContext): ResendLines {
  const byId = new Map<number, Product>(ctx.products.map((p): [number, Product] => [p.id, p]))
  const pricing = {
    hoReCa: ctx.hoReCa ?? null,
    promotions: ctx.promotions,
    currentUser: ctx.currentUser,
    cartonDiscountPercent: ctx.cartonDiscountPercent,
  }

  const items: OrderItem[] = []
  let skipped = 0

  for (const line of request.items) {
    const product = byId.get(line.productId)
    if (!product || product.isActive === false) {
      skipped += 1
      continue
    }

    const source: OrderItem = {
      ...product,
      quantity: line.quantity,
      packSize: line.packSize ?? undefined,
      uomId: line.uomId ?? undefined,
    }
    const priced = priceReorderLine(source, product, pricing)
    if (priced.ok === false) {
      skipped += 1
      continue
    }

    items.push({
      ...product,
      quantity: line.quantity,
      price: priced.unitPrice,
      packSize: priced.packSize,
      unit: priced.unit,
      uomId: priced.uomId,
    })
  }

  return { items, skipped }
}

/** Local calendar date as `YYYY-MM-DD`, the format a cart's delivery date is held in. */
function localIsoDate(now: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

/**
 * The notes and delivery choices the order was sent with, for the cart to take over.
 * Empty strings -- never null -- for what it did not have, because the cart OVERWRITES
 * with these: that is what clears a note or date left behind by an abandoned cart.
 *
 * A delivery date that has since passed is dropped. The server refuses a date before
 * today, and the person would be told so over a field they never just chose; left
 * empty, the cart simply asks again. (Delivery ADDRESS is not carried: the cart has
 * no address of its own to set.)
 */
export function qrRequestToCartDetails(
  request: Pick<QrOrderRequest, 'notes' | 'deliveryDate' | 'deliveryTimeSlot'>,
  now: Date = new Date(),
): ReorderDetails {
  const date = request.deliveryDate ? request.deliveryDate.slice(0, 10) : ''
  return {
    notes: request.notes ?? '',
    deliveryDate: date >= localIsoDate(now) ? date : '',
    deliveryTimeSlot: request.deliveryTimeSlot ?? '',
  }
}

/** "1 item is no longer available" / "3 items are no longer available". */
export function unavailableItemsMessage(count: number): string {
  return count === 1 ? '1 item is no longer available' : `${count} items are no longer available`
}
