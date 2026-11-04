// get_product_summary: one product's stock and its sales for a period (NX-0014).
//
// Sales come from the semantic layer under a PRODUCT line scope (OrderFilter
// .productId), so units, value and customers count exactly the lines of that
// product: never an order total, which belongs to the whole order. Units are base
// units (a carton line counts the units in it). A rep's scope is their own orders,
// applied as `repId`, with no argument that could widen it.
//
// Stock is the product's on-hand and available caches, classified with the same
// threshold rule as get_stock_status and the dashboard; it is left out entirely
// where the tenant has no inventory_dispatch module.

import { evaluateMetric } from '@/lib/semantic'
import type { CustomerRevenue, MetricContext, OrderFilter, ProductUnits } from '@/lib/semantic'
import { classifyStock, lowStockThresholdFor } from '@/lib/stockStatus'
import type { Product } from '@/types'
import { toBaseUnitOrders } from '../baseUnits'
import type { VoiceToolContext } from '../context'
import { toMetricContext } from '../context'
import { formatRange, resolvePeriod } from '../period'
import { activeProducts, isRep } from '../scope'
import type { ToolArgs } from '../toolArgs'
import { dayOf, dollars, fail, ok, ordersScope } from './common'
import type { ToolOutcome } from './common'

const TOP_CUSTOMERS = 5

/** Units of the scoped product: the filter carries productId, so there is at most one row. */
function unitsIn(mctx: MetricContext, filter: OrderFilter): number {
  return evaluateMetric<ProductUnits[]>('sales.unitsByProduct', mctx, filter).reduce((sum, row) => sum + row.units, 0)
}

function stockOf(product: Product, fallbackThreshold: number) {
  const threshold = lowStockThresholdFor(product, fallbackThreshold)
  return { onHand: product.inventory, available: product.available, threshold, status: classifyStock(product.inventory, threshold) }
}

export function getProductSummary(args: ToolArgs<'get_product_summary'>, ctx: VoiceToolContext): ToolOutcome {
  const product = activeProducts(ctx).find((p) => p.id === args.product_id)
  if (!product) return fail('Unknown product')

  const period = resolvePeriod(args.period, ctx.now, { from: args.from, to: args.to })
  // Base units for every quantity; line value (price x quantity) is unchanged by the conversion.
  const mctx: MetricContext = { ...toMetricContext(ctx), orders: toBaseUnitOrders(ctx.orders) }
  const scope: OrderFilter = { productId: product.id, ...(isRep(ctx) ? { repId: ctx.user.numericId } : {}) }
  const now = { ...scope, from: period.from, to: period.to }
  const before = { ...scope, from: period.previous.from, to: period.previous.to }

  const byCustomer = evaluateMetric<CustomerRevenue[]>('sales.revenueByCustomer', mctx, now)
  const unitsByCustomer = new Map<number, number>()
  for (const row of byCustomer) unitsByCustomer.set(row.horecaId, unitsIn(mctx, { ...now, horecaId: row.horecaId }))

  const sales = {
    units: unitsIn(mctx, now),
    value: dollars(evaluateMetric<number>('sales.lineRevenue', mctx, now)),
    orders: evaluateMetric<number>('sales.orderCount', mctx, now),
    customers: byCustomer.length,
    topCustomers: byCustomer.slice(0, TOP_CUSTOMERS).map((c) => ({
      horecaId: c.horecaId,
      name: c.name,
      units: unitsByCustomer.get(c.horecaId) ?? 0,
      value: dollars(c.revenue),
    })),
    previousUnits: unitsIn(mctx, before),
  }

  const data = {
    productId: product.id,
    name: product.name,
    sku: product.sku,
    category: product.category,
    ...(ctx.modules.includes('inventory_dispatch') ? { stock: stockOf(product, ctx.settings.lowStockThreshold) } : {}),
    sales,
  }
  const stockNote = 'stock' in data ? `; stock as the app last loaded it, as of ${dayOf(ctx.now.toISOString())}` : ''
  return ok(
    `${period.label}: ${product.name}'s lines only, from ${ordersScope(ctx)}, cancelled excluded; units in base units, value at line price; previousUnits covers ${formatRange(period.previous.from, period.previous.to)}${stockNote}`,
    data,
  )
}
