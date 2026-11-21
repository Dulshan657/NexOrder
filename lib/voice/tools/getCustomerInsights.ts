// get_customer_insights: one customer's buying pattern, and their last order as
// it was placed. "What did they order last time?" is answered from lastOrder's
// lines: answering it from the usual products (topProducts) reads as the order
// while naming things they may not have bought that day (dev, 2026-10-29).

import { computeHoReCaInsights } from '@/services/buyingPatternsService'
import type { VoiceToolContext } from '../context'
import { toBaseUnitOrders } from '../baseUnits'
import { findVisibleCustomer, isRep, liveOrders } from '../scope'
import type { ToolArgs } from '../toolArgs'
import type { Order } from '@/types'
import { dayOf, daysSince, dollars, fail, ok } from './common'
import type { ToolOutcome } from './common'

const TOP_PRODUCTS = 8
const RECENT_MONTHS = 3

/** The customer's most recent order among `orders` (already live, scoped, in base units), or null. */
function lastOrderOf(orders: readonly Order[], customerId: number) {
  let latest: Order | null = null
  for (const order of orders) {
    if (order.hoReCa?.id !== customerId) continue
    if (!latest || new Date(order.orderDate).getTime() > new Date(latest.orderDate).getTime()) latest = order
  }
  if (!latest) return null
  return {
    orderId: latest.id,
    date: dayOf(latest.orderDate),
    status: latest.status,
    total: dollars(latest.total),
    lines: (Array.isArray(latest.items) ? latest.items : []).map((item) => ({ name: item.name, quantity: item.quantity })),
  }
}

export function getCustomerInsights(args: ToolArgs<'get_customer_insights'>, ctx: VoiceToolContext): ToolOutcome {
  const customer = findVisibleCustomer(ctx, args.horeca_id)
  if (!customer) return fail('Unknown customer')

  // Base units, so avgQuantityPerOrder counts cans, not cartons. Spend reads order
  // totals, which the conversion leaves alone.
  const orders = toBaseUnitOrders(liveOrders(ctx))
  const insights = computeHoReCaInsights(orders, customer.id, customer.name, ctx.now)

  const data = {
    horecaId: customer.id,
    name: customer.name,
    segment: insights.segment,
    totalOrders: insights.totalOrders,
    totalSpend: dollars(insights.totalSpend),
    avgOrderValue: dollars(insights.avgOrderValue),
    avgDaysBetweenOrders: insights.avgDaysBetweenOrders,
    predictedNextOrderDate: dayOf(insights.predictedNextOrderDate),
    daysSinceLastOrder: insights.daysSinceLastOrder,
    lastOrderDate: dayOf(insights.lastOrderDate),
    frequencyTrend: insights.frequencyTrend,
    spendTrend: insights.spendTrend,
    topProducts: insights.productFrequencies.slice(0, TOP_PRODUCTS).map((f) => ({
      name: f.productName,
      orderCount: f.orderCount,
      avgQuantityPerOrder: f.avgQuantityPerOrder,
      lastOrderedDate: dayOf(f.lastOrderedDate),
      daysSinceLastBought: daysSince(f.lastOrderedDate, ctx.now),
      isOverdue: f.isOverdue,
    })),
    spendingTrends: insights.spendingTrends.slice(-RECENT_MONTHS).map((m) => ({
      month: m.month,
      totalSpend: dollars(m.totalSpend),
      orderCount: m.orderCount,
    })),
    lastOrder: lastOrderOf(orders, customer.id),
  }

  const whose = isRep(ctx) ? `the orders you placed for ${customer.name}` : `all of ${customer.name}'s orders`
  return ok(`${whose}, cancelled excluded, quantities in base units, as of ${dayOf(ctx.now.toISOString())}`, data)
}
