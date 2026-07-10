import { describe, it, expect } from 'vitest';
import {
  computeStockHealth,
  computeDispatchFunnel,
  type DispatchWindow,
} from '@/services/inventoryDashboardService';
import type { Order, OrderStatus, Product } from '@/types';

function makeProduct(overrides: Partial<Product>): Product {
  return {
    id: 1,
    sku: 'SKU-1',
    name: 'Test Product',
    description: '',
    price: 10,
    category: 'Other',
    inventory: 100,
    unit: 'jar',
    cartonSize: 12,
    supplierId: 1,
    ...overrides,
  } as Product;
}

function makeOrder(overrides: Partial<Order>): Order {
  return {
    id: 'O-1',
    hoReCa: { id: 1, name: 'Test HoReCa' } as unknown as Order['hoReCa'],
    items: [],
    total: 100,
    orderDate: '2026-06-01T00:00:00.000Z',
    submittedBy: { id: 'u1', name: 'Rep' } as unknown as Order['submittedBy'],
    status: 'processing',
    statusHistory: [],
    ...overrides,
  } as Order;
}

describe('computeStockHealth', () => {
  it('classifies out-of-stock when inventory <= 0', () => {
    const result = computeStockHealth([makeProduct({ inventory: 0 }), makeProduct({ inventory: -5 })], 10);
    expect(result.outOfStock).toBe(2);
    expect(result.lowStock).toBe(0);
    expect(result.inStock).toBe(0);
  });

  it('marks low stock using per-product reorderPoint', () => {
    const result = computeStockHealth([makeProduct({ inventory: 5, reorderPoint: 8 })], 2);
    expect(result.lowStock).toBe(1);
    expect(result.inStock).toBe(0);
  });

  it('falls back to lowStockThreshold when no reorderPoint set', () => {
    const result = computeStockHealth([makeProduct({ inventory: 9, reorderPoint: undefined })], 10);
    expect(result.lowStock).toBe(1);
  });

  it('counts healthy stock as in-stock', () => {
    const result = computeStockHealth([makeProduct({ inventory: 50, reorderPoint: 10 })], 10);
    expect(result.inStock).toBe(1);
    expect(result.lowStock).toBe(0);
  });

  it('excludes inactive products', () => {
    const result = computeStockHealth(
      [makeProduct({ inventory: 50, isActive: false }), makeProduct({ inventory: 50, isActive: true })],
      10,
    );
    expect(result.total).toBe(1);
    expect(result.inStock).toBe(1);
  });

  it('totals add up across buckets', () => {
    const result = computeStockHealth(
      [
        makeProduct({ inventory: 0 }), // out
        makeProduct({ inventory: 5, reorderPoint: 10 }), // low
        makeProduct({ inventory: 100, reorderPoint: 10 }), // in
      ],
      10,
    );
    expect(result).toEqual({ inStock: 1, lowStock: 1, outOfStock: 1, total: 3 });
  });

  it('classifies inventory <= 0 as out-of-stock (boundary preserved after refactor)', () => {
    const result = computeStockHealth([makeProduct({ inventory: 0 }), makeProduct({ inventory: -1 })], 10);
    expect(result.outOfStock).toBe(2);
  });

  it('classifies inventory == threshold as low stock (inclusive boundary preserved)', () => {
    const result = computeStockHealth([makeProduct({ inventory: 10, reorderPoint: undefined })], 10);
    expect(result.lowStock).toBe(1);
    expect(result.inStock).toBe(0);
  });

  it('per-product reorderPoint still wins over the global threshold after the refactor', () => {
    // Global threshold (2) would call this in-stock; the product's own reorderPoint (8) makes it low.
    const result = computeStockHealth([makeProduct({ inventory: 5, reorderPoint: 8 })], 2);
    expect(result.lowStock).toBe(1);
    expect(result.inStock).toBe(0);
  });

  it('an injected onHandOf buckets the same product set differently than the global default', () => {
    const products = [
      makeProduct({ id: 1, inventory: 50 }), // globally in-stock
      makeProduct({ id: 2, inventory: 0 }), // globally out-of-stock
    ];

    const globalResult = computeStockHealth(products, 10);
    expect(globalResult).toEqual({ inStock: 1, lowStock: 0, outOfStock: 1, total: 2 });

    // Scoped view: product 1 has none at this site, product 2 has plenty.
    const scopedOnHand = new Map<number, number>([
      [1, 0],
      [2, 50],
    ]);
    const scopedResult = computeStockHealth(products, 10, (p) => scopedOnHand.get(p.id) ?? 0);
    expect(scopedResult).toEqual({ inStock: 1, lowStock: 0, outOfStock: 1, total: 2 });
    // Same total buckets, but the membership flipped: product 1 is now out, product 2 is now in.
    expect(computeStockHealth([products[0]], 10, (p) => scopedOnHand.get(p.id) ?? 0).outOfStock).toBe(1);
    expect(computeStockHealth([products[1]], 10, (p) => scopedOnHand.get(p.id) ?? 0).inStock).toBe(1);
  });

  it('still excludes inactive products when onHandOf is injected', () => {
    const result = computeStockHealth(
      [makeProduct({ id: 1, inventory: 999, isActive: false })],
      10,
      () => 999,
    );
    expect(result.total).toBe(0);
  });
});

