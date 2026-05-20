import { describe, it, expect } from 'vitest';
import {
  allocateOrder,
  buildAllocationNote,
  haversineKm,
  isLineBalanced,
  totalAssigned,
} from '../lib/stockAllocator';
import type { Warehouse } from '../lib/mockWarehouses';
import { mkProduct, mkCartItem } from './fixtures';

const W: ReadonlyArray<Warehouse> = [
  { id: 'syd', name: 'Sydney DC', address: '', lat: -33.8651, lng: 151.0455 },
  { id: 'mel', name: 'Melbourne DC', address: '', lat: -37.8417, lng: 144.7716 },
  { id: 'bne', name: 'Brisbane DC', address: '', lat: -27.6614, lng: 153.0228 },
];

const SYDNEY_COORDS = { lat: -33.87, lng: 151.21 };
const MELBOURNE_COORDS = { lat: -37.81, lng: 144.96 };

describe('haversineKm', () => {
  it('returns 0 for identical points', () => {
    expect(haversineKm(SYDNEY_COORDS, SYDNEY_COORDS)).toBeCloseTo(0, 5);
  });

  it('matches the known Sydney → Melbourne distance (~700–730 km)', () => {
    const km = haversineKm(SYDNEY_COORDS, MELBOURNE_COORDS);
    expect(km).toBeGreaterThan(700);
    expect(km).toBeLessThan(740);
  });
});

describe('allocateOrder', () => {
  const product = mkProduct({ id: 1, name: 'Coca-Cola 330ml' });

  it('allocates fully from the nearest warehouse when it has stock', () => {
    const lines = allocateOrder({
      items: [mkCartItem(product, 5)],
      warehouses: W,
      stockByWarehouse: { 1: { syd: 100, mel: 100, bne: 100 } },
      hoReCaCoords: SYDNEY_COORDS,
    });
    expect(lines).toHaveLength(1);
    expect(lines[0].allocations).toEqual([{ warehouseId: 'syd', qty: 5 }]);
    expect(lines[0].shortBy).toBe(0);
    expect(isLineBalanced(lines[0])).toBe(true);
  });

  it('splits across warehouses when nearest is short', () => {
    const lines = allocateOrder({
      items: [mkCartItem(product, 12)],
      warehouses: W,
      stockByWarehouse: { 1: { syd: 4, mel: 100, bne: 100 } },
      hoReCaCoords: SYDNEY_COORDS,
    });
    expect(lines[0].allocations.length).toBeGreaterThan(1);
    expect(totalAssigned(lines[0])).toBe(12);
    expect(lines[0].shortBy).toBe(0);
    // Sydney drained first
    expect(lines[0].allocations[0]).toEqual({ warehouseId: 'syd', qty: 4 });
  });

  it('marks line as short when total stock < requested', () => {
    const lines = allocateOrder({
      items: [mkCartItem(product, 20)],
      warehouses: W,
      stockByWarehouse: { 1: { syd: 5, mel: 5, bne: 3 } },
      hoReCaCoords: SYDNEY_COORDS,
    });
    expect(totalAssigned(lines[0])).toBe(13);
    expect(lines[0].shortBy).toBe(7);
    expect(isLineBalanced(lines[0])).toBe(false);
  });

  it('falls back to the first warehouse origin when HoReCa coords missing', () => {
    const lines = allocateOrder({
      items: [mkCartItem(product, 1)],
      warehouses: W,
      stockByWarehouse: { 1: { syd: 0, mel: 5, bne: 5 } },
      hoReCaCoords: null,
    });
    // Origin is Sydney (first warehouse). Sydney has 0, so closest WITH stock
    // by distance from Sydney is the next warehouse the sort surfaces.
    expect(totalAssigned(lines[0])).toBe(1);
    expect(['mel', 'bne']).toContain(lines[0].allocations[0].warehouseId);
  });

  it('is deterministic for identical input', () => {
    const args = {
      items: [mkCartItem(product, 9)],
      warehouses: W,
      stockByWarehouse: { 1: { syd: 4, mel: 3, bne: 10 } },
      hoReCaCoords: MELBOURNE_COORDS,
    };
    const a = allocateOrder(args);
    const b = allocateOrder(args);
    expect(a).toEqual(b);
  });
});

describe('buildAllocationNote', () => {
  it('formats a single line with one warehouse', () => {
    const note = buildAllocationNote(
      [
        {
          lineKey: '1__unit',
          productId: 1,
          productName: 'Bread',
          requestedQty: 6,
          allocations: [{ warehouseId: 'syd', qty: 6 }],
          shortBy: 0,
        },
      ],
      W,
    );
    expect(note).toBe('Allocated: Bread ×6 — Sydney DC 6');
  });

  it('formats multiple lines with splits and a short marker', () => {
    const note = buildAllocationNote(
      [
        {
          lineKey: '1__unit',
          productId: 1,
          productName: 'Coca-Cola 330ml',
          requestedQty: 12,
          allocations: [
            { warehouseId: 'syd', qty: 8 },
            { warehouseId: 'mel', qty: 4 },
          ],
          shortBy: 0,
        },
        {
          lineKey: '2__unit',
          productId: 2,
          productName: 'Bread',
          requestedQty: 10,
          allocations: [{ warehouseId: 'syd', qty: 6 }],
          shortBy: 4,
        },
      ],
      W,
    );
    expect(note).toContain('Coca-Cola 330ml ×12 — Sydney DC 8, Melbourne DC 4');
    expect(note).toContain('Bread ×10 — Sydney DC 6 (short 4)');
  });
});
