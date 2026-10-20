// get_product_movement: what is selling, what is crawling, what is not moving.
//
// Velocity is units per week over the last 90 days. A rep's orders are their own,
// so for a rep this is their own sales, and the basis says so.

import type { ProductVelocity } from '@/types'
import type { VoiceToolContext } from '../context'
import { activeProducts, liveOrders } from '../scope'
import type { ToolArgs } from '../toolArgs'
import { dayOf, ok, ordersScope } from './common'
import type { ToolOutcome } from './common'
import { DEAD_STOCK_DAYS, MOVEMENT_WINDOW_DAYS, deadStock, slowMovers, topMovers, velocities } from './velocity'

const MEANING: Readonly<Record<ToolArgs<'get_product_movement'>['kind'], string>> = {
  top: 'top movers: the products selling the most units a week',
  slow: 'slow movers: selling, with stock on hand, slowest first',
  dead: `dead stock: on hand and not sold for ${DEAD_STOCK_DAYS} days, biggest pile first`,
}

function movementRow(v: ProductVelocity) {
  return {
    name: v.productName,
    category: v.category,
    unitsPerWeek: v.unitsPerWeek,
    trend: v.trend,
    currentStock: v.currentStock,
    lastSoldDate: dayOf(v.lastSoldDate),
  }
}

export function getProductMovement(args: ToolArgs<'get_product_movement'>, ctx: VoiceToolContext): ToolOutcome {
  const rates = velocities(liveOrders(ctx), activeProducts(ctx), ctx.now)
  const ranked =
    args.kind === 'top' ? topMovers(rates) : args.kind === 'slow' ? slowMovers(rates) : deadStock(rates, ctx.now)

  const basis =
    `${MEANING[args.kind]}; ${ordersScope(ctx)} from the last ${MOVEMENT_WINDOW_DAYS} days to ${dayOf(ctx.now.toISOString())}, ` +
    'cancelled excluded; stock is what is on hand'
  return ok(basis, { kind: args.kind, total: ranked.length, products: ranked.slice(0, args.limit).map(movementRow) })
}
