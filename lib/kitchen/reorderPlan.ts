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

import type { HoReCa, Order, OrderItem, Product, Promotion, User } from '@/types'
import { applyCartPromotions } from '@/services/promotionService'
import { resolvePromotionPrice, resolveUomLinePrice } from '@/pricing'
import { deriveDefaultUoms, findUomById, findUomByFactor, orderableUoms } from '@/lib/uom'

export type ReorderLineStatus = 'ok' | 'low' | 'unavailable'

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

function planLine(source: OrderItem, product: Product, input: ReorderPlanInput): ReorderLine {
  const { hoReCa, promotions, currentUser, cartonDiscountPercent } = input
  const promos = [...promotions]

  const own = orderableUoms(product.uoms)
  const uoms = own.length > 0 ? own : orderableUoms(deriveDefaultUoms(product.unit, product.price, product.cartonSize, cartonDiscountPercent))
  // A line that was a carton must stay a carton. Falling back to the base unit
  // when its pack no longer exists would read "2 cartons" as "2 units" -- a
  // quietly different order -- so that line is held back with a reason instead.
  const wasPacked = (source.packSize ?? 1) > 1
  const matched = findUomById(uoms, source.uomId) ?? findUomByFactor(uoms, source.packSize)
  if (!matched && wasPacked) return excludedLine(source, 'Pack size changed')
  const uom = matched ?? uoms.find((u) => u.isBase) ?? uoms[0]

  const unitPrice = uom
    ? resolveUomLinePrice(product, uom, hoReCa, currentUser, promos)
    : resolvePromotionPrice(product, hoReCa, currentUser, promos).finalPrice

  const packSize = uom ? (uom.isBase ? undefined : uom.factorToBase) : source.packSize
  const unit = uom?.code ?? source.unit
  // An id of 0 is a synthesised default UOM that was never persisted.
  const uomId = uom && uom.id > 0 ? uom.id : undefined

  const baseUnits = source.quantity * (packSize ?? 1)
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
    reason: short ? `Only ${Math.max(product.available, 0)} in stock` : undefined,
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

/**
 * The venue's orders newest first, split into what the Kitchen screen shows:
 * the one to offer "same again" on (the newest that was not cancelled -- a
 * cancelled order is a poor thing to repeat unprompted) and the last few for the
 * "Recent orders" list (cancelled ones included, so the list matches History).
 */
export function pickKitchenOrders<T extends Pick<Order, 'orderDate' | 'status' | 'hoReCa'>>(
  orders: readonly T[],
  hoReCaId: number | null | undefined,
  recentCount = 3,
): { hero: T | null; recent: T[] } {
  if (hoReCaId == null) return { hero: null, recent: [] }
  const mine = orders
    .filter((o) => o.hoReCa.id === hoReCaId)
    .sort((a, b) => Date.parse(b.orderDate) - Date.parse(a.orderDate))
  return {
    hero: mine.find((o) => o.status !== 'cancelled') ?? null,
    recent: mine.slice(0, recentCount),
  }
}
