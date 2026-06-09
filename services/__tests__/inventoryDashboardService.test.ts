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
