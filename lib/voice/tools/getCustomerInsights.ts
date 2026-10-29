// get_customer_insights: one customer's buying pattern.

import { computeHoReCaInsights } from '@/services/buyingPatternsService'
import type { VoiceToolContext } from '../context'
import { toBaseUnitOrders } from '../baseUnits'
import { findVisibleCustomer, isRep, liveOrders } from '../scope'
import type { ToolArgs } from '../toolArgs'
import { dayOf, daysSince, dollars, fail, ok } from './common'
import type { ToolOutcome } from './common'

const TOP_PRODUCTS = 8
const RECENT_MONTHS = 3

export function getCustomerInsights(args: ToolArgs<'get_customer_insights'>, ctx: VoiceToolContext): ToolOutcome {
  const customer = findVisibleCustomer(ctx, args.horeca_id)
  if (!customer) return fail('Unknown customer')

  // Base units, so avgQuantityPerOrder counts cans, not cartons. Spend reads order
  // totals, which the conversion leaves alone.
  const insights = computeHoReCaInsights(toBaseUnitOrders(liveOrders(ctx)), customer.id, customer.name, ctx.now)

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
  }

  const whose = isRep(ctx) ? `the orders you placed for ${customer.name}` : `all of ${customer.name}'s orders`
  return ok(`${whose}, cancelled excluded, quantities in base units, as of ${dayOf(ctx.now.toISOString())}`, data)
}
