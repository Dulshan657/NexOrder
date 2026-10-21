// get_suggested_order_for_customer: what this customer usually buys that is due.
//
// Advisory. The assistant cannot place orders; the user does that in the app.

import { computeProductFrequencies, getCustomerOrders } from '@/services/buyingPatternsService'
import type { ProductFrequency } from '@/types'
import type { VoiceToolContext } from '../context'
import { toBaseUnitOrders } from '../baseUnits'
import { findVisibleCustomer, liveOrders } from '../scope'
import type { ToolArgs } from '../toolArgs'
import { DAY_MS, dayOf, daysSince, fail, ok } from './common'
import type { ToolOutcome } from './common'

const DUE_WITHIN_DAYS = 7
const MAX_ITEMS = 15
/** What a quantity is counted in when the product names no unit of its own. */
const FALLBACK_UNIT = 'units'

function isDue(f: ProductFrequency, horizonMs: number): boolean {
  if (f.isOverdue) return true
  return f.predictedNextOrderDate !== null && new Date(f.predictedNextOrderDate).getTime() <= horizonMs
}

/** Overdue first, then the product bought most often, then by name. */
function priority(a: ProductFrequency, b: ProductFrequency): number {
  return Number(b.isOverdue) - Number(a.isOverdue) || b.orderCount - a.orderCount || a.productName.localeCompare(b.productName)
}

export function getSuggestedOrderForCustomer(
  args: ToolArgs<'get_suggested_order_for_customer'>,
  ctx: VoiceToolContext,
): ToolOutcome {
  const customer = findVisibleCustomer(ctx, args.horeca_id)
  if (!customer) return fail('Unknown customer')

  const retired = new Set(ctx.products.filter((p) => p.isActive === false).map((p) => p.id))
  const horizon = ctx.now.getTime() + DUE_WITHIN_DAYS * DAY_MS
  // Base units, so a customer who buys two 12-can cartons is told 24 cans.
  const history = toBaseUnitOrders(getCustomerOrders(liveOrders(ctx), customer.id))
  const unitOf = new Map(ctx.products.map((p) => [p.id, p.unit]))
  const due = computeProductFrequencies(history, ctx.now)
    .filter((f) => !retired.has(f.productId) && isDue(f, horizon))
    .sort(priority)

  const items = due.slice(0, MAX_ITEMS).map((f) => ({
    productId: f.productId,
    name: f.productName,
    suggestedQty: Math.max(1, Math.round(f.avgQuantityPerOrder)),
    usualQty: f.avgQuantityPerOrder,
    unit: unitOf.get(f.productId) || FALLBACK_UNIT,
    daysSinceLastBought: daysSince(f.lastOrderedDate, ctx.now),
    overdue: f.isOverdue,
  }))

  const basis =
    `${customer.name}'s usual products that are overdue or due within ${DUE_WITHIN_DAYS} days, ` +
    `in their usual quantities in base units (each product's own unit, never cartons), from non-cancelled orders as of ${dayOf(ctx.now.toISOString())}; advice only`
  return ok(basis, { customer: customer.name, items, total: due.length })
}
