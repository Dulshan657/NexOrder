import { describe, it, expect } from 'vitest'

import { evaluateMetric } from '../lib/semantic/evaluate'
import { dayRange, filterOrders } from '../lib/semantic/filter'
import { computeTargetAchieved } from '../lib/semantic/targets'
import type { MetricContext } from '../lib/semantic/types'
import { UserRole } from '../types'
import type { Order, Product, SalesTarget } from '../types'
import { makeHoReCa, makeItem, makeOrder, makeProduct, makeTarget, makeUser } from './support/metricFixtures'

// The safety net for replacing the dashboards' inline math.
//
// Each block below re-implements the OLD inline expression verbatim (copied from
// the line noted in its comment) and asserts the registry agrees. Where the
// registry deliberately differs, the test says so and pins the new behaviour
// instead of the old — so no change in a displayed number is silent.

const repA = makeUser({ id: 1, name: 'Rep A', role: UserRole.FIELD_REP })
const repB = makeUser({ id: 2, name: 'Rep B', role: UserRole.OFFICE_REP })
const cafe = makeHoReCa({ id: 100, name: 'Cafe One' })
const hotel = makeHoReCa({ id: 200, name: 'Hotel Two' })

// Stored total == line sum on every order here, which is what dev looks like
// (all 64 orders agree to the cent). That is precisely why the two revenue
// definitions can be swapped without moving a number today.
const orders: Order[] = [
  makeOrder({
    id: 'O1', orderDate: '2026-07-05T09:00:00.000Z', hoReCa: cafe, submittedBy: repA,
    status: 'delivered', total: 100,
    items: [makeItem({ id: 1, name: 'Rice', category: 'Dry Goods', price: 10, quantity: 10 })],
  }),
  makeOrder({
    id: 'O2', orderDate: '2026-07-05T18:00:00.000Z', hoReCa: hotel, submittedBy: repB,
    status: 'processing', total: 60,
    items: [makeItem({ id: 2, name: 'Peas', category: 'Frozen', price: 30, quantity: 2 })],
  }),
  makeOrder({
    id: 'O3', orderDate: '2026-07-20T09:00:00.000Z', hoReCa: cafe, submittedBy: repA,
    status: 'delivered', total: 45,
    items: [makeItem({ id: 3, name: 'Flour', category: 'Dry Goods', price: 15, quantity: 3 })],
  }),
]

const products: Product[] = [
  makeProduct({ id: 1, inventory: 100 }),
  makeProduct({ id: 2, inventory: 10 }),
  makeProduct({ id: 3, inventory: 4 }),
  makeProduct({ id: 4, inventory: 0 }),
]

const lowStockThreshold = 10
const ctx: MetricContext = {
  orders,
  products,
  settings: { lowStockThreshold },
  now: new Date('2026-07-25T00:00:00.000Z'),
}

// AdminDashboard's window is instant-based (local midnight .. now), so its
// equivalence is checked with raw instants. SalesDashboard's comes from two date
// inputs, so its equivalence is checked with dayRange.
const start = new Date('2026-07-01T00:00:00.000Z')
const end = new Date('2026-07-31T00:00:00.000Z')
const range = { from: start, to: end }
const calendarRange = dayRange('2026-07-01', '2026-07-31')

describe('AdminDashboard.tsx:84-107 — revenue, orders, AOV', () => {
  // Old: allOrders.filter(o => d >= start && d <= end) then reduce(o.total)
  const oldFiltered = orders.filter(o => {
    const d = new Date(o.orderDate).getTime()
    return d >= start.getTime() && d <= end.getTime()
  })
  const oldRevenue = oldFiltered.reduce((s, o) => s + o.total, 0)
  const oldOrders = oldFiltered.length
  const oldAov = oldOrders > 0 ? oldRevenue / oldOrders : 0

  it('matches sales.revenue', () => {
    expect(evaluateMetric('sales.revenue', ctx, range)).toBe(oldRevenue)
  })

  it('matches sales.orderCount', () => {
    expect(evaluateMetric('sales.orderCount', ctx, range)).toBe(oldOrders)
  })

  it('matches sales.averageOrderValue', () => {
    expect(evaluateMetric('sales.averageOrderValue', ctx, range)).toBe(oldAov)
  })
})

