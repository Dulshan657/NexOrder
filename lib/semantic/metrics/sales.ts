// Sales & revenue metrics.
//
// The canonical revenue is the STORED `orders.total` — the number the customer
// was invoiced, with promotions and any header-level adjustment already applied.
// `SalesDashboard.tsx:219` used to re-sum the line items instead, which quietly
// discarded both. Verified on dev before the switch: all 64 orders agree to the
// cent, so adopting the stored total moved nothing on screen.
//
// Recognition is on PLACEMENT and all six statuses count, preserving the
// behaviour every dashboard already had. The status filter is declared, so a
// dispatched-only variant is a filter argument rather than a new definition.

import { ORDER_STATUS_LABELS, ORDER_STATUS_SEQUENCE } from '../../../constants'
import { UserRole } from '../../../types'
import type { Order, OrderStatus } from '../../../types'
import { filterOrders, rangeBounds, withinRange } from '../filter'
import type { MetricDef, OrderFilter } from '../types'

export interface StatusCount {
  status: OrderStatus
  label: string
  count: number
}

export interface DateRevenue {
  date: string
  revenue: number
}

export interface CustomerRevenue {
  horecaId: number
  name: string
  revenue: number
}

export interface RepRevenue {
  repId: number
  name: string
  revenue: number
  avatarUrl?: string
}

export interface ProductUnits {
  name: string
  units: number
}

export interface CategoryRevenue {
  category: string
  revenue: number
}

/** Σ price × quantity over an order's lines. */
function lineTotal(order: Order): number {
  return (order.items ?? []).reduce((sum, item) => sum + item.price * item.quantity, 0)
}

/**
 * The revenue figure appropriate to the scope being asked about.
 *
 * Without a line scope this is the stored order total — the canonical booked
 * figure. Under a line scope it is the sum of the surviving lines, because an
 * order's stored total belongs to the whole order and attributing it to one
 * category would over-count every mixed-category order.
 *
 * Naming the rule here is the point. `SalesDashboard` used to apply it by
 * rewriting `order.total` in place, which silently changed the basis of the trend
 * chart, the top-customers list and the top-reps list at the same time — and
 * applied it even with no category selected, which is where its numbers drifted
 * from `AdminDashboard`. Every grouping metric below reads through this function,
 * so the basis switches together or not at all.
 */
function effectiveRevenue(order: Order, filter: OrderFilter): number {
  return filter.category !== undefined ? lineTotal(order) : (order.total ?? 0)
}

/** The roles whose orders count as rep credit. An admin placing an order is not a rep sale. */
function isRepRole(role: UserRole | undefined): boolean {
  return role === UserRole.FIELD_REP || role === UserRole.OFFICE_REP
}

function descendingBy<T>(rows: T[], value: (row: T) => number): T[] {
  return [...rows].sort((a, b) => value(b) - value(a))
}

/**
 * Count orders per fulfilment stage, every stage present and in pipeline order.
 *
 * Exported because two different windowing concepts need this same grouping: the
 * `sales.ordersByStatus` metric (a calendar range, via OrderFilter) and
 * `computeDispatchFunnel` (a rolling N-day window relative to now). Those windows
 * are legitimately different questions; the grouping underneath them is not, and
 * used to be written out twice with its own copy of the stage labels.
 */
export function groupOrdersByStatus(orders: readonly Order[]): StatusCount[] {
  const counts = new Map<OrderStatus, number>()
  for (const order of orders) {
    counts.set(order.status, (counts.get(order.status) ?? 0) + 1)
  }
  // The ladder, plus cancelled ONLY when some order in scope actually is. It is
  // not a rung, so it never appears as an empty stage on a funnel; but a scope
  // that explicitly asked for cancelled orders must not render six zeroes and
  // silently drop the rows it was asked about.
  const stages: OrderStatus[] = (counts.get('cancelled') ?? 0) > 0
    ? [...ORDER_STATUS_SEQUENCE, 'cancelled']
    : ORDER_STATUS_SEQUENCE
  return stages.map(status => ({
    status,
    label: ORDER_STATUS_LABELS[status],
    count: counts.get(status) ?? 0,
  }))
}

