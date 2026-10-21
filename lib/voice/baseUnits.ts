// Order lines restated in BASE units, for every quantity a voice tool speaks.
//
// OrderItem.quantity is in the line's chosen unit of measure (cartons for a carton
// line) and OrderItem.packSize is that unit's factor to base units, undefined for a
// single unit (types.ts OrderItem; lib/adapters.ts reads it from
// order_items.pack_size). The server's own definition is
// `base = quantity x COALESCE(pack_size, 1)` (_shared/pricing.ts lineBaseUnits),
// and inventory, reservations and the ledger are all base units. Several shared
// helpers (lib/semantic sales.unitsByProduct, services/productMovementService
// computeSalesVelocity, services/buyingPatternsService) sum the quantity AS
// ENTERED, which other screens rely on, so the voice tools convert their input
// here instead of changing those.
//
// The line price is per chosen unit (order_items.unit_price), so it is divided by
// the same factor: price x quantity, the line's value, is unchanged. Order totals
// are untouched. Revenue figures should still be read from the original orders;
// this exists for quantities.
//
// Pure, and immutable: returns new orders and new items, never touching its input.

import type { Order, OrderItem } from '@/types'

/** The line's factor to base units: its packSize when that is a positive number, else 1. */
export function baseFactor(item: Pick<OrderItem, 'packSize'>): number {
  const size = item.packSize
  return typeof size === 'number' && Number.isFinite(size) && size > 0 ? size : 1
}

function toBaseUnitItem(item: OrderItem): OrderItem {
  const factor = baseFactor(item)
  if (factor === 1) return { ...item }
  return { ...item, quantity: item.quantity * factor, price: item.price / factor, packSize: undefined }
}

/**
 * New orders whose every line is in base units at the same line value. An order
 * whose items are not an array is passed on as it is (copied), not repaired: what
 * the downstream helper does with bad data (skip it or fail the lookup) stays
 * that helper's decision, exactly as before the conversion existed.
 */
export function toBaseUnitOrders(orders: readonly Order[]): Order[] {
  return orders.map((order) => (Array.isArray(order.items) ? { ...order, items: order.items.map(toBaseUnitItem) } : { ...order }))
}
