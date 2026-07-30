// Inventory & warehouse metrics.
//
// The rule for this domain: a metric either wraps an existing pure helper or
// reads a DB-computed field. It NEVER re-derives what Postgres already computes.
// `inventory_balances.available` is a generated column and `v_bin_fill` is the
// single source of bin fill; those stay in the database and are referenced, not
// recomputed here, or the app would grow a second answer that can drift.
//
// `Product.inventory` (on-hand) and `Product.available` (reservable = on-hand
// minus allocated) are two distinct caches. Every metric below names which one it
// reads, because conflating them is a documented footgun in this codebase.

import { computeStockHealth } from '../../../services/inventoryDashboardService'
import { classifyStock, lowStockThresholdFor } from '../../stockStatus'
import type { Product } from '../../../types'
import { filterOrders } from '../filter'
import type { MetricContext, MetricDef } from '../types'
import { groupOrdersByStatus } from './sales'

/** Products an operator can still act on. Retired products are never alerted on. */
function activeProducts(ctx: MetricContext): readonly Product[] {
  return ctx.products.filter(product => product.isActive !== false)
}

/**
 * Products in a given stock bucket, by the canonical rule.
 *
 * This is where the old inline rule and the canonical helper part company. Both
 * `SalesDashboard.tsx:247` and `AdminDashboard.tsx:131` wrote
 * `p.inventory > 0 && p.inventory < lowStockThreshold`, which used a strict `<`,
 * ignored each product's own `reorderPoint`, and included retired products.
 * `classifyStock` uses `<=` and honours `reorderPoint`, so a product sitting
 * exactly at its threshold now correctly reads as low.
 */
function productsInBucket(
  ctx: MetricContext,
  bucket: 'in_stock' | 'low_stock' | 'out_of_stock',
): readonly Product[] {
  return activeProducts(ctx).filter(product => {
    const threshold = lowStockThresholdFor(product, ctx.settings.lowStockThreshold)
    return classifyStock(product.inventory, threshold) === bucket
  })
}

export const INVENTORY_METRICS: readonly MetricDef[] = [
  {
    id: 'inventory.stockHealth',
    label: 'Stock health',
    description:
      'Active products bucketed into in-stock, low-stock and out-of-stock counts. Delegates to computeStockHealth in services/inventoryDashboardService.ts, so the boundary rule lives in exactly one place. Reads the ON-HAND cache (Product.inventory), not available — a product whose stock is fully allocated still counts as physically in stock here.',
    unit: 'count',
    shape: 'breakdown',
    requires: ['products', 'settings'],
    supportsLineScope: false,
    compute: ctx => computeStockHealth(ctx.products, ctx.settings.lowStockThreshold),
  },
  {
    id: 'inventory.lowStockProducts',
    label: 'Low stock',
    description:
      'Active products at or below their low-stock threshold but not yet out of stock. The threshold is the product own reorderPoint when set, otherwise the app-wide low_stock_threshold setting. Reads the ON-HAND cache.',
    unit: 'count',
    shape: 'rows',
    requires: ['products', 'settings'],
    supportsLineScope: false,
    compute: ctx => productsInBucket(ctx, 'low_stock'),
  },
  {
    id: 'inventory.outOfStockProducts',
    label: 'Out of stock',
    description:
      'Active products with no on-hand stock at all. Kept as its own bucket rather than folded into low stock, because the operator action differs: one is a reorder, the other is an unfulfillable line.',
    unit: 'count',
    shape: 'rows',
    requires: ['products', 'settings'],
    supportsLineScope: false,
    compute: ctx => productsInBucket(ctx, 'out_of_stock'),
  },
  {
    id: 'inventory.lowStockCount',
    label: 'Low stock count',
    description:
      'How many active products are in the low-stock bucket. The count of inventory.lowStockProducts, offered separately so a tile does not have to materialise the list.',
    unit: 'count',
    shape: 'scalar',
    requires: ['products', 'settings'],
    supportsLineScope: false,
    compute: ctx => productsInBucket(ctx, 'low_stock').length,
  },
  {
    id: 'inventory.outOfStockCount',
    label: 'Out of stock count',
    description:
      'How many active products have no on-hand stock. The count of inventory.outOfStockProducts.',
    unit: 'count',
    shape: 'scalar',
    requires: ['products', 'settings'],
    supportsLineScope: false,
    compute: ctx => productsInBucket(ctx, 'out_of_stock').length,
  },
  {
    id: 'inventory.onHandUnits',
    label: 'On-hand units',
    description:
      'Total physical units across active products, read from the ON-HAND cache (Product.inventory, maintained by inv_recompute_product_cache). This is what is in the building, including units already reserved against open orders.',
    unit: 'quantity',
    shape: 'scalar',
    requires: ['products'],
    supportsLineScope: false,
    compute: ctx => activeProducts(ctx).reduce((sum, product) => sum + (product.inventory ?? 0), 0),
  },
  {
    id: 'inventory.availableUnits',
    label: 'Available units',
    description:
      'Total reservable units across active products, read from the AVAILABLE cache (Product.available = on-hand minus allocated). This is what a new order can actually draw on; the gap against on-hand units is stock already committed elsewhere.',
    unit: 'quantity',
    shape: 'scalar',
    requires: ['products'],
    supportsLineScope: false,
    compute: ctx => activeProducts(ctx).reduce((sum, product) => sum + (product.available ?? 0), 0),
  },
  {
    id: 'inventory.dispatchFunnel',
    label: 'Dispatch funnel',
    description:
      'Orders in scope grouped by fulfilment stage, in pipeline order and zero-filled. Identical by construction to sales.ordersByStatus — the funnel is a presentation of that one definition, not a second count of the same thing.',
    unit: 'count',
    shape: 'series',
    requires: ['orders'],
    supportsLineScope: false,
    compute: (ctx, filter) => groupOrdersByStatus(filterOrders(ctx.orders, filter)),
  },
]
