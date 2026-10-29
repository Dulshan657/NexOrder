// get_stock_status: how the shelves look, as counts or as the products themselves.
//
// The numbers are the registry's inventory metrics, so "low" here is exactly
// "low" on the dashboard: at or below the product's own reorder point, else the
// app-wide threshold. Retired products are never reported.

import { evaluateMetric } from '@/lib/semantic'
import { lowStockThresholdFor } from '@/lib/stockStatus'
import type { StockHealth } from '@/services/inventoryDashboardService'
import type { Product } from '@/types'
import type { VoiceToolContext } from '../context'
import { toMetricContext } from '../context'
import type { ToolArgs } from '../toolArgs'
import { dayOf, ok } from './common'
import type { ToolOutcome } from './common'

const MAX_ROWS = 15

function inCategory(products: readonly Product[], category: string | undefined): readonly Product[] {
  const wanted = category?.trim().toLowerCase()
  if (!wanted) return products
  return products.filter((product) => product.category.trim().toLowerCase() === wanted)
}

function stockRow(product: Product, fallbackThreshold: number) {
  return {
    name: product.name,
    sku: product.sku,
    category: product.category,
    onHand: product.inventory,
    available: product.available,
    threshold: lowStockThresholdFor(product, fallbackThreshold),
  }
}

export function getStockStatus(args: ToolArgs<'get_stock_status'>, ctx: VoiceToolContext): ToolOutcome {
  const scoped = { ...ctx, products: inCategory(ctx.products, args.category) }
  const mctx = toMetricContext(scoped)
  const where = args.category?.trim() ? ` in ${args.category.trim()}` : ''
  const stockNote = 'stock as the app last loaded it: on hand is physical, available is on hand less what is reserved; active products only'

  if (args.filter === 'summary') {
    const health = evaluateMetric<StockHealth>('inventory.stockHealth', mctx)
    return ok(`${stockNote}${where}, as of ${dayOf(ctx.now.toISOString())}`, {
      inStock: health.inStock,
      lowStock: health.lowStock,
      outOfStock: health.outOfStock,
      onHandUnits: evaluateMetric<number>('inventory.onHandUnits', mctx),
      availableUnits: evaluateMetric<number>('inventory.availableUnits', mctx),
    })
  }

  const metric = args.filter === 'low' ? 'inventory.lowStockProducts' : 'inventory.outOfStockProducts'
  const products = [...evaluateMetric<readonly Product[]>(metric, mctx)].sort(
    (a, b) => a.inventory - b.inventory || a.name.localeCompare(b.name),
  )
  const meaning = args.filter === 'low' ? "at or below the product's reorder point but not yet out" : 'nothing on hand'
  return ok(`${stockNote}${where}; ${args.filter} means ${meaning}, as of ${dayOf(ctx.now.toISOString())}`, {
    filter: args.filter,
    total: products.length,
    products: products.slice(0, MAX_ROWS).map((product) => stockRow(product, ctx.settings.lowStockThreshold)),
  })
}
