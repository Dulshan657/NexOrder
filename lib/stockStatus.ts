import type { Product } from '../types';

export type StockStatus = 'out_of_stock' | 'low_stock' | 'in_stock';

/**
 * The low-stock threshold that applies to a product: the per-product
 * `reorderPoint` wins when set, otherwise the global app setting
 * (`app_settings.low_stock_threshold`). Mirrors `computeStockHealth`
 * in `services/inventoryDashboardService.ts`.
 */
export function lowStockThresholdFor(
  product: Pick<Product, 'reorderPoint'>,
  globalThreshold: number,
): number {
  return product.reorderPoint ?? globalThreshold;
}

/**
 * Classify an available quantity against a threshold. `<= threshold` is
 * low stock (matching the canonical dashboard convention), `<= 0` is out.
 */
export function classifyStock(qty: number, threshold: number): StockStatus {
  if (qty <= 0) return 'out_of_stock';
  if (qty <= threshold) return 'low_stock';
  return 'in_stock';
}
