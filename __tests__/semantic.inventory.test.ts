import { describe, it, expect } from 'vitest'

import { evaluateMetric } from '../lib/semantic/evaluate'
import type { MetricContext } from '../lib/semantic/types'
import { makeOrder, makeProduct } from './support/metricFixtures'

// The inventory domain's rule: a metric either wraps an existing pure helper
// (classifyStock / lowStockThresholdFor / computeStockHealth) or reads a
// DB-computed field. It never re-derives what Postgres already computes.

const products = [
  makeProduct({ id: 1, name: 'Healthy', inventory: 100, available: 90 }),
  makeProduct({ id: 2, name: 'At threshold', inventory: 10, available: 10 }),
  makeProduct({ id: 3, name: 'Below threshold', inventory: 3, available: 3 }),
  makeProduct({ id: 4, name: 'Empty', inventory: 0, available: 0 }),
  makeProduct({ id: 5, name: 'Own reorder point', inventory: 40, available: 40, reorderPoint: 50 }),
  makeProduct({ id: 6, name: 'Retired', inventory: 0, available: 0, isActive: false }),
]

const ctx: MetricContext = {
  orders: [],
  products,
  settings: { lowStockThreshold: 10 },
  now: new Date('2026-07-20T00:00:00.000Z'),
}

describe('inventory.stockHealth', () => {
  it('buckets active products, honouring per-product reorder points', () => {
    const out = evaluateMetric('inventory.stockHealth', ctx, {}) as {
      inStock: number
      lowStock: number
      outOfStock: number
      total: number
    }
    // Healthy in stock; "At threshold" is low (<= is the canonical boundary);
    // "Below threshold" low; "Own reorder point" low at 40 <= 50; Empty out.
    // "Retired" is excluded entirely.
    expect(out).toEqual({ inStock: 1, lowStock: 3, outOfStock: 1, total: 5 })
  })
})

describe('inventory.lowStockProducts', () => {
  it('uses the canonical <= boundary, not the dashboards old strict <', () => {
    const out = evaluateMetric('inventory.lowStockProducts', ctx, {}) as ReadonlyArray<{ id: number }>
    const ids = out.map(p => p.id)
    // 2 is exactly AT the threshold. The old inline rule
    // (`inventory > 0 && inventory < lowStockThreshold`) excluded it; the
    // canonical classifyStock includes it. This is the intended unification.
    expect(ids).toContain(2)
    // 5 sits above the global threshold but below its own reorder point. The
    // old inline rule ignored reorderPoint entirely and missed it.
    expect(ids).toContain(5)
    // Out-of-stock is its own bucket, not "low".
    expect(ids).not.toContain(4)
    // Inactive products are never alerted on.
    expect(ids).not.toContain(6)
  })
})

describe('inventory.outOfStockProducts / counts', () => {
  it('counts out-of-stock active products', () => {
    expect(evaluateMetric('inventory.outOfStockCount', ctx, {})).toBe(1)
  })

  it('counts low-stock active products', () => {
    expect(evaluateMetric('inventory.lowStockCount', ctx, {})).toBe(3)
  })
})

describe('inventory.onHandUnits vs availableUnits', () => {
  it('reads the two distinct caches and does not conflate them', () => {
    // Active only: 100 + 10 + 3 + 0 + 40 = 153 on hand.
    expect(evaluateMetric('inventory.onHandUnits', ctx, {})).toBe(153)
    // 90 + 10 + 3 + 0 + 40 = 143 available — the difference is allocated stock.
    expect(evaluateMetric('inventory.availableUnits', ctx, {})).toBe(143)
  })
})

describe('inventory.dispatchFunnel', () => {
  it('is the same definition as sales.ordersByStatus', () => {
    const withOrders: MetricContext = {
      ...ctx,
      orders: [
        makeOrder({ id: 'A', status: 'picked', orderDate: '2026-07-19T00:00:00.000Z' }),
        makeOrder({ id: 'B', status: 'delivered', orderDate: '2026-07-19T00:00:00.000Z' }),
      ],
    }
    const funnel = evaluateMetric('inventory.dispatchFunnel', withOrders, {})
    const byStatus = evaluateMetric('sales.ordersByStatus', withOrders, {})
    expect(funnel).toEqual(byStatus)
  })
})
