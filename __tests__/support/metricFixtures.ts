// Fixture builders for the semantic-layer tests.
//
// Deliberately minimal: each builder fills only the fields the metrics read and
// casts to the full type. A metric that starts reading a new field will fail
// here loudly rather than quietly seeing `undefined`, which is the point.

import { UserRole } from '../../types'
import type { HoReCa, Order, OrderItem, OrderStatus, Product, SalesTarget, User } from '../../types'

export function makeUser(over: Partial<User> = {}): User {
  return {
    id: 1,
    name: 'Rep One',
    email: 'rep1@test.local',
    role: UserRole.FIELD_REP,
    ...over,
  } as User
}

export function makeHoReCa(over: Partial<HoReCa> = {}): HoReCa {
  return { id: 100, name: 'Cafe One', address: '1 Test St', ...over } as HoReCa
}

export function makeProduct(over: Partial<Product> = {}): Product {
  return {
    id: 10,
    sku: 'SKU-10',
    name: 'Product Ten',
    description: 'A product',
    price: 5,
    category: 'Dry Goods',
    inventory: 100,
    available: 100,
    unit: 'each',
    cartonSize: 12,
    supplierId: 1,
    isActive: true,
    ...over,
  } as Product
}

export function makeItem(over: Partial<OrderItem> = {}): OrderItem {
  return { ...makeProduct(), quantity: 1, ...over } as OrderItem
}

export function makeOrder(over: Partial<Order> = {}): Order {
  return {
    id: 'ORD-1',
    hoReCa: makeHoReCa(),
    items: [makeItem()],
    total: 5,
    orderDate: '2026-07-15T10:00:00.000Z',
    submittedBy: makeUser(),
    status: 'processing' as OrderStatus,
    statusHistory: [],
    ...over,
  } as Order
}

export function makeTarget(over: Partial<SalesTarget> = {}): SalesTarget {
  return {
    id: 'TGT-1',
    userId: 1,
    type: 'revenue',
    targetValue: 1000,
    startDate: '2026-07-01',
    endDate: '2026-07-31',
    createdAt: '2026-07-01T00:00:00.000Z',
    ...over,
  } as SalesTarget
}
