// get_reorder_recommendations: what to buy from suppliers.
//
// Two groups, in this order: products that are OUT of stock but still being
// ordered (they are losing sales now), then products that will run out inside the
// supplier lead time at the current weekly rate. Each carries a suggested
// quantity that covers the lead time plus two more weeks of selling.
//
// Not available to reps; that is toolsForRole's decision, applied before this runs.

import type { ProductVelocity } from '@/types'
import type { VoiceToolContext } from '../context'
import { activeProducts, liveOrders } from '../scope'
import type { ToolArgs } from '../toolArgs'
import { dayOf, ok } from './common'
import type { ToolOutcome } from './common'
import { MOVEMENT_WINDOW_DAYS, outOfStockSelling, restockAlerts, velocities } from './velocity'

/** Fortnight of selling to cover once the lead time has passed. */
const COVER_AFTER_LEAD_DAYS = 14
const DAYS_PER_WEEK = 7
/** Decimal places kept before rounding up, so float noise cannot add a unit. */
const CEIL_PRECISION = 6

function roundUp(value: number): number {
  return Math.ceil(Number(value.toFixed(CEIL_PRECISION)))
}

function recommendation(v: ProductVelocity, leadTimeDays: number, outOfStock: boolean) {
  const dailyRate = v.unitsPerWeek / DAYS_PER_WEEK
  return {
    productId: v.productId,
    name: v.productName,
    category: v.category,
    onHand: v.currentStock,
    unitsPerWeek: v.unitsPerWeek,
    daysRemaining: outOfStock ? 0 : Math.round(v.currentStock / dailyRate),
    suggestedQty: Math.max(0, roundUp(dailyRate * (leadTimeDays + COVER_AFTER_LEAD_DAYS) - v.currentStock)),
    outOfStock,
  }
}

export function getReorderRecommendations(
  args: ToolArgs<'get_reorder_recommendations'>,
  ctx: VoiceToolContext,
): ToolOutcome {
  const rates = velocities(liveOrders(ctx), activeProducts(ctx), ctx.now)
  const lead = args.lead_time_days
  const picks = [
    ...outOfStockSelling(rates).map((v) => recommendation(v, lead, true)),
    ...restockAlerts(rates, lead).map((v) => recommendation(v, lead, false)),
  ]

  const basis =
    `sales over the last ${MOVEMENT_WINDOW_DAYS} days to ${dayOf(ctx.now.toISOString())} from non-cancelled orders, active products, ` +
    `on-hand stock; every quantity is in base units (a carton counts as the units in it); suggested quantity covers the ${lead}-day lead time plus ${COVER_AFTER_LEAD_DAYS} days of selling`
  return ok(basis, { leadTimeDays: lead, total: picks.length, products: picks.slice(0, args.limit) })
}
