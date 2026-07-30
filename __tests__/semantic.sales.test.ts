import { describe, it, expect } from 'vitest'

import { evaluateMetric } from '../lib/semantic/evaluate'
import { computeTargetAchieved } from '../lib/semantic/targets'
import type { MetricContext } from '../lib/semantic/types'
import { UserRole } from '../types'
import { makeHoReCa, makeItem, makeOrder, makeTarget, makeUser } from './support/metricFixtures'

const repA = makeUser({ id: 1, name: 'Rep A', role: UserRole.FIELD_REP })
const repB = makeUser({ id: 2, name: 'Rep B', role: UserRole.OFFICE_REP })
const admin = makeUser({ id: 3, name: 'Admin', role: UserRole.ADMIN })

const cafe = makeHoReCa({ id: 100, name: 'Cafe One' })
const hotel = makeHoReCa({ id: 200, name: 'Hotel Two' })

// Stored totals deliberately differ from the line sums on ORD-3 so the two
// revenue metrics can be told apart: a promotion knocked $10 off the header.
const orders = [
  makeOrder({
    id: 'ORD-1',
    orderDate: '2026-07-10T09:00:00.000Z',
    hoReCa: cafe,
    submittedBy: repA,
    status: 'delivered',
    total: 100,
    items: [makeItem({ id: 1, name: 'Rice', category: 'Dry Goods', price: 10, quantity: 10 })],
  }),
  makeOrder({
    id: 'ORD-2',
    orderDate: '2026-07-10T15:00:00.000Z',
    hoReCa: hotel,
    submittedBy: repB,
    status: 'processing',
    total: 50,
    items: [makeItem({ id: 2, name: 'Peas', category: 'Frozen', price: 25, quantity: 2 })],
  }),
  makeOrder({
    id: 'ORD-3',
    orderDate: '2026-07-12T09:00:00.000Z',
    hoReCa: cafe,
    submittedBy: admin,
    status: 'delivered',
    total: 90,
    items: [
      makeItem({ id: 3, name: 'Flour', category: 'Dry Goods', price: 20, quantity: 2 }),
      makeItem({ id: 4, name: 'Peas', category: 'Frozen', price: 30, quantity: 2 }),
    ],
  }),
]

const ctx: MetricContext = {
  orders,
  products: [],
  settings: { lowStockThreshold: 10 },
  now: new Date('2026-07-20T00:00:00.000Z'),
}

describe('sales.revenue', () => {
  it('sums the stored order total, not the line items', () => {
    // 100 + 50 + 90 = 240. The line sums would give 250 — ORD-3 carries a $10
    // header-level promotion that re-summing the lines silently discards.
    expect(evaluateMetric('sales.revenue', ctx, {})).toBe(240)
  })

  it('respects the filter', () => {
    expect(evaluateMetric('sales.revenue', ctx, { horecaId: 100 })).toBe(190)
    expect(evaluateMetric('sales.revenue', ctx, { statuses: ['delivered'] })).toBe(190)
  })

  it('refuses a line-level scope instead of returning a number nobody should trust', () => {
    expect(() => evaluateMetric('sales.revenue', ctx, { category: 'Frozen' })).toThrow(
      /line-level scope/i,
    )
  })

  it('is 0 with no matching orders', () => {
    expect(evaluateMetric('sales.revenue', ctx, { horecaId: 999 })).toBe(0)
  })
})

describe('sales.lineRevenue', () => {
  it('sums price x quantity over the surviving lines', () => {
    expect(evaluateMetric('sales.lineRevenue', ctx, {})).toBe(250)
  })

  it('is the correct answer under a category scope', () => {
    // Dry Goods: ORD-1 10x10 = 100, ORD-3 20x2 = 40.
    expect(evaluateMetric('sales.lineRevenue', ctx, { category: 'Dry Goods' })).toBe(140)
    // Frozen: ORD-2 25x2 = 50, ORD-3 30x2 = 60.
    expect(evaluateMetric('sales.lineRevenue', ctx, { category: 'Frozen' })).toBe(110)
  })
})

describe('sales.orderCount / averageOrderValue', () => {
  it('counts filtered orders', () => {
    expect(evaluateMetric('sales.orderCount', ctx, {})).toBe(3)
    expect(evaluateMetric('sales.orderCount', ctx, { horecaId: 100 })).toBe(2)
  })

  it('divides revenue by count', () => {
    expect(evaluateMetric('sales.averageOrderValue', ctx, {})).toBe(80)
  })

  it('is 0 rather than NaN when nothing matches', () => {
    expect(evaluateMetric('sales.averageOrderValue', ctx, { horecaId: 999 })).toBe(0)
  })
})

