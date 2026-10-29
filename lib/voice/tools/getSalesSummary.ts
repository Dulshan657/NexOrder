// get_sales_summary: revenue, orders, average order, new customers, the status
// mix, the top five customers and products, and the previous period beside it.
// Also what SHIPPED in the period (by the date it went out, not the date it was
// placed), split into dispatched and delivered, and how many orders are still in
// the warehouse: people asking how many orders were "processed" mean shipped.
//
// Every figure comes from a registry metric (lib/semantic), so the assistant
// cannot disagree with a dashboard about what "revenue" or a "new customer" is.
// A rep's scope is applied as an OrderFilter on `repId`; there is deliberately no
// argument that could change it.

import { evaluateMetric, filterOrders } from '@/lib/semantic'
import type { CustomerRevenue, MetricContext, OrderFilter, ProductUnits, ShippedSplit, StatusCount } from '@/lib/semantic'
import type { VoiceToolContext } from '../context'
import { toMetricContext } from '../context'
import { toBaseUnitOrders } from '../baseUnits'
import { formatRange, localYmd, resolvePeriod } from '../period'
import type { DateWindow } from '../period'
import { isRep } from '../scope'
import type { ToolArgs } from '../toolArgs'
import { dollars, fail, ok, ordersScope, percentChange } from './common'
import type { ToolOutcome } from './common'

const TOP_N = 5

/** Confirmed but not yet out of the door: every stage before dispatched. */
const IN_WAREHOUSE: OrderFilter['statuses'] = ['processing', 'processed', 'picked', 'packed']

function window(scope: OrderFilter, span: DateWindow): OrderFilter {
  return { ...scope, from: span.from, to: span.to }
}

function revenueAndCount(mctx: MetricContext, filter: OrderFilter): { revenue: number; orderCount: number } {
  return {
    revenue: evaluateMetric<number>('sales.revenue', mctx, filter),
    orderCount: evaluateMetric<number>('sales.orderCount', mctx, filter),
  }
}

function previousPeriod(mctx: MetricContext, scope: OrderFilter, span: DateWindow, current: { revenue: number; orderCount: number }) {
  const before = revenueAndCount(mctx, window(scope, span))
  return {
    label: formatRange(span.from, span.to),
    revenue: dollars(before.revenue),
    orderCount: before.orderCount,
    deltaPercent: percentChange(current.revenue, before.revenue),
    orderCountDeltaPercent: percentChange(current.orderCount, before.orderCount),
  }
}

/**
 * The app-zone date of the most recent order in scope placed before the period
 * ended, or null. Asked only when the period is empty, so "nothing today" can
 * come with "the last orders came in on 12 October" rather than a bare zero.
 * Cancelled orders are left out by filterOrders' default, as in every metric.
 */
function latestOrderDate(orders: VoiceToolContext['orders'], scope: OrderFilter, before: Date): string | null {
  let latest = Number.NEGATIVE_INFINITY
  for (const order of filterOrders(orders, { ...scope, to: before })) {
    const at = new Date(order.orderDate).getTime()
    if (at > latest) latest = at
  }
  return Number.isFinite(latest) ? localYmd(new Date(latest)) : null
}

export function getSalesSummary(args: ToolArgs<'get_sales_summary'>, ctx: VoiceToolContext): ToolOutcome {
  const customer = args.horeca_id === undefined ? undefined : ctx.hoReCas.find((c) => c.id === args.horeca_id)
  if (args.horeca_id !== undefined && !customer) return fail('Unknown customer')

  const period = resolvePeriod(args.period, ctx.now, { from: args.from, to: args.to })
  const mctx = toMetricContext(ctx)
  const scope: OrderFilter = { horecaId: args.horeca_id, ...(isRep(ctx) ? { repId: ctx.user.numericId } : {}) }
  const filter = window(scope, period)

  const current = revenueAndCount(mctx, filter)
  const orderStatus = evaluateMetric<StatusCount[]>('sales.ordersByStatus', mctx, filter)
  const topCustomers = evaluateMetric<CustomerRevenue[]>('sales.revenueByCustomer', mctx, filter)
  // Units in BASE units: sales.unitsByProduct sums quantity as entered, so a carton
  // line would count cartons. Revenue above stays on the original orders.
  const unitsCtx: MetricContext = { ...mctx, orders: toBaseUnitOrders(mctx.orders) }
  const topProducts = evaluateMetric<ProductUnits[]>('sales.unitsByProduct', unitsCtx, filter)

  const data = {
    revenue: dollars(current.revenue),
    orderCount: current.orderCount,
    averageOrderValue: dollars(evaluateMetric<number>('sales.averageOrderValue', mctx, filter)),
    newCustomers: evaluateMetric<number>('sales.newCustomerCount', mctx, filter),
    shippedCount: evaluateMetric<number>('sales.shippedCount', mctx, filter),
    shippedByStatus: evaluateMetric<ShippedSplit>('sales.shippedByStatus', mctx, filter),
    // Right now, whenever placed: "still in the warehouse" is a state, not a period.
    stillInWarehouse: evaluateMetric<number>('sales.orderCount', mctx, { ...scope, statuses: IN_WAREHOUSE }),
    ordersByStatus: orderStatus.filter((s) => s.count > 0).map((s) => ({ status: s.status, count: s.count })),
    topCustomers: topCustomers.slice(0, TOP_N).map((c) => ({ horecaId: c.horecaId, name: c.name, revenue: dollars(c.revenue) })),
    topProducts: topProducts.slice(0, TOP_N).map((p) => ({ name: p.name, units: p.units })),
    ...(args.compare_previous ? { previous: previousPeriod(mctx, scope, period.previous, current) } : {}),
    ...(current.orderCount === 0 ? { latestOrderDate: latestOrderDate(ctx.orders, scope, period.to) } : {}),
  }

  const forCustomer = customer ? `, for ${customer.name}` : ''
  const basis = `${period.label}: placed orders by order date, shipped orders by the date they first went out, ${ordersScope(ctx)}, cancelled excluded${forCustomer}`
  return ok(basis, data)
}
