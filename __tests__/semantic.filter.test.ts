import { describe, it, expect } from 'vitest'

import { filterOrders } from '../lib/semantic/filter'
import { UserRole } from '../types'
import { makeHoReCa, makeItem, makeOrder, makeUser } from './support/metricFixtures'

// filterOrders is the single order-scoping definition. Before it existed the
// codebase had three spellings of "inclusive date range" that disagreed at the
// day boundary (AdminDashboard `<= end`, SalesDashboard `< end + 1 day`, and
// target attainment's `endDate + 'T23:59:59'`, which dropped the final second).
// These tests pin the resolution: whole-day inclusive on both ends.

describe('filterOrders — date range', () => {
  const early = makeOrder({ id: 'A', orderDate: '2026-07-01T00:00:00.000Z' })
  const mid = makeOrder({ id: 'B', orderDate: '2026-07-15T12:00:00.000Z' })
  const lastInstant = makeOrder({ id: 'C', orderDate: '2026-07-31T23:59:59.999Z' })
  const after = makeOrder({ id: 'D', orderDate: '2026-08-01T00:00:00.000Z' })
  const orders = [early, mid, lastInstant, after]

  it('includes both bounds for the whole day', () => {
    const out = filterOrders(orders, {
      from: new Date('2026-07-01T00:00:00.000Z'),
      to: new Date('2026-07-31T00:00:00.000Z'),
    })
    expect(out.map(o => o.id)).toEqual(['A', 'B', 'C'])
  })

  it('does not drop the final second of the end day', () => {
    // The `endDate + 'T23:59:59'` spelling excluded this order.
    const out = filterOrders([lastInstant], { to: new Date('2026-07-31T09:00:00.000Z') })
    expect(out).toHaveLength(1)
  })

  it('treats a missing bound as unbounded', () => {
    expect(filterOrders(orders, {})).toHaveLength(4)
    expect(filterOrders(orders, { from: new Date('2026-07-15T00:00:00.000Z') }).map(o => o.id))
      .toEqual(['B', 'C', 'D'])
  })

  it('ignores an unparseable orderDate rather than counting it', () => {
    const bad = makeOrder({ id: 'X', orderDate: 'not-a-date' })
    const out = filterOrders([bad], { from: new Date('2026-01-01T00:00:00.000Z') })
    expect(out).toHaveLength(0)
  })
})

describe('filterOrders — entity and status scoping', () => {
  const repA = makeUser({ id: 1, name: 'Rep A', role: UserRole.FIELD_REP })
  const repB = makeUser({ id: 2, name: 'Rep B', role: UserRole.OFFICE_REP })
  const admin = makeUser({ id: 3, name: 'Admin', role: UserRole.ADMIN })

  const orders = [
    makeOrder({ id: 'A', submittedBy: repA, hoReCa: makeHoReCa({ id: 100 }), status: 'processing' }),
    makeOrder({ id: 'B', submittedBy: repB, hoReCa: makeHoReCa({ id: 200 }), status: 'delivered' }),
    makeOrder({ id: 'C', submittedBy: admin, hoReCa: makeHoReCa({ id: 100 }), status: 'delivered' }),
  ]

  it('scopes by customer', () => {
    expect(filterOrders(orders, { horecaId: 100 }).map(o => o.id)).toEqual(['A', 'C'])
  })

  it('scopes by rep', () => {
    expect(filterOrders(orders, { repId: 2 }).map(o => o.id)).toEqual(['B'])
  })

  it('scopes by submitter role', () => {
    expect(filterOrders(orders, { userRole: UserRole.ADMIN }).map(o => o.id)).toEqual(['C'])
  })

  it('scopes by status set', () => {
    expect(filterOrders(orders, { statuses: ['delivered'] }).map(o => o.id)).toEqual(['B', 'C'])
  })

  it('combines scopes conjunctively', () => {
    const out = filterOrders(orders, { horecaId: 100, statuses: ['delivered'] })
    expect(out.map(o => o.id)).toEqual(['C'])
  })
})

describe('filterOrders — category is a line-level scope', () => {
  const order = makeOrder({
    id: 'A',
    total: 100,
    items: [
      makeItem({ id: 1, category: 'Dry Goods', price: 10, quantity: 2 }),
      makeItem({ id: 2, category: 'Frozen', price: 30, quantity: 1 }),
    ],
  })

  it('narrows items to the category and leaves the stored total alone', () => {
    const [out] = filterOrders([order], { category: 'Frozen' })
    expect(out.items.map(i => i.id)).toEqual([2])
    // The stored total is NOT rewritten — attributing it to one category is what
    // `sales.lineRevenue` is for. Rewriting it here would hide the choice.
    expect(out.total).toBe(100)
  })

  it('drops an order left with no matching line', () => {
    expect(filterOrders([order], { category: 'Chilled' })).toHaveLength(0)
  })

  it('does not mutate the input order', () => {
    filterOrders([order], { category: 'Frozen' })
    expect(order.items).toHaveLength(2)
  })
})