describe('computeDispatchFunnel', () => {
  const now = new Date('2026-06-09T12:00:00.000Z');

  it('returns all six stages in pipeline order, zero-filled on empty input', () => {
    const result = computeDispatchFunnel([], 30, now);
    expect(result.map((s) => s.status)).toEqual<OrderStatus[]>([
      'processing',
      'processed',
      'picked',
      'packed',
      'dispatched',
      'delivered',
    ]);
    expect(result.every((s) => s.count === 0)).toBe(true);
  });

  it('groups orders by current status within the window', () => {
    const orders: Order[] = [
      makeOrder({ id: 'a', status: 'processing', orderDate: '2026-06-08T00:00:00.000Z' }),
      makeOrder({ id: 'b', status: 'processing', orderDate: '2026-06-07T00:00:00.000Z' }),
      makeOrder({ id: 'c', status: 'dispatched', orderDate: '2026-06-05T00:00:00.000Z' }),
    ];
    const result = computeDispatchFunnel(orders, 30, now);
    const byStatus = Object.fromEntries(result.map((s) => [s.status, s.count]));
    expect(byStatus.processing).toBe(2);
    expect(byStatus.dispatched).toBe(1);
    expect(byStatus.delivered).toBe(0);
  });

  it('excludes orders older than the window', () => {
    const orders: Order[] = [
      makeOrder({ id: 'recent', status: 'picked', orderDate: '2026-06-08T00:00:00.000Z' }),
      makeOrder({ id: 'old', status: 'picked', orderDate: '2026-05-01T00:00:00.000Z' }), // ~39d ago
    ];
    const within7 = computeDispatchFunnel(orders, 7, now);
    const within90 = computeDispatchFunnel(orders, 90, now);
    expect(within7.find((s) => s.status === 'picked')?.count).toBe(1);
    expect(within90.find((s) => s.status === 'picked')?.count).toBe(2);
  });

  it('honours each window boundary', () => {
    const orders: Order[] = [makeOrder({ status: 'packed', orderDate: '2026-05-20T00:00:00.000Z' })]; // ~20d ago
    const windows: DispatchWindow[] = [7, 30, 90];
    const counts = windows.map(
      (w) => computeDispatchFunnel(orders, w, now).find((s) => s.status === 'packed')?.count ?? 0,
    );
    expect(counts).toEqual([0, 1, 1]);
  });

  it('ignores orders with unparseable dates', () => {
    const orders: Order[] = [makeOrder({ status: 'processed', orderDate: 'not-a-date' })];
    const result = computeDispatchFunnel(orders, 30, now);
    expect(result.find((s) => s.status === 'processed')?.count).toBe(0);
  });
});
