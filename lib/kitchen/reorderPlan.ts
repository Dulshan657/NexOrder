// "Order same again": turn a past order into what you could order TODAY.
//
// A kitchen reorders by pressing one button, so the screen that button opens has
// to be honest about what has changed since the last time: a product that is no
// longer sold, one that is out of stock, a price that moved, a carton that now
// has a different size. This resolves every line of a past order against the
// CURRENT catalogue and returns both the cart lines to submit and the reason for
// each line it will not send.
//
// Pure: no React, no Supabase, no clock beyond what `pricing.ts` already reads.
//
// ── PRICING ─────────────────────────────────────────────────────────────────
// Each line is priced the way the Shop prices the same pick, so "same again" and
// "add it from the catalogue" cannot disagree:
//   - the line's own unit of measure (`resolveUomLinePrice`, mig 00067), found by
//     id, else by pack factor for a line saved before UOM ids existed, else the
//     base unit;
//   - which includes the venue's own price and any live promotion
//     (`resolvePromotionPrice`), NOT the bare `resolveHoReCaPrice` -- that one
//     knows nothing about promotions and previews list price on a tenant that
//     has any (the same mistake NewOrderView's grid had to fix).
// That per-line price lives in `lib/reorderLinePrice.ts`, shared with the Shop's
// Reorder tab so the two cannot drift again.
// The total is an ESTIMATE and is labelled so wherever it is shown: the server
// reprices at approval/placement and is the authority on carton rounding, BOGO
// free lines and cart-level discounts.
//
// ── STOCK ───────────────────────────────────────────────────────────────────
// A line is EXCLUDED when the product is gone, inactive or has nothing
// available (`available`, the reservable cache -- not `inventory`, which is
// physical stock). A line asking for more than is available is KEPT and flagged
// 'low': the person deciding (an approver, or the server at placement) can see a
// shortage better than a button that silently trimmed the quantity.
//
// A kitchen (QR Staff) must never be shown a stock figure, so a caller can ask
// for `hideStockCounts` and the 'low' reason then names no number. The test of
// whether a line is short is the same either way, and the same one the server
// applies: base units are `lineBaseUnits` (`_shared/pricing.ts`), not a local
// copy of the multiplication.

import type { HoReCa, Order, OrderItem, Product, Promotion, User } from '@/types'
import { applyCartPromotions } from '@/services/promotionService'
import { priceReorderLine } from '@/lib/reorderLinePrice'
import { lineBaseUnits } from '@/supabase/functions/_shared/pricing'

export type ReorderLineStatus = 'ok' | 'low' | 'unavailable'

/** What a 'low' line says when the reader must not be shown a stock count. */
export const MAY_BE_SHORT_REASON = 'May be short — your manager will adjust it'

export interface ReorderLine {
  /** Stable React key: product + pack + uom, as the cart dedups on. */
  key: string
  /** The line as it was originally ordered. */
  source: OrderItem
  quantity: number
  /** "carton of 12", "jar": what one quantity of this line is. */
  unitLabel: string
  /** Current price of ONE ordered unit (0 for an excluded line). */
  unitPrice: number
  /** unitPrice x quantity, to the cent (0 for an excluded line). */
  lineTotal: number
  status: ReorderLineStatus
  /** Why the line is excluded or flagged. Absent for 'ok'. */
  reason?: string
  /** The cart line to submit. Null when the line is excluded. */
  item: OrderItem | null
}

export interface ReorderPlan {
  lines: ReorderLine[]
  /** Lines that will be sent ('ok' and 'low'). */
  included: ReorderLine[]
  /** Lines that will not be sent, each with a reason. */
  excluded: ReorderLine[]
  /** The cart lines for `included`, in order. */
  items: OrderItem[]
  /** Sum of the included lines, before promotions. */
  subtotal: number
  /** Cart-level promotion savings (BOGO/bundle), never more than the subtotal. */
  promoDiscount: number
  /** subtotal - promoDiscount: the estimate to show. */
  estimatedTotal: number
}

export interface ReorderPlanInput {
  order: Pick<Order, 'items'>
  products: readonly Product[]
  hoReCa: HoReCa | null
  promotions: readonly Promotion[]
  currentUser: User | null
  cartonDiscountPercent: number
  /**
   * Word a shortage without saying how much is in stock (QR Staff). Absent or
   * false keeps "Only N in stock", which a Customer placing a real order wants.
   */
  hideStockCounts?: boolean
}

const cents = (n: number): number => Math.round(n * 100) / 100

function lineKey(item: OrderItem): string {
  return `${item.id}:${item.packSize ?? 1}:${item.uomId ?? 0}`
}

function excludedLine(source: OrderItem, reason: string): ReorderLine {
  return {
    key: lineKey(source),
    source,
    quantity: source.quantity,
    unitLabel: source.unit,
    unitPrice: 0,
    lineTotal: 0,
    status: 'unavailable',
    reason,
    item: null,
  }
}

function shortReason(product: Product, hideStockCounts: boolean): string {
  return hideStockCounts ? MAY_BE_SHORT_REASON : `Only ${Math.max(product.available, 0)} in stock`
}

function planLine(source: OrderItem, product: Product, input: ReorderPlanInput): ReorderLine {
  // The price (and the unit of measure it was found in) is the shared definition
  // the Shop's Reorder tab uses too -- see lib/reorderLinePrice.ts.
  const priced = priceReorderLine(source, product, input)
  if (priced.ok === false) return excludedLine(source, priced.reason)
  const { unitPrice, packSize, unit, uomId } = priced

  const baseUnits = lineBaseUnits(source.quantity, packSize)
  const short = baseUnits > product.available

  const item: OrderItem = { ...product, quantity: source.quantity, price: unitPrice, packSize, unit, uomId }
  return {
    key: lineKey(source),
    source,
    quantity: source.quantity,
    unitLabel: packSize ? `${unit} of ${packSize}` : unit,
    unitPrice,
    lineTotal: cents(unitPrice * source.quantity),
    status: short ? 'low' : 'ok',
    reason: short ? shortReason(product, input.hideStockCounts === true) : undefined,
    item,
  }
}

export function buildReorderPlan(input: ReorderPlanInput): ReorderPlan {
  const byId = new Map<number, Product>(input.products.map((p): [number, Product] => [p.id, p]))

  const lines = input.order.items.map((source): ReorderLine => {
    const product = byId.get(source.id)
    if (!product || product.isActive === false) return excludedLine(source, 'No longer sold')
    if (product.available <= 0) return excludedLine(source, 'Out of stock')
    return planLine(source, product, input)
  })

  const included = lines.filter((l) => l.item !== null)
  const excluded = lines.filter((l) => l.item === null)
  const items = included.map((l) => l.item as OrderItem)
  const subtotal = cents(included.reduce((sum, l) => sum + l.lineTotal, 0))

  const cart = items.length > 0
    ? applyCartPromotions(items, [...input.promotions], input.hoReCa, input.currentUser, [...input.products])
    : null
  const promoDiscount = cart ? Math.min(cents(cart.totalDiscount), subtotal) : 0

  return {
    lines,
    included,
    excluded,
    items,
    subtotal,
    promoDiscount,
    estimatedTotal: cents(subtotal - promoDiscount),
  }
}

// Lives in its own file so the core ordering hook (which a tenant without the
// shop module also ships) can share the pick without pulling in the planner.
export { pickKitchenOrders } from './pickKitchenOrders'
