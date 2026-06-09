import { describe, it, expect } from 'vitest';
import {
  MAIN_WAREHOUSE,
  buildSingleWarehouseLines,
  buildSingleWarehouseNote,
} from '../lib/singleWarehouse';
import { isLineBalanced, totalAssigned } from '../lib/stockAllocator';
import type { Order } from '../types';
import { mkProduct, mkHoReCa, mkUser, mkCartItem } from './fixtures';

const mkOrder = (items: Order['items']): Order => ({
  id: 'O-1',
  hoReCa: mkHoReCa(),
  items,
  total: 0,
  orderDate: '2026-06-01T00:00:00Z',
  submittedBy: mkUser(),
  status: 'processing',
  statusHistory: [],
});

describe('buildSingleWarehouseLines', () => {
  it('assigns the full requested qty to Main Warehouse when inventory covers it', () => {
    const product = mkProduct({ id: 1, name: 'Coca-Cola 330ml', inventory: 40 });
    const lines = buildSingleWarehouseLines(mkOrder([mkCartItem(product, 12)]));

    expect(lines).toHaveLength(1);
    expect(lines[0].allocations).toEqual([{ warehouseId: MAIN_WAREHOUSE.id, qty: 12 }]);
    expect(lines[0].shortBy).toBe(0);
    expect(totalAssigned(lines[0])).toBe(12);
    expect(isLineBalanced(lines[0])).toBe(true);
  });

  it('marks the line short when inventory is below requested', () => {
    const product = mkProduct({ id: 2, name: 'Bread', inventory: 6 });
    const lines = buildSingleWarehouseLines(mkOrder([mkCartItem(product, 10)]));

    expect(lines[0].allocations).toEqual([{ warehouseId: MAIN_WAREHOUSE.id, qty: 6 }]);
    expect(lines[0].shortBy).toBe(4);
    expect(isLineBalanced(lines[0])).toBe(false);
  });

  it('produces no allocation when on-hand is zero', () => {
    const product = mkProduct({ id: 3, name: 'Rice', inventory: 0 });
    const lines = buildSingleWarehouseLines(mkOrder([mkCartItem(product, 5)]));

    expect(lines[0].allocations).toEqual([]);
    expect(lines[0].shortBy).toBe(5);
  });

  it('floors fractional inventory and treats missing inventory as zero', () => {
    const fractional = mkProduct({ id: 4, name: 'Sauce', inventory: 7.9 });
    const missing = mkProduct({ id: 5, name: 'Noodles', inventory: undefined as unknown as number });
    const lines = buildSingleWarehouseLines(
      mkOrder([mkCartItem(fractional, 10), mkCartItem(missing, 3)]),
    );

    expect(lines[0].allocations).toEqual([{ warehouseId: MAIN_WAREHOUSE.id, qty: 7 }]);
    expect(lines[0].shortBy).toBe(3);
    expect(lines[1].allocations).toEqual([]);
    expect(lines[1].shortBy).toBe(3);
  });

  it('uses a stable line key that encodes pack size', () => {
    const product = mkProduct({ id: 6, name: 'Oil', inventory: 50 });
    const lines = buildSingleWarehouseLines(mkOrder([mkCartItem(product, 4, 6)]));

    expect(lines[0].lineKey).toBe('6__6');
    expect(lines[0].packSize).toBe(6);
  });
});

describe('buildSingleWarehouseNote', () => {
  it('formats a balanced single line', () => {
    const product = mkProduct({ id: 1, name: 'Coca-Cola 330ml', inventory: 40 });
    const lines = buildSingleWarehouseLines(mkOrder([mkCartItem(product, 12)]));

    expect(buildSingleWarehouseNote(lines)).toBe(
      'Allocated from Main Warehouse: Coca-Cola 330ml ×12',
    );
  });

  it('formats multiple lines with a short marker', () => {
    const cola = mkProduct({ id: 1, name: 'Coca-Cola 330ml', inventory: 40 });
    const bread = mkProduct({ id: 2, name: 'Bread', inventory: 6 });
    const lines = buildSingleWarehouseLines(
      mkOrder([mkCartItem(cola, 12), mkCartItem(bread, 10)]),
    );

    expect(buildSingleWarehouseNote(lines)).toBe(
      'Allocated from Main Warehouse: Coca-Cola 330ml ×12; Bread ×10 (short 4)',
    );
  });
});