describe('SalesDashboard.tsx:209-223 — the line-sum override', () => {
  // Old: map each order to { ...order, total: items.reduce(price*quantity) }
  // then reduce those totals. With no category filter the items are untouched,
  // so this is the line sum of every order in range.
  const oldRevenue = orders
    .filter(o => {
      const d = new Date(o.orderDate)
      return d >= start && d < new Date(end.getTime() + 86_400_000)
    })
    .reduce((acc, o) => acc + o.items.reduce((s, i) => s + i.price * i.quantity, 0), 0)

  it('matches sales.lineRevenue exactly', () => {
    expect(evaluateMetric('sales.lineRevenue', ctx, calendarRange)).toBe(oldRevenue)
  })

  it('also matches sales.revenue, because stored total equals the line sum here', () => {
    // This is the migration's justification: on dev the two agree, so
    // SalesDashboard adopting the stored total moves nothing on screen. The
    // assertion below is what breaks the day a header-level promotion lands.
    expect(evaluateMetric('sales.revenue', ctx, calendarRange)).toBe(oldRevenue)
  })
})

describe('SalesDashboard.tsx:226-230 — sales by date', () => {
  const salesByDate = new Map<string, number>()
  for (const o of orders) {
    const date = o.orderDate.split('T')[0]
    salesByDate.set(date, (salesByDate.get(date) || 0) + o.total)
  }

  it('matches sales.revenueByDate', () => {
    const out = evaluateMetric('sales.revenueByDate', ctx, {}) as ReadonlyArray<{
      date: string
      revenue: number
    }>
    expect(new Map(out.map(r => [r.date, r.revenue]))).toEqual(salesByDate)
  })
})

describe('SalesDashboard.tsx:262-276 — top customers and reps', () => {
  const customerSales = new Map<string, number>()
  for (const o of orders) customerSales.set(o.hoReCa.name, (customerSales.get(o.hoReCa.name) || 0) + o.total)
  const oldTopCustomers = [...customerSales.entries()].sort((a, b) => b[1] - a[1])

  const repSales = new Map<string, number>()
  for (const o of orders) {
    if (o.submittedBy.role === UserRole.FIELD_REP || o.submittedBy.role === UserRole.OFFICE_REP) {
      repSales.set(o.submittedBy.name, (repSales.get(o.submittedBy.name) || 0) + o.total)
    }
  }
  const oldTopReps = [...repSales.entries()].sort((a, b) => b[1] - a[1])

  it('matches sales.revenueByCustomer', () => {
    const out = evaluateMetric('sales.revenueByCustomer', ctx, {}) as ReadonlyArray<{
      name: string
      revenue: number
    }>
    expect(out.map(c => [c.name, c.revenue])).toEqual(oldTopCustomers)
  })

  it('matches sales.revenueByRep, including the rep-roles-only rule', () => {
    const out = evaluateMetric('sales.revenueByRep', ctx, {}) as ReadonlyArray<{
      name: string
      revenue: number
    }>
    expect(out.map(r => [r.name, r.revenue])).toEqual(oldTopReps)
  })
})

describe('SalesDashboard.tsx:339 — orders by status', () => {
  it('matches sales.ordersByStatus for every stage', () => {
    const out = evaluateMetric('sales.ordersByStatus', ctx, {}) as ReadonlyArray<{
      status: string
      count: number
    }>
    for (const stage of out) {
      const oldCount = orders.filter(o => o.status === stage.status).length
      expect(stage.count, stage.status).toBe(oldCount)
    }
  })
})

describe('SalesDashboard.tsx:247 / AdminDashboard.tsx:131 — low stock (INTENTIONAL CHANGE)', () => {
  // Old inline rule, in both files:
  const oldLowStock = products.filter(p => p.inventory > 0 && p.inventory < lowStockThreshold)

  it('differs from the old rule at the threshold boundary, on purpose', () => {
    const out = evaluateMetric('inventory.lowStockProducts', ctx, {}) as ReadonlyArray<{ id: number }>
    const newIds = out.map(p => p.id).sort()
    const oldIds = oldLowStock.map(p => p.id).sort()

    // Old: strictly below 10 -> only product 3 (inventory 4).
    expect(oldIds).toEqual([3])
    // New: `<=` is the canonical boundary in classifyStock, so product 2
    // (exactly 10) is also low. Product 4 (0) remains out-of-stock, not low.
    expect(newIds).toEqual([2, 3])
    expect(newIds).not.toEqual(oldIds)
  })

  it('keeps out-of-stock as its own bucket in both rules', () => {
    const out = evaluateMetric('inventory.outOfStockCount', ctx, {})
    expect(out).toBe(1)
    expect(oldLowStock.some(p => p.inventory <= 0)).toBe(false)
  })
})

