// The single order-scoping definition.
//
// Before this file, "orders in the selected range" was written three ways:
//
//   AdminDashboard.tsx:86    d >= start && d <= end          (instants: local midnight .. now)
//   SalesDashboard.tsx:206   d >= start && d <  end + 1 day  (whole days, from date inputs)
//   AdminDashboard.tsx:473   d >= start && d <= Date(endDate + 'T23:59:59')
//
// The third is the broken one: it is a whole-day range that drops the final
// second, and it builds its boundary in LOCAL time from a UTC date string.
//
// The fix is not to pick one. The first is genuinely instant-based ("since
// midnight, up to right now") and the second genuinely day-based ("these two
// calendar dates, inclusive"), and both are legitimate. So `from`/`to` here are
// exact inclusive INSTANTS — a Date is an instant, and pretending otherwise is
// what produced the third spelling — and `dayRange()` below is the single
// definition of turning two calendar dates into an inclusive range.

import type { Order } from '../../types'
import type { OrderFilter } from './types'

const MS_PER_DAY = 86_400_000

/**
 * UTC rather than local time throughout. The `<input type="date">` values the
 * dashboards feed in are `YYYY-MM-DD` strings, which `new Date(...)` parses as
 * UTC midnight, and `sales.revenueByDate` groups on `orderDate.split('T')[0]`,
 * which is also UTC. Building day boundaries in local time — as
 * `endDate + 'T23:59:59'` did — makes the range edge depend on the viewer's
 * timezone while the day labels beside it do not.
 */
function startOfUtcDay(value: Date | string): Date {
  const d = typeof value === 'string' ? new Date(value) : value
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
}

/** Last representable instant of the UTC day containing `value`. */
function endOfUtcDay(value: Date | string): Date {
  return new Date(startOfUtcDay(value).getTime() + MS_PER_DAY - 1)
}

/**
 * The single definition of "these two calendar dates, inclusive".
 *
 * Accepts what the UI actually holds: `YYYY-MM-DD` strings from a date input, or
 * Dates. Returns instants suitable for an `OrderFilter`, covering the whole of
 * both end days — so an order placed at 23:59:59.9 on the final day counts,
 * which is precisely what the old `T23:59:59` spelling got wrong.
 */
export function dayRange(from: Date | string, to: Date | string): { from: Date; to: Date } {
  return { from: startOfUtcDay(from), to: endOfUtcDay(to) }
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
 * a customer's first-order instant) uses the same comparison as `filterOrders`
 * instead of re-deriving it.
 */
export function rangeBounds(filter: Pick<OrderFilter, 'from' | 'to'>): RangeBounds {
  return {
    fromMs: filter.from ? filter.from.getTime() : null,
    toMs: filter.to ? filter.to.getTime() : null,
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
    if (filter.statuses !== undefined) {
      if (!filter.statuses.includes(order.status)) continue
    } else if (order.status === 'cancelled') {
      // A cancelled order (mig 00111) was placed and then voided: no revenue was
      // earned, no goods left the building, and its reservation was released. It
      // is excluded from every metric by DEFAULT, here rather than in each of the
      // twelve `compute` bodies, because one omission would leave revenue and
      // order count disagreeing about the same set of orders.
      //
      // An EXPLICIT `statuses` filter still wins, so a caller can ask for
      // cancelled orders deliberately -- that is what makes this a default and
      // not a blind spot.
      continue
    }

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