describe('sales.ordersByStatus', () => {
  it('returns every stage in pipeline order, zero-filled', () => {
    const out = evaluateMetric('sales.ordersByStatus', ctx, {}) as ReadonlyArray<{
      status: string
      label: string
      count: number
    }>
    expect(out.map(s => s.status)).toEqual([
      'processing', 'processed', 'picked', 'packed', 'dispatched', 'delivered',
    ])
    expect(out.find(s => s.status === 'delivered')?.count).toBe(2)
    expect(out.find(s => s.status === 'picked')?.count).toBe(0)
    expect(out.find(s => s.status === 'processing')?.label).toBe('Processing')
  })
})

describe('sales.revenueByDate', () => {
  it('groups stored totals by calendar day, ascending', () => {
    const out = evaluateMetric('sales.revenueByDate', ctx, {}) as ReadonlyArray<{
      date: string
      revenue: number
    }>
    expect(out).toEqual([
      { date: '2026-07-10', revenue: 150 },
      { date: '2026-07-12', revenue: 90 },
    ])
  })
})

describe('sales.revenueByCustomer', () => {
  it('ranks customers by revenue descending', () => {
    const out = evaluateMetric('sales.revenueByCustomer', ctx, {}) as ReadonlyArray<{
      horecaId: number
      name: string
      revenue: number
    }>
    expect(out).toEqual([
      { horecaId: 100, name: 'Cafe One', revenue: 190 },
      { horecaId: 200, name: 'Hotel Two', revenue: 50 },
    ])
  })
})

describe('sales.revenueByRep', () => {
  it('counts only field and office reps, so an admin order is not rep credit', () => {
    const out = evaluateMetric('sales.revenueByRep', ctx, {}) as ReadonlyArray<{
      repId: number
      name: string
      revenue: number
    }>
    expect(out.map(r => r.name)).toEqual(['Rep A', 'Rep B'])
    expect(out.find(r => r.repId === 1)?.revenue).toBe(100)
  })
})

describe('sales.unitsByProduct / revenueByCategory', () => {
  it('sums units per product name across orders, descending', () => {
    const out = evaluateMetric('sales.unitsByProduct', ctx, {}) as ReadonlyArray<{
      name: string
      units: number
    }>
    expect(out).toEqual([
      { name: 'Rice', units: 10 },
      { name: 'Peas', units: 4 },
      { name: 'Flour', units: 2 },
    ])
  })

  it('sums line revenue per category, descending', () => {
    const out = evaluateMetric('sales.revenueByCategory', ctx, {}) as ReadonlyArray<{
      category: string
      revenue: number
    }>
    expect(out).toEqual([
      { category: 'Dry Goods', revenue: 140 },
      { category: 'Frozen', revenue: 110 },
    ])
  })
})

describe('sales.newCustomerCount', () => {
  it('counts customers whose first order by that rep falls inside the window', () => {
    const history = [
      makeOrder({ id: 'OLD', orderDate: '2026-06-01T00:00:00.000Z', hoReCa: cafe, submittedBy: repA, total: 10 }),
      makeOrder({ id: 'NEW', orderDate: '2026-07-10T00:00:00.000Z', hoReCa: hotel, submittedBy: repA, total: 10 }),
      makeOrder({ id: 'REPEAT', orderDate: '2026-07-11T00:00:00.000Z', hoReCa: cafe, submittedBy: repA, total: 10 }),
    ]
    const historyCtx: MetricContext = { ...ctx, orders: history }
    const count = evaluateMetric('sales.newCustomerCount', historyCtx, {
      from: new Date('2026-07-01T00:00:00.000Z'),
      to: new Date('2026-07-31T00:00:00.000Z'),
      repId: 1,
    })
    // Hotel Two is new in July; Cafe One first ordered in June so its July
    // order is a repeat, not an acquisition.
    expect(count).toBe(1)
  })
})

describe('computeTargetAchieved', () => {
  it('composes the revenue metric rather than re-deriving it', () => {
    const target = makeTarget({ userId: 1, type: 'revenue', startDate: '2026-07-01', endDate: '2026-07-31' })
    expect(computeTargetAchieved(target, ctx)).toBe(100)
  })

  it('composes the order count', () => {
    const target = makeTarget({ userId: 2, type: 'orders' })
    expect(computeTargetAchieved(target, ctx)).toBe(1)
  })

  it('composes the new-customer count', () => {
    const target = makeTarget({ userId: 1, type: 'new_horecas' })
    expect(computeTargetAchieved(target, ctx)).toBe(1)
  })

  it('includes an order placed on the last day of the window', () => {
    const target = makeTarget({ userId: 1, type: 'orders', startDate: '2026-07-01', endDate: '2026-07-10' })
    // ORD-1 is 2026-07-10T09:00Z — the `T23:59:59` spelling kept it, but only
    // by luck; an order at 23:59:59.5 would have been dropped.
    expect(computeTargetAchieved(target, ctx)).toBe(1)
  })
})