describe('target attainment — four old copies collapse to one', () => {
  const target: SalesTarget = makeTarget({
    userId: 1, type: 'revenue', startDate: '2026-07-01', endDate: '2026-07-31',
  })

  // AdminDashboard.tsx:472-482 / SalesDashboard.tsx:426 / RepDashboardV2.tsx:398
  const startMs = new Date(target.startDate).getTime()
  const endMs = new Date(target.endDate + 'T23:59:59').getTime()
  const oldAchieved = orders
    .filter(o =>
      o.submittedBy.id === target.userId &&
      new Date(o.orderDate).getTime() >= startMs &&
      new Date(o.orderDate).getTime() <= endMs)
    .reduce((sum, o) => sum + o.total, 0)

  // services/targetProjectionService.ts:8-15
  const svcStart = new Date(target.startDate)
  const svcEnd = new Date(target.endDate)
  const oldServiceAchieved = orders
    .filter(o => {
      const d = new Date(o.orderDate)
      return o.submittedBy.id === target.userId && d >= svcStart && d <= svcEnd
    })
    .reduce((sum, o) => sum + o.total, 0)

  it('matches the dashboards copy', () => {
    expect(computeTargetAchieved(target, ctx)).toBe(oldAchieved)
  })

  it('matches the service copy too — they happened to agree on this fixture', () => {
    expect(computeTargetAchieved(target, ctx)).toBe(oldServiceAchieved)
  })

  it('and fixes the case where the two old copies disagreed', () => {
    // An order late on the final day: the service copy used `<= new Date(endDate)`,
    // i.e. midnight, and dropped it. The dashboards' 'T23:59:59' kept it.
    const lateOrder = makeOrder({
      id: 'LATE', orderDate: '2026-07-31T18:00:00.000Z', hoReCa: cafe,
      submittedBy: repA, total: 500,
    })
    const lateCtx: MetricContext = { ...ctx, orders: [lateOrder] }

    const svcValue = [lateOrder]
      .filter(o => {
        const d = new Date(o.orderDate)
        return o.submittedBy.id === 1 && d >= svcStart && d <= svcEnd
      })
      .reduce((s, o) => s + o.total, 0)

    expect(svcValue).toBe(0)                                   // the old service bug
    expect(computeTargetAchieved(target, lateCtx)).toBe(500)    // the canonical answer
  })
})

describe('filterOrders reproduces each old range spelling', () => {
  it('reproduces the AdminDashboard instant spelling exactly', () => {
    const admin = orders.filter(o => {
      const d = new Date(o.orderDate).getTime()
      return d >= start.getTime() && d <= end.getTime()
    })
    expect(filterOrders(orders, range).map(o => o.id)).toEqual(admin.map(o => o.id))
  })

  it('reproduces the SalesDashboard next-day-exclusive spelling via dayRange', () => {
    // Old: d >= new Date(startDate) && d < new Date(endDate) + 1 day.
    // dayRange's inclusive 23:59:59.999 end is the same set of instants.
    const sales = orders.filter(o => {
      const d = new Date(o.orderDate)
      return d >= start && d < new Date(end.getTime() + 86_400_000)
    })
    expect(filterOrders(orders, calendarRange).map(o => o.id)).toEqual(sales.map(o => o.id))
  })

  it('and the two spellings only ever differed inside the final day', () => {
    const lateOnFinalDay = makeOrder({ id: 'LATE', orderDate: '2026-07-31T20:00:00.000Z' })
    // The AdminDashboard instant window ended at 00:00 of the 31st, so it missed
    // an order placed that evening; the calendar window keeps it.
    expect(filterOrders([lateOnFinalDay], range)).toHaveLength(0)
    expect(filterOrders([lateOnFinalDay], calendarRange)).toHaveLength(1)
  })
})
