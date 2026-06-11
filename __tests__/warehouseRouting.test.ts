import { describe, it, expect } from 'vitest';
import {
  haversineKm,
  orderedWarehousesFor,
  isRoutable,
  type RoutableWarehouse,
} from '../lib/warehouseRouting';
import {
  orderedWarehousesFor as orderedWarehousesForShared,
  haversineKm as haversineKmShared,
} from '../supabase/functions/_shared/warehouseRouting';

const wh = (overrides: Partial<RoutableWarehouse> & { id: number }): RoutableWarehouse => ({
  isActive: true,
  locationType: 'bulk',
  ...overrides,
});

// Approx real coords used elsewhere in the app's mock layer.
const SYD = { lat: -33.8651, lng: 151.0455 };
const MEL = { lat: -37.8417, lng: 144.7716 };
const BNE = { lat: -27.6614, lng: 153.0228 };

describe('haversineKm', () => {
  it('is zero for identical points', () => {
    expect(haversineKm(SYD, SYD)).toBeCloseTo(0, 5);
  });

  it('matches a known Sydney–Melbourne distance (~700km) within tolerance', () => {
    const d = haversineKm(SYD, MEL);
    expect(d).toBeGreaterThan(650);
    expect(d).toBeLessThan(760);
  });
});

describe('orderedWarehousesFor', () => {
  const warehouses: RoutableWarehouse[] = [
    wh({ id: 1, lat: SYD.lat, lng: SYD.lng }),
    wh({ id: 2, lat: MEL.lat, lng: MEL.lng }),
    wh({ id: 3, lat: BNE.lat, lng: BNE.lng }),
  ];

  it('orders all active warehouses closest-first from the origin', () => {
    // A customer in Melbourne should get MEL(2) first, then SYD(1), then BNE(3).
    expect(orderedWarehousesFor(MEL, warehouses)).toEqual([2, 1, 3]);
    // A customer in Brisbane should get BNE(3), then SYD(1), then MEL(2).
    expect(orderedWarehousesFor(BNE, warehouses)).toEqual([3, 1, 2]);
  });

  it('falls back to id-ascending order when the customer has no coordinates', () => {
    expect(orderedWarehousesFor(null, warehouses)).toEqual([1, 2, 3]);
  });

  it('excludes inactive warehouses', () => {
    const list = [...warehouses, wh({ id: 4, lat: SYD.lat, lng: SYD.lng, isActive: false })];
    expect(orderedWarehousesFor(SYD, list)).not.toContain(4);
  });

  it('excludes racked warehouses (not routable until directed ops exist)', () => {
    const list = [...warehouses, wh({ id: 5, lat: SYD.lat, lng: SYD.lng, locationType: 'racked' })];
    expect(orderedWarehousesFor(SYD, list)).not.toContain(5);
  });

  it('sinks warehouses without coordinates to the end (id-ascending among them)', () => {
    const list = [
      wh({ id: 1, lat: MEL.lat, lng: MEL.lng }),
      wh({ id: 2 }), // no coords
      wh({ id: 3, lat: SYD.lat, lng: SYD.lng }),
    ];
    // Origin Melbourne: MEL(1) closest, then SYD(3), then the coordless 2 last.
    expect(orderedWarehousesFor(MEL, list)).toEqual([1, 3, 2]);
  });

  it('breaks ties deterministically by id', () => {
    const list = [
      wh({ id: 7, lat: SYD.lat, lng: SYD.lng }),
      wh({ id: 2, lat: SYD.lat, lng: SYD.lng }),
    ];
    expect(orderedWarehousesFor(SYD, list)).toEqual([2, 7]);
  });

  it('returns an empty list when nothing is routable', () => {
    expect(orderedWarehousesFor(SYD, [wh({ id: 1, isActive: false })])).toEqual([]);
  });
});

describe('isRoutable', () => {
  it('is true only for active, non-racked warehouses', () => {
    expect(isRoutable(wh({ id: 1 }))).toBe(true);
    expect(isRoutable(wh({ id: 1, isActive: false }))).toBe(false);
    expect(isRoutable(wh({ id: 1, locationType: 'racked' }))).toBe(false);
  });
});

describe('lib/_shared warehouseRouting parity', () => {
  it('produces identical ordering and distances across the twin modules', () => {
    const warehouses: RoutableWarehouse[] = [
      wh({ id: 1, lat: SYD.lat, lng: SYD.lng }),
      wh({ id: 2, lat: MEL.lat, lng: MEL.lng }),
      wh({ id: 3, lat: BNE.lat, lng: BNE.lng }),
    ];
    for (const origin of [SYD, MEL, BNE, null]) {
      expect(orderedWarehousesForShared(origin, warehouses)).toEqual(
        orderedWarehousesFor(origin, warehouses),
      );
    }
    expect(haversineKmShared(SYD, MEL)).toBeCloseTo(haversineKm(SYD, MEL), 9);
  });
});
