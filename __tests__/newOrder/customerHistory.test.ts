import { describe, expect, it } from 'vitest'

import { customerOrders, lastOrderLines, linesOfOrder, usualProducts } from '../../lib/newOrder/customerHistory'
import { mkHoReCa, mkProduct, mkUser } from '../fixtures'
import type { Order, OrderItem, OrderStatus } from '../../types'

const item = (id: number, quantity: number, over: Partial<OrderItem> = {}): OrderItem => ({
  ...mkProduct({ id, sku: `P-${id}`, name: `Product ${id}` }),
  quantity,
  ...over,
})

let seq = 0
const order = (hoReCaId: number, date: string, items: OrderItem[], status: OrderStatus = 'delivered'): Order => ({
  id: `ORD-${++seq}`,
  hoReCa: mkHoReCa({ id: hoReCaId }),
  items,
  total: 0,
  orderDate: date,
  submittedBy: mkUser(),
  status,
  statusHistory: [],
})

const orders: Order[] = [
  order(10, '2026-11-01T09:00:00Z', [item(1, 2), item(2, 6)]),
  order(10, '2026-11-20T09:00:00Z', [item(1, 4), item(3, 1, { uomId: 12, packSize: 12 })]),
  order(10, '2026-11-10T09:00:00Z', [item(1, 10)]),
  order(10, '2026-11-25T09:00:00Z', [item(4, 1)], 'cancelled'),
  order(99, '2026-11-26T09:00:00Z', [item(5, 1)]),
]

describe('customerHistory', () => {
  it('returns the most recent order\'s lines as the last order', () => {
    expect(lastOrderLines(orders, 10)).toEqual([
      { productId: 1, uomId: null, quantity: 4 },
      { productId: 3, uomId: 12, quantity: 1 },
    ])
    expect(lastOrderLines(orders, 42)).toEqual([])
  })

  it('ranks usual products by order frequency with the median quantity', () => {
    expect(usualProducts(orders, 10)).toEqual([
      { productId: 1, orderCount: 3, medianQuantity: 4 },
      { productId: 2, orderCount: 1, medianQuantity: 6 },
      { productId: 3, orderCount: 1, medianQuantity: 12 },
    ])
  })

  it('lists only that customer\'s live orders, newest first', () => {
    expect(customerOrders(orders, 10).map((o) => o.orderDate)).toEqual([
      '2026-11-20T09:00:00Z',
      '2026-11-10T09:00:00Z',
      '2026-11-01T09:00:00Z',
    ])
  })

  it('caps the recent list', () => {
    expect(customerOrders(orders, 10, 2)).toHaveLength(2)
  })

  it('copies an order\'s lines in the units they were ordered in', () => {
    expect(linesOfOrder(orders[1])).toEqual([
      { productId: 1, uomId: null, quantity: 4 },
      { productId: 3, uomId: 12, quantity: 1 },
    ])
  })

  it('takes the median of an even count as the mean of the middle two, rounded up', () => {
    const even = [
      order(7, '2026-11-01T00:00:00Z', [item(1, 2)]),
      order(7, '2026-11-02T00:00:00Z', [item(1, 5)]),
    ]
    expect(usualProducts(even, 7)[0].medianQuantity).toBe(4)
  })
})
