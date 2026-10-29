// get_sales_summary: revenue, orders, average order, new customers, the status
// mix, the top five customers and products, and the previous period beside it.
//
// Every figure comes from a registry metric (lib/semantic), so the assistant
// cannot disagree with a dashboard about what "revenue" or a "new customer" is.
// A rep's scope is applied as an OrderFilter on `repId`; there is deliberately no
// argument that could change it.

import { evaluateMetric } from '@/lib/semantic'
import type { CustomerRevenue, MetricContext, OrderFilter, ProductUnits, StatusCount } from '@/lib/semantic'
import type { VoiceToolContext } from '../context'
import { toMetricContext } from '../context'
import { toBaseUnitOrders } from '../baseUnits'
import { formatRange, resolvePeriod } from '../period'
import type { DateWindow } from '../period'
import { isRep } from '../scope'
import type { ToolArgs } from '../toolArgs'
import { dollars, fail, ok, ordersScope, percentChange } from './common'
import type { ToolOutcome } from './common'

const TOP_N = 5

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
    ordersByStatus: orderStatus.filter((s) => s.count > 0).map((s) => ({ status: s.status, count: s.count })),
    topCustomers: topCustomers.slice(0, TOP_N).map((c) => ({ horecaId: c.horecaId, name: c.name, revenue: dollars(c.revenue) })),
    topProducts: topProducts.slice(0, TOP_N).map((p) => ({ name: p.name, units: p.units })),
    ...(args.compare_previous ? { previous: previousPeriod(mctx, scope, period.previous, current) } : {}),
  }

  const forCustomer = customer ? `, for ${customer.name}` : ''
  return ok(`orders placed ${period.label}, ${ordersScope(ctx)}, cancelled excluded${forCustomer}`, data)
}
