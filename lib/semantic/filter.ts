// The single order-scoping definition.
//
// Before this file, "orders in the selected range" was written three ways that
// disagreed at the day boundary:
//
//   AdminDashboard.tsx:86    d >= start && d <= end
//   SalesDashboard.tsx:206   d >= start && d <  end + 1 day
//   AdminDashboard.tsx:473   d >= start && d <= Date(endDate + 'T23:59:59')
//
// The third silently dropped the last second of the final day. This module
// resolves all three in favour of whole-day-inclusive on both ends, which is
// what every calling UI already claimed to do.

import type { Order } from '../../types'
import type { OrderFilter } from './types'

const MS_PER_DAY = 86_400_000

/**
 * Start of the UTC calendar day containing `d`.
 *
 * UTC rather than local time on purpose. The `<input type="date">` values the
 * dashboards feed in are `YYYY-MM-DD` strings, which `new Date(...)` parses as
 * UTC midnight, and `sales.revenueByDate` groups on `orderDate.split('T')[0]`,
 * which is also UTC. Using local time here would make the range boundary depend
 * on the viewer's timezone while the day labels next to it did not.
 */
function startOfUtcDay(d: Date): number {
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
}

export interface RangeBounds {
  /** Inclusive, or null for unbounded. */
  fromMs: number | null
  /** Inclusive, or null for unbounded. */
  toMs: number | null
}

/**
 * Resolve a filter's date range to millisecond bounds. Exported so a metric that
 * needs to range-test a bare timestamp (see `sales.newCustomerCount`, which tests
 * a customer's first-order instant) uses the same boundary rule as
 * `filterOrders` instead of re-deriving it.
 */
export function rangeBounds(filter: Pick<OrderFilter, 'from' | 'to'>): RangeBounds {
  return {
    fromMs: filter.from ? startOfUtcDay(filter.from) : null,
    toMs: filter.to ? startOfUtcDay(filter.to) + MS_PER_DAY - 1 : null,
  }
}

/** Whether a timestamp falls inside resolved bounds. NaN is never in range. */
export function withinRange(ms: number, bounds: RangeBounds): boolean {
  if (Number.isNaN(ms)) return false
  if (bounds.fromMs !== null && ms < bounds.fromMs) return false
  if (bounds.toMs !== null && ms > bounds.toMs) return false
  return true
}

/**
 * Apply an `OrderFilter`.
 *
 * Order-level predicates (date, customer, rep, role, status) select whole
 * orders. The line-level `category` predicate additionally returns a copy of
 * each surviving order with its `items` narrowed, dropping orders left with no
 * matching line. The copy is why this never mutates its input.
 *
 * The stored `total` on a category-narrowed order is deliberately left alone —
 * rewriting it here is what `SalesDashboard.tsx:219` did, and it hid the choice
 * between "booked revenue" and "revenue attributable to this category". Ask for
 * `sales.lineRevenue` when you want the latter.
 */
export function filterOrders(
  orders: readonly Order[],
  filter: OrderFilter,
): readonly Order[] {
  const bounds = rangeBounds(filter)

  const out: Order[] = []

  for (const order of orders) {
    // An unparseable date is not silently treated as the epoch.
    if (!withinRange(new Date(order.orderDate).getTime(), bounds)) continue

    if (filter.horecaId !== undefined && order.hoReCa?.id !== filter.horecaId) continue
    if (filter.repId !== undefined && order.submittedBy?.id !== filter.repId) continue
    if (filter.userRole !== undefined && order.submittedBy?.role !== filter.userRole) continue
    if (filter.statuses !== undefined && !filter.statuses.includes(order.status)) continue

    if (filter.category !== undefined) {
      const items = (order.items ?? []).filter(item => item.category === filter.category)
      if (items.length === 0) continue
      out.push({ ...order, items })
      continue
    }

    out.push(order)
  }

  return out
}
