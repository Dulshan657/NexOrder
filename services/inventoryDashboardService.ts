import type { Order, OrderStatus, Product } from '@/types';

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
 * Classify active products into in-stock / low-stock / out-of-stock buckets from
 * their on-hand cache (`inventory`). A product is "low" when its on-hand falls to
 * or below its per-product `reorderPoint`, falling back to the dashboard-wide
 * `lowStockThreshold` when no reorder point is configured. Inactive products
 * (`isActive === false`) are excluded.
 */
export function computeStockHealth(
  products: readonly Product[],
  lowStockThreshold: number,
): StockHealth {
  let inStock = 0;
  let lowStock = 0;
  let outOfStock = 0;

  for (const product of products) {
    if (product.isActive === false) continue;

    const onHand = product.inventory;
    if (onHand <= 0) {
      outOfStock += 1;
      continue;
    }

    const threshold = product.reorderPoint ?? lowStockThreshold;
    if (onHand <= threshold) {
      lowStock += 1;
    } else {
      inStock += 1;
    }
  }

  return { inStock, lowStock, outOfStock, total: inStock + lowStock + outOfStock };
}

export type DispatchWindow = 7 | 30 | 90;

export interface DispatchFunnelStage {
  status: OrderStatus;
  label: string;
  count: number;
}

// Fulfilment pipeline order + human labels. Drives both the funnel ordering and
// the zero-filled stages returned when no orders match.
const FUNNEL_STAGES: readonly { status: OrderStatus; label: string }[] = [
  { status: 'processing', label: 'Processing' },
  { status: 'processed', label: 'Processed' },
  { status: 'picked', label: 'Picked' },
  { status: 'packed', label: 'Packed' },
  { status: 'dispatched', label: 'Dispatched' },
  { status: 'delivered', label: 'Delivered' },
];

/**
 * Count orders placed within the last `windowDays` (relative to the injected
 * `now`) grouped by their current fulfilment status, returned in pipeline order.
 * `now` is a parameter so the function is deterministic and testable.
 */
export function computeDispatchFunnel(
  orders: readonly Order[],
  windowDays: DispatchWindow,
  now: Date,
): DispatchFunnelStage[] {
  const cutoff = now.getTime() - windowDays * 86_400_000;

  const counts = new Map<OrderStatus, number>();
  for (const order of orders) {
    const placed = new Date(order.orderDate).getTime();
    if (Number.isNaN(placed) || placed < cutoff || placed > now.getTime()) continue;
    counts.set(order.status, (counts.get(order.status) ?? 0) + 1);
  }

  return FUNNEL_STAGES.map((stage) => ({
    status: stage.status,
    label: stage.label,
    count: counts.get(stage.status) ?? 0,
  }));
}
