/**
 * Single-warehouse allocation for the v1 Order-Import → Process flow.
 *
 * v1 assumes ONE warehouse ("Main Warehouse"), matching the seeded WAREHOUSE
 * location in migration 00027 and `inv_default_location()`. The product's full
 * cached `inventory` is treated as the on-hand at that warehouse.
 *
 * The multi-warehouse allocator (lib/stockAllocator.ts) and mock warehouse
 * layer (lib/mockWarehouses.ts) are preserved for a future v2 but are no longer
 * wired into the UI.
 */
import type { Order } from '../types';
import {
  lineKeyFor,
  type AllocatedLine,
} from './stockAllocator';

export const MAIN_WAREHOUSE = { id: 'main', name: 'Main Warehouse' } as const;

/**
 * Build one allocation line per order item, drawing entirely from the single
 * Main Warehouse. On-hand is the product's full cached inventory; the line is
 * short when on-hand can't cover the requested quantity.
 */
export function buildSingleWarehouseLines(order: Order): AllocatedLine[] {
  return order.items.map<AllocatedLine>((item) => {
    const onHand = Math.max(0, Math.floor(item.inventory ?? 0));
    const requested = item.quantity;
    const take = Math.min(onHand, requested);

    return {
      lineKey: lineKeyFor(item),
      productId: item.id,
      productName: item.name,
      packSize: item.packSize,
      requestedQty: requested,
      allocations: take > 0 ? [{ warehouseId: MAIN_WAREHOUSE.id, qty: take }] : [],
      shortBy: Math.max(0, requested - take),
    };
  });
}

/**
 * Human-readable status note appended to status_history on process. Example:
 *   "Allocated from Main Warehouse: Coca-Cola 330ml ×12; Bread ×6 (short 2)"
 */
export function buildSingleWarehouseNote(lines: AllocatedLine[]): string {
  const parts = lines.map((line) => {
    const shortSuffix = line.shortBy > 0 ? ` (short ${line.shortBy})` : '';
    return `${line.productName} ×${line.requestedQty}${shortSuffix}`;
  });
  return `Allocated from ${MAIN_WAREHOUSE.name}: ${parts.join('; ')}`;
}
