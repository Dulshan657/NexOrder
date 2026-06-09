/**
 * Distance-based multi-warehouse allocator.
 *
 * RESERVED FOR V2 — `allocateOrder` / `buildAllocationNote` / `deriveHoReCaCoords`
 * are not wired into the v1 Order-Import UI, which assumes ONE warehouse
 * (see lib/singleWarehouse.ts). The shared, warehouse-agnostic helpers
 * (`lineKeyFor`, `isLineBalanced`, `totalAssigned`) and the `AllocatedLine` /
 * `LineAllocation` types are still used by the single-warehouse flow. Kept on
 * disk and unit-tested so a future release can re-enable multi-warehouse.
 */
import type { Order, OrderItem } from '../types';
import type { Warehouse } from './mockWarehouses';

export interface LineAllocation {
  warehouseId: string;
  qty: number;
}

export interface AllocatedLine {
  lineKey: string;
  productId: number;
  productName: string;
  packSize?: number;
  requestedQty: number;
  allocations: LineAllocation[];
  shortBy: number;
}

export interface AllocateInput {
  items: OrderItem[];
  warehouses: ReadonlyArray<Warehouse>;
  /** productId → warehouseId → on-hand qty */
  stockByWarehouse: Record<number, Record<string, number>>;
  hoReCaCoords: { lat: number; lng: number } | null;
}

const EARTH_RADIUS_KM = 6371;

export function haversineKm(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Stable line key so manual edits survive re-allocation. */
export function lineKeyFor(item: OrderItem): string {
  return `${item.id}__${item.packSize ?? 'unit'}`;
}

/**
 * Pure allocator. Sorts warehouses by distance to the HoReCa, then greedily
 * fills each line from the closest warehouse with stock; remainder spills to
 * the next-closest. Splitting a line across warehouses is allowed.
 *
 * If `hoReCaCoords` is null, the first warehouse (by array order) is treated
 * as the origin so the optimizer still produces a stable, repeatable result.
 */
export function allocateOrder(input: AllocateInput): AllocatedLine[] {
  const { items, warehouses, stockByWarehouse, hoReCaCoords } = input;

  if (warehouses.length === 0) return [];

  const origin = hoReCaCoords ?? { lat: warehouses[0].lat, lng: warehouses[0].lng };

  const orderedWarehouseIds = [...warehouses]
    .map((w) => ({ id: w.id, dist: haversineKm(origin, { lat: w.lat, lng: w.lng }) }))
    .sort((a, b) => a.dist - b.dist)
    .map((w) => w.id);

  return items.map<AllocatedLine>((item) => {
    let remaining = item.quantity;
    const allocations: LineAllocation[] = [];
    const stockForProduct = stockByWarehouse[item.id] ?? {};

    for (const wid of orderedWarehouseIds) {
      if (remaining <= 0) break;
      const available = Math.max(0, Math.floor(stockForProduct[wid] ?? 0));
      if (available === 0) continue;
      const take = Math.min(available, remaining);
      allocations.push({ warehouseId: wid, qty: take });
      remaining -= take;
    }

    return {
      lineKey: lineKeyFor(item),
      productId: item.id,
      productName: item.name,
      packSize: item.packSize,
      requestedQty: item.quantity,
      allocations,
      shortBy: Math.max(0, remaining),
    };
  });
}

/**
 * Build the human-readable status note appended to status_history when
 * processing → confirmed. Example:
 *   "Allocated: Coca-Cola 330ml ×12 — Sydney DC 8, Melbourne DC 4; Bread ×6 — Sydney DC 6"
 */
export function buildAllocationNote(
  lines: AllocatedLine[],
  warehouses: ReadonlyArray<Warehouse>,
): string {
  const nameById = new Map(warehouses.map((w) => [w.id, w.name]));
  const parts = lines.map((line) => {
    const allocStr = line.allocations
      .filter((a) => a.qty > 0)
      .map((a) => `${nameById.get(a.warehouseId) ?? a.warehouseId} ${a.qty}`)
      .join(', ');
    const shortSuffix = line.shortBy > 0 ? ` (short ${line.shortBy})` : '';
    return `${line.productName} ×${line.requestedQty} — ${allocStr || 'unassigned'}${shortSuffix}`;
  });
  return `Allocated: ${parts.join('; ')}`;
}

/** Convenience accessor to compute the per-line summed total across allocations. */
export function totalAssigned(line: AllocatedLine): number {
  return line.allocations.reduce((sum, a) => sum + a.qty, 0);
}

export function isLineBalanced(line: AllocatedLine): boolean {
  return totalAssigned(line) === line.requestedQty;
}

export function deriveHoReCaCoords(order: Order): { lat: number; lng: number } | null {
  const lat = order.hoReCa?.lat;
  const lng = order.hoReCa?.lng;
  if (typeof lat === 'number' && typeof lng === 'number') {
    return { lat, lng };
  }
  return null;
}
