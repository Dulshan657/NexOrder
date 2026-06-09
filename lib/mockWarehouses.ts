/**
 * Frontend-only mock warehouse layer for the Order Import → Receiving flow.
 *
 * RESERVED FOR V2 — multi-warehouse allocation is disabled for v1, which
 * assumes ONE warehouse (see lib/singleWarehouse.ts). This module is kept on
 * disk (and still unit-tested) so a future release can re-enable the
 * multi-warehouse UI, but it is no longer wired into the v1 Order-Import UI.
 *
 * Replace this module with a real WMS adapter when one is wired up. The shape
 * of WAREHOUSES and the `getMockStockByWarehouse` helper is the contract the
 * allocator and the StockAssignmentModal depend on.
 */

export interface Warehouse {
  id: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
}

export const WAREHOUSES: ReadonlyArray<Warehouse> = [
  {
    id: 'syd',
    name: 'Sydney DC',
    address: '12 Parramatta Rd, Lidcombe NSW 2141',
    lat: -33.8651,
    lng: 151.0455,
  },
  {
    id: 'mel',
    name: 'Melbourne DC',
    address: '88 Cherry Lane, Laverton North VIC 3026',
    lat: -37.8417,
    lng: 144.7716,
  },
  {
    id: 'bne',
    name: 'Brisbane DC',
    address: '5 Logistics Pl, Larapinta QLD 4110',
    lat: -27.6614,
    lng: 153.0228,
  },
];

/**
 * Deterministic per-warehouse stock split. Same productId + totalInventory
 * always returns the same numbers, so re-renders don't surprise the user
 * with shifting allocations.
 *
 * Strategy: 50 / 30 / 20 split rounded to integers, with the rounding
 * remainder dropped into the largest bucket. For very small totals (< 6)
 * we collapse to a single warehouse so the modal isn't full of zeroes.
 */
export function getMockStockByWarehouse(
  productId: number,
  totalInventory: number,
): Record<string, number> {
  const total = Math.max(0, Math.floor(totalInventory));

  if (total === 0) {
    return { syd: 0, mel: 0, bne: 0 };
  }

  if (total < 6) {
    const idx = productId % WAREHOUSES.length;
    return {
      syd: idx === 0 ? total : 0,
      mel: idx === 1 ? total : 0,
      bne: idx === 2 ? total : 0,
    };
  }

  const syd = Math.floor(total * 0.5);
  const mel = Math.floor(total * 0.3);
  const bne = Math.floor(total * 0.2);
  const remainder = total - (syd + mel + bne);

  return {
    syd: syd + remainder,
    mel,
    bne,
  };
}
