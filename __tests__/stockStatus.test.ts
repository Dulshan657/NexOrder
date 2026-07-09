import { describe, it, expect } from 'vitest';
import { classifyStock, lowStockThresholdFor } from '../lib/stockStatus';
import type { Product } from '../types';

describe('classifyStock', () => {
  it('classifies zero and negative quantities as out of stock', () => {
    expect(classifyStock(0, 10)).toBe('out_of_stock');
    expect(classifyStock(-5, 10)).toBe('out_of_stock');
  });

  it('classifies quantity at the threshold as low stock (inclusive)', () => {
    expect(classifyStock(10, 10)).toBe('low_stock');
    expect(classifyStock(1, 10)).toBe('low_stock');
  });

  it('classifies quantity above the threshold as in stock', () => {
    expect(classifyStock(11, 10)).toBe('in_stock');
    expect(classifyStock(100, 10)).toBe('in_stock');
  });

  it('respects a custom threshold', () => {
    expect(classifyStock(20, 25)).toBe('low_stock');
    expect(classifyStock(26, 25)).toBe('in_stock');
  });
});

describe('lowStockThresholdFor', () => {
  it('prefers the per-product reorderPoint when set', () => {
    const product = { reorderPoint: 25 } as Pick<Product, 'reorderPoint'>;
    expect(lowStockThresholdFor(product, 10)).toBe(25);
  });

  it('falls back to the global threshold when reorderPoint is undefined', () => {
    const product = { reorderPoint: undefined } as Pick<Product, 'reorderPoint'>;
    expect(lowStockThresholdFor(product, 10)).toBe(10);
  });

  it('treats a reorderPoint of 0 as an explicit override, not a fallback', () => {
    const product = { reorderPoint: 0 } as Pick<Product, 'reorderPoint'>;
    expect(lowStockThresholdFor(product, 10)).toBe(0);
  });
});
