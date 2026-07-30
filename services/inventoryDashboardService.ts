import type { Order, Product } from '@/types';
import { classifyStock, lowStockThresholdFor } from '@/lib/stockStatus';
import { groupOrdersByStatus, type StatusCount } from '@/lib/semantic/metrics/sales';

// Pure derivations for the Admin Dashboard "Inventory & Dispatch" section.
// No DB calls — these operate on data already cached in the dashboard (products,
// allOrders), mirroring the pattern in productMovementService / promotionROIService.

export interface StockHealth {
  inStock: number;
  lowStock: number;
  outOfStock: number;
  total: number;
}

/**
 * Classify active products into in-stock / low-stock / out-of-stock buckets.
 * Delegates to the canonical `classifyStock` / `lowStockThresholdFor` in
 * `lib/stockStatus.ts`: a product is "low" when its on-hand falls to or below
 * its per-product `reorderPoint`, falling back to the dashboard-wide
 * `lowStockThreshold` when no reorder point is configured. Inactive products
 * (`isActive === false`) are excluded.
 *
 * `onHandOf` defaults to the global on-hand cache (`product.inventory`) so
 * every existing caller is unaffected; pass a scoped lookup (e.g. per-warehouse
 * on-hand) to bucket the same product set against a single site instead.
 */
export function computeStockHealth(
  products: readonly Product[],
  lowStockThreshold: number,
  onHandOf: (product: Product) => number = (product) => product.inventory,
): StockHealth {
  let inStock = 0;
  let lowStock = 0;
  let outOfStock = 0;

  for (const product of products) {
    if (product.isActive === false) continue;

    const onHand = onHandOf(product);
    const threshold = lowStockThresholdFor(product, lowStockThreshold);

    switch (classifyStock(onHand, threshold)) {
      case 'out_of_stock':
        outOfStock += 1;
        break;
      case 'low_stock':
        lowStock += 1;
        break;
      case 'in_stock':
        inStock += 1;
        break;
    }
  }

  return { inStock, lowStock, outOfStock, total: inStock + lowStock + outOfStock };
}

export type DispatchWindow = 7 | 30 | 90;

/** Kept as an alias so existing importers are unaffected by the move. */
export type DispatchFunnelStage = StatusCount;

/**
 * Count orders placed within the last `windowDays` (relative to the injected
 * `now`) grouped by their current fulfilment status, returned in pipeline order.
 * `now` is a parameter so the function is deterministic and testable.
 *
 * The rolling window is this function's own concern — a "last 30 days" window is
 * a different question from the calendar range `sales.ordersByStatus` answers, so
 * it stays here. The grouping and the stage labels are NOT its own concern, and
 * are delegated to `groupOrdersByStatus` in the semantic layer; this file used to
 * carry a second copy of the pipeline order and every label.
 */
export function computeDispatchFunnel(
  orders: readonly Order[],
  windowDays: DispatchWindow,
  now: Date,
): DispatchFunnelStage[] {
  const cutoff = now.getTime() - windowDays * 86_400_000;

  const withinWindow = orders.filter((order) => {
    const placed = new Date(order.orderDate).getTime();
    return !Number.isNaN(placed) && placed >= cutoff && placed <= now.getTime();
  });

  return groupOrdersByStatus(withinWindow);
}
