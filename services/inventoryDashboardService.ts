import type { Order, Product } from '@/types';
import { classifyStock, lowStockThresholdFor } from '@/lib/stockStatus';
import { groupOrdersByStatus, type StatusCount } from '@/lib/semantic/metrics/sales';
import { resolvePeriod } from '@/lib/period';

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

/**
 * 'month' is the Sydney calendar month to date, the same window Nex means by
 * "this month" (lib/period). The numbers are rolling day counts ending now.
 */
export type DispatchWindow = 'month' | 7 | 30 | 90;

/** Kept as an alias so existing importers are unaffected by the move. */
export type DispatchFunnelStage = StatusCount;

export interface OrderPipeline {
  /** The six fulfilment stages, in order, zero-filled. Never contains 'cancelled'. */
  stages: DispatchFunnelStage[];
  /** Orders placed in the same window and since cancelled. Shown beside the chart, not as a stage. */
  cancelled: number;
}

function windowBounds(window: DispatchWindow, now: Date): { from: number; to: number } {
  if (window === 'month') {
    const month = resolvePeriod('this_month', now);
    return { from: month.from.getTime(), to: month.to.getTime() };
  }
  return { from: now.getTime() - window * 86_400_000, to: now.getTime() };
}

/**
 * Where the orders placed in the window sit now: one count per fulfilment stage,
 * plus the cancelled ones counted apart. `now` is a parameter so the function is
 * deterministic and testable.
 *
 * Cancelled is split out because it is not a stage. It used to be drawn as the
 * last bar of the funnel, which read as "the step after delivered". With it gone,
 * the stages sum to sales.orderCount for the same window, which is what Nex says
 * when asked how many orders came in (__tests__/numbersParity.test.ts).
 *
 * The grouping and the stage labels are delegated to `groupOrdersByStatus` in the
 * semantic layer; this file used to carry a second copy of both.
 */
export function computeDispatchFunnel(
  orders: readonly Order[],
  window: DispatchWindow,
  now: Date,
): OrderPipeline {
  const { from, to } = windowBounds(window, now);

  const withinWindow = orders.filter((order) => {
    const placed = new Date(order.orderDate).getTime();
    return !Number.isNaN(placed) && placed >= from && placed <= to;
  });

  const live = withinWindow.filter((order) => order.status !== 'cancelled');
  return {
    stages: groupOrdersByStatus(live),
    cancelled: withinWindow.length - live.length,
  };
}
