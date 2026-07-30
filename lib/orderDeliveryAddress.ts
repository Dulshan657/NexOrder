// Where an order actually ships, as one string.
//
// `orders.delivery_address` is a per-order snapshot and NULL there has a defined
// meaning — "fall back to horecas.address" (migration 00021). Every surface that
// shows a delivery address therefore needs the same two-step, and it is exactly
// the kind of rule that gets half-implemented in one component and forgotten in
// the next. One function, so the picking sheet and the customer's order history
// can never disagree about where the goods are going.

import type { Order, OrderDeliveryAddress } from '../types'

/** Join the populated parts of a snapshot, in postal order. */
export function formatDeliveryAddress(address: OrderDeliveryAddress): string {
  const locality = [address.city, address.postcode].filter(Boolean).join(' ').trim()
  return [address.street, locality, address.country].filter(Boolean).join(', ')
}

/**
 * The address to show for an order, and where it came from.
 *
 * `source` lets callers mark a PO-supplied address as such — an operator
 * checking why a delivery went somewhere unexpected needs to know whether the
 * document chose it or the customer record did.
 */
export function orderDeliveryAddress(
  order: Pick<Order, 'deliveryAddress' | 'hoReCa'>,
): { text: string; source: 'order' | 'customer' } | null {
  if (order.deliveryAddress) {
    const text = formatDeliveryAddress(order.deliveryAddress)
    if (text) return { text, source: 'order' }
  }
  const fallback = order.hoReCa?.address?.trim()
  return fallback ? { text: fallback, source: 'customer' } : null
}
