import { describe, it, expect } from 'vitest'

import { dayRange, filterOrders } from '../lib/semantic/filter'
import { UserRole } from '../types'
import { makeHoReCa, makeItem, makeOrder, makeUser } from './support/metricFixtures'

// Two distinct concerns, deliberately separated:
//
//   filterOrders  compares exact INSTANTS, because a Date is an instant and
//                 AdminDashboard's "since local midnight, up to now" window is
//                 genuinely instant-based.
//   dayRange      is the one definition of "these two calendar dates, inclusive",
//                 for callers holding YYYY-MM-DD values from a date input.
//
// Conflating the two is what produced `endDate + 'T23:59:59'` — a day-based
// boundary built in local time that dropped the final second of the day.

describe('filterOrders — date range is instant-based', () => {
  const early = makeOrder({ id: 'A', orderDate: '2026-07-01T00:00:00.000Z' })
  const mid = makeOrder({ id: 'B', orderDate: '2026-07-15T12:00:00.000Z' })
  const lastInstant = makeOrder({ id: 'C', orderDate: '2026-07-31T23:59:59.999Z' })
  const after = makeOrder({ id: 'D', orderDate: '2026-08-01T00:00:00.000Z' })
  const orders = [early, mid, lastInstant, after]

  it('includes both bounds exactly', () => {
    const out = filterOrders(orders, {
      from: new Date('2026-07-01T00:00:00.000Z'),
      to: new Date('2026-07-31T23:59:59.999Z'),
    })
    expect(out.map(o => o.id)).toEqual(['A', 'B', 'C'])
  })

  it('does not silently widen a bound to the end of its day', () => {
    // An instant bound means what it says: midday excludes the evening.
    const out = filterOrders([lastInstant], { to: new Date('2026-07-31T09:00:00.000Z') })
    expect(out).toHaveLength(0)
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

describe('dayRange — the one definition of an inclusive calendar range', () => {
  const lastInstant = makeOrder({ id: 'C', orderDate: '2026-07-31T23:59:59.999Z' })
  const nextDay = makeOrder({ id: 'D', orderDate: '2026-08-01T00:00:00.000Z' })

  it('covers the whole of both end days', () => {
    const range = dayRange('2026-07-01', '2026-07-31')
    expect(range.from.toISOString()).toBe('2026-07-01T00:00:00.000Z')
    expect(range.to.toISOString()).toBe('2026-07-31T23:59:59.999Z')
  })

  it('keeps an order placed in the final second of the last day', () => {
    // This is the order the `endDate + 'T23:59:59'` spelling dropped.
    expect(filterOrders([lastInstant], dayRange('2026-07-01', '2026-07-31'))).toHaveLength(1)
  })

  it('still excludes the next day', () => {
    expect(filterOrders([nextDay], dayRange('2026-07-01', '2026-07-31'))).toHaveLength(0)
  })

  it('accepts Dates as well as YYYY-MM-DD strings', () => {
    const fromString = dayRange('2026-07-01', '2026-07-31')
    const fromDates = dayRange(new Date('2026-07-01T08:30:00.000Z'), new Date('2026-07-31T08:30:00.000Z'))
    expect(fromDates.from.toISOString()).toBe(fromString.from.toISOString())
    expect(fromDates.to.toISOString()).toBe(fromString.to.toISOString())
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
