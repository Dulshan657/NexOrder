// What a customer has ordered before, for the New Order screen's history pane:
// their recent orders, their last one, and the products they usually take.
//
// Pure: orders in, answers out. Cancelled orders are not history — they are
// what the customer did NOT end up taking.

import { findUomById, findUomByFactor } from '../uom'
import type { Order, OrderItem, Product } from '../../types'
import type { DraftLine } from './orderLineModel'

export const RECENT_ORDER_LIMIT = 10
export const USUAL_PRODUCT_LIMIT = 12

/** That customer's live orders, newest first, capped at `limit`. */
export function customerOrders(orders: readonly Order[], hoReCaId: number, limit = RECENT_ORDER_LIMIT): Order[] {
  return orders
    .filter((o) => o.hoReCa?.id === hoReCaId && o.status !== 'cancelled')
    .sort((a, b) => b.orderDate.localeCompare(a.orderDate))
    .slice(0, limit)
}

/**
 * One past line in the unit it was ordered in. The unit is the line's own
 * `uomId` when the product still has it; otherwise it is found from the pack
 * size (lines saved before `uom_id` existed carry only that). When neither
 * resolves, the line comes back in BASE units — quantity × pack size — so a
 * carton line is never silently copied as the same number of eaches.
 */
function lineOfItem(item: OrderItem, product: Product | undefined): DraftLine {
  const pack = item.packSize ?? 1
  const uom = findUomById(product?.uoms, item.uomId) ?? (pack > 1 ? findUomByFactor(product?.uoms, pack) : undefined)
  if (uom) return { productId: item.id, uomId: uom.isBase ? null : uom.id, quantity: item.quantity }
  return { productId: item.id, uomId: null, quantity: item.quantity * pack }
}

/** An order's lines in the units they were ordered in. */
export function linesOfOrder(order: Order, products: readonly Product[] = []): DraftLine[] {
  const byId = new Map(products.map((p): [number, Product] => [p.id, p]))
  return order.items.map((item) => lineOfItem(item, byId.get(item.id)))
}

export function lastOrderLines(orders: readonly Order[], hoReCaId: number, products: readonly Product[] = []): DraftLine[] {
  const [last] = customerOrders(orders, hoReCaId, 1)
  return last ? linesOfOrder(last, products) : []
}

export interface UsualProduct {
  productId: number
  /** How many of the customer's orders contain it. */
  orderCount: number
  /** Median BASE units per order, rounded up — what they typically take. */
  medianQuantity: number
}

function medianRoundedUp(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  const median = sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
  return Math.ceil(median)
}

/**
 * Products ranked by how many of the customer's orders contain them (ties by
 * product id, so the list does not reshuffle between renders). Quantities are
 * base units — an order of 1 carton of 12 counts as 12 — so a customer who
 * switches between cartons and eaches still gets one honest typical figure.
 */
export function usualProducts(
  orders: readonly Order[],
  hoReCaId: number,
  limit = USUAL_PRODUCT_LIMIT,
): UsualProduct[] {
  const perOrder = new Map<number, number[]>()
  for (const order of customerOrders(orders, hoReCaId, Number.POSITIVE_INFINITY)) {
    const inThisOrder = new Map<number, number>()
    for (const item of order.items) {
      const base = item.quantity * (item.packSize ?? 1)
      inThisOrder.set(item.id, (inThisOrder.get(item.id) ?? 0) + base)
    }
    for (const [productId, qty] of inThisOrder) {
      perOrder.set(productId, [...(perOrder.get(productId) ?? []), qty])
    }
  }
  return [...perOrder.entries()]
    .map(([productId, qtys]) => ({ productId, orderCount: qtys.length, medianQuantity: medianRoundedUp(qtys) }))
    .sort((a, b) => b.orderCount - a.orderCount || a.productId - b.productId)
    .slice(0, limit)
}