export const SALES_METRICS: readonly MetricDef[] = [
  {
    id: 'sales.revenue',
    label: 'Revenue',
    description:
      'Sum of the stored order total for every order placed in scope. The stored total is what the customer was invoiced, including promotions and header-level adjustments. All six fulfilment statuses count, recognised on the placement date. Cancelled orders (mig 00111) are excluded — they were voided before anything shipped and no revenue was earned — unless a status filter names them explicitly.',
    unit: 'currency',
    shape: 'scalar',
    requires: ['orders'],
    supportsLineScope: false,
    compute: (ctx, filter) =>
      filterOrders(ctx.orders, filter).reduce((sum, order) => sum + (order.total ?? 0), 0),
  },
  {
    id: 'sales.lineRevenue',
    label: 'Line revenue',
    description:
      'Sum of price x quantity over the order lines in scope. This is the correct metric under a category scope, where an order stored total cannot be attributed to one category. With no line scope it is a reconciliation probe against sales.revenue: the two agreeing means no promotion or header adjustment is unaccounted for.',
    unit: 'currency',
    shape: 'scalar',
    requires: ['orders'],
    supportsLineScope: true,
    compute: (ctx, filter) =>
      filterOrders(ctx.orders, filter).reduce((sum, order) => sum + lineTotal(order), 0),
  },
  {
    id: 'sales.scopedRevenue',
    label: 'Revenue',
    description:
      'Revenue on the basis appropriate to the scope: the stored order total normally, and line revenue when a category scope is applied. Use this for a revenue tile whose filters the user controls, so selecting a category narrows the figure instead of over-counting mixed orders. Use sales.revenue instead when the answer must be the booked total and a line scope should be rejected rather than silently accommodated.',
    unit: 'currency',
    shape: 'scalar',
    requires: ['orders'],
    supportsLineScope: true,
    compute: (ctx, filter) =>
      filterOrders(ctx.orders, filter).reduce((sum, order) => sum + effectiveRevenue(order, filter), 0),
  },
  {
    id: 'sales.orderCount',
    label: 'Orders',
    description:
      'Number of orders in scope, counted on placement date. Under a category scope this counts orders containing at least one line in that category, not the lines themselves.',
    unit: 'count',
    shape: 'scalar',
    requires: ['orders'],
    supportsLineScope: true,
    compute: (ctx, filter) => filterOrders(ctx.orders, filter).length,
  },
  {
    id: 'sales.averageOrderValue',
    label: 'Avg. order value',
    description:
      'Revenue divided by order count over the same scope, using the scope-appropriate revenue basis (stored total normally, line revenue under a category scope). Returns 0 rather than NaN when no orders match, which is what every inline copy of this division had to remember to do.',
    unit: 'currency',
    shape: 'scalar',
    requires: ['orders'],
    supportsLineScope: true,
    compute: (ctx, filter) => {
      const scoped = filterOrders(ctx.orders, filter)
      if (scoped.length === 0) return 0
      return scoped.reduce((sum, order) => sum + effectiveRevenue(order, filter), 0) / scoped.length
    },
  },
  {
    id: 'sales.ordersByStatus',
    label: 'Orders by status',
    description:
      'Order count per fulfilment status, returned for every stage in pipeline order and zero-filled, so a chart never loses an axis entry just because no order currently sits in that stage.',
    unit: 'count',
    shape: 'series',
    requires: ['orders'],
    supportsLineScope: true,
    compute: (ctx, filter): StatusCount[] =>
      groupOrdersByStatus(filterOrders(ctx.orders, filter)),
  },
  {
    id: 'sales.revenueByDate',
    label: 'Revenue by date',
    description:
      'Revenue grouped by the UTC calendar day of the placement date, ascending, on the scope-appropriate basis (line revenue under a category scope). Days with no orders are absent; a caller wanting a gap-free axis fills the range itself, because only the caller knows which range it is drawing.',
    unit: 'currency',
    shape: 'series',
    requires: ['orders'],
    supportsLineScope: true,
    compute: (ctx, filter): DateRevenue[] => {
      const byDate = new Map<string, number>()
      for (const order of filterOrders(ctx.orders, filter)) {
        const date = order.orderDate.split('T')[0]
        byDate.set(date, (byDate.get(date) ?? 0) + effectiveRevenue(order, filter))
      }
      return [...byDate.entries()]
        .map(([date, revenue]) => ({ date, revenue }))
        .sort((a, b) => a.date.localeCompare(b.date))
    },
  },
  {
    id: 'sales.revenueByCustomer',
    label: 'Revenue by customer',
    description:
      'Revenue grouped by HoReCa, highest first, on the scope-appropriate basis (line revenue under a category scope). Keyed by customer id rather than name so two customers sharing a trading name are not merged into one row.',
    unit: 'currency',
    shape: 'series',
    requires: ['orders'],
    supportsLineScope: true,
    compute: (ctx, filter): CustomerRevenue[] => {
      const byCustomer = new Map<number, CustomerRevenue>()
      for (const order of filterOrders(ctx.orders, filter)) {
        const id = order.hoReCa?.id
        if (id === undefined) continue
        const current = byCustomer.get(id)
        byCustomer.set(id, {
          horecaId: id,
          name: order.hoReCa.name,
          revenue: (current?.revenue ?? 0) + effectiveRevenue(order, filter),
        })
      }
      return descendingBy([...byCustomer.values()], row => row.revenue)
    },
  },
  {
    id: 'sales.revenueByRep',
    label: 'Revenue by rep',
    description:
      'Revenue grouped by submitting user on the scope-appropriate basis, restricted to the Field and Office Sales Rep roles. An order placed by an admin or a customer is real revenue but is not rep credit, so it appears in sales.revenue and not here.',
    unit: 'currency',
    shape: 'series',
    requires: ['orders'],
    supportsLineScope: true,
    compute: (ctx, filter): RepRevenue[] => {
      const byRep = new Map<number, RepRevenue>()
      for (const order of filterOrders(ctx.orders, filter)) {
        const submitter = order.submittedBy
        if (!submitter || !isRepRole(submitter.role)) continue
        const current = byRep.get(submitter.id)
        byRep.set(submitter.id, {
          repId: submitter.id,
          name: submitter.name,
          revenue: (current?.revenue ?? 0) + effectiveRevenue(order, filter),
          avatarUrl: current?.avatarUrl ?? submitter.avatarUrl,
        })
      }
      return descendingBy([...byRep.values()], row => row.revenue)
    },
  },
  {
    id: 'sales.unitsByProduct',
    label: 'Units by product',
    description:
      'Units sold per product name, highest first. Counts the quantity as entered on the line, so a line booked in cartons contributes cartons — convert with lib/uom.ts before comparing against base-unit inventory figures.',
    unit: 'quantity',
    shape: 'series',
    requires: ['orders'],
    supportsLineScope: true,
    compute: (ctx, filter): ProductUnits[] => {
      const byName = new Map<string, number>()
      for (const order of filterOrders(ctx.orders, filter)) {
        for (const item of order.items ?? []) {
          byName.set(item.name, (byName.get(item.name) ?? 0) + item.quantity)
        }
      }
      return descendingBy(
        [...byName.entries()].map(([name, units]) => ({ name, units })),
        row => row.units,
      )
    },
  },
  {
    id: 'sales.revenueByCategory',
    label: 'Revenue by category',
    description:
      'Line revenue (price x quantity) grouped by product category, highest first. Uses line revenue rather than the stored order total because a category is a line-level property and an order total belongs to no single category.',
    unit: 'currency',
    shape: 'series',
    requires: ['orders'],
    supportsLineScope: true,
    compute: (ctx, filter): CategoryRevenue[] => {
      const byCategory = new Map<string, number>()
      for (const order of filterOrders(ctx.orders, filter)) {
        for (const item of order.items ?? []) {
          byCategory.set(
            item.category,
            (byCategory.get(item.category) ?? 0) + item.price * item.quantity,
          )
        }
      }
      return descendingBy(
        [...byCategory.entries()].map(([category, revenue]) => ({ category, revenue })),
        row => row.revenue,
      )
    },
  },
  {
    id: 'sales.newCustomerCount',
    label: 'New customers',
    description:
      'Customers acquired within the scope: those whose FIRST EVER order (within the rep scope, if one is given) falls inside the date range. A customer that ordered before the range and again inside it is a repeat, not an acquisition. Deliberately reads the unfiltered order history to find the first order, so the answer does not change with the range being viewed.',
    unit: 'count',
    shape: 'scalar',
    requires: ['orders'],
    supportsLineScope: false,
    compute: (ctx, filter) => {
      // The first order must be found across ALL history, so only the entity
      // scope is applied here — not the date range.
      const entityScoped = filterOrders(ctx.orders, {
        horecaId: filter.horecaId,
        repId: filter.repId,
        userRole: filter.userRole,
        statuses: filter.statuses,
      })

      const firstOrderAt = new Map<number, number>()
      for (const order of entityScoped) {
        const id = order.hoReCa?.id
        if (id === undefined) continue
        const placed = new Date(order.orderDate).getTime()
        if (Number.isNaN(placed)) continue
        const known = firstOrderAt.get(id)
        if (known === undefined || placed < known) firstOrderAt.set(id, placed)
      }

      // Same boundary rule as filterOrders, via the shared helper.
      const bounds = rangeBounds(filter)
      let count = 0
      for (const ms of firstOrderAt.values()) if (withinRange(ms, bounds)) count += 1
      return count
    },
  },
]
