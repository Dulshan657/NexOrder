// Fixtures for the voice tool tests: two reps, three customers, thirteen orders
// over 58 days, six products, one target per rep and two visits.
//
// Every builder returns a fresh, DEEP-FROZEN object. A tool that mutates its
// input then throws a TypeError (ESM is strict), which is how "never mutates
// ctx" is enforced rather than hoped for.
//
// The clock is fixed: NOW is a Tuesday. Nothing here reads the real one.

import { UserRole } from '../../types'
import type {
  HoReCa,
  Order,
  OrderStatus,
  Product,
  SalesTarget,
  ScheduledVisit,
  User,
  Visit,
} from '../../types'
import type { VoiceToolContext } from '../../lib/voice/context'
import { mkCartItem, mkHoReCa, mkProduct, mkUser } from '../fixtures'

export const NOW = new Date('2026-10-20T04:00:00.000Z')
export const DAY_MS = 86_400_000
export const ALL_MODULES: readonly string[] = [
  'sales_orders',
  'shop',
  'inventory_dispatch',
  'field_ops',
  'voice_assistant',
]

export const iso = (daysAgo: number): string => new Date(NOW.getTime() - daysAgo * DAY_MS).toISOString()

export function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object' || value instanceof Date) return value
  if (!Object.isFrozen(value)) {
    Object.freeze(value)
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child)
  }
  return value
}

export const REP_A: User = mkUser({ id: 101, name: 'Alice Rep', role: UserRole.FIELD_REP })
export const REP_B: User = mkUser({ id: 102, name: 'Bob Rep', role: UserRole.FIELD_REP })
export const MANAGER: User = mkUser({ id: 103, name: 'Maria Manager', role: UserRole.MANAGER })
export const OFFICE_REP: User = mkUser({ id: 104, name: 'Olive Office', role: UserRole.OFFICE_REP })

export const C1: HoReCa = mkHoReCa({ id: 11, name: 'Harbour Cafe', address: '1 Wharf Rd, Sydney' })
export const C2: HoReCa = mkHoReCa({ id: 12, name: 'Bayside Bistro', address: '22 Beach St, Manly' })
export const C3: HoReCa = mkHoReCa({ id: 13, name: 'The Grove Restaurant', address: '3 Park Ave, Newtown' })

export const P1 = mkProduct({ id: 1, sku: 'RCP', name: 'Red Curry Paste', price: 4, category: 'Meal Pastes', inventory: 100, available: 80 })
export const P2 = mkProduct({ id: 2, sku: 'GCP', name: 'Green Curry Paste', price: 5.5, category: 'Meal Pastes', inventory: 3, available: 3 })
export const P3 = mkProduct({ id: 3, sku: 'COC', name: 'Coconut Milk', price: 3.45, category: 'Pantry', inventory: 0, available: 0 })
export const P4 = mkProduct({ id: 4, sku: 'FSH', name: 'Fish Sauce', price: 6, category: 'Sauces', inventory: 40, available: 40 })
export const P5 = mkProduct({ id: 5, sku: 'RIC', name: 'Jasmine Rice 5kg', price: 20, category: 'Pantry', inventory: 80, available: 80 })
export const P6 = mkProduct({ id: 6, sku: 'OLD', name: 'Retired Sauce', price: 8, category: 'Sauces', inventory: 50, available: 50, isActive: false })

export type Line = readonly [Product, number]

/** One order placed `daysAgo` days before NOW; the total is the sum of its lines. */
export function order(id: string, by: User, at: HoReCa, daysAgo: number, lines: Line[], status: OrderStatus = 'delivered'): Order {
  const items = lines.map(([product, qty]) => mkCartItem(product, qty))
  const total = items.reduce((sum, item) => sum + item.price * item.quantity, 0)
  return { id, hoReCa: at, items, total, orderDate: iso(daysAgo), submittedBy: by, status, statusHistory: [] }
}

export function buildOrders(): Order[] {
  return [
    order('O1', REP_A, C2, 58, [[P2, 10]]),
    order('O2', REP_A, C2, 45, [[P2, 10], [P3, 12]]),
    order('O3', REP_A, C2, 40, [[P3, 14]]),
    order('O4', REP_A, C1, 55, [[P1, 20], [P2, 2]]),
    order('O5', REP_A, C1, 40, [[P1, 20], [P4, 5], [P2, 2]]),
    order('O6', REP_A, C1, 26, [[P1, 24], [P4, 6]]),
    order('O7', REP_A, C1, 12, [[P1, 16], [P4, 4]]),
    order('O8', REP_B, C1, 8, [[P1, 30]], 'dispatched'),
    order('O9', REP_B, C3, 56, [[P1, 10]]),
    order('O10', REP_B, C3, 42, [[P1, 10], [P4, 4]]),
    order('O11', REP_B, C3, 28, [[P1, 12]]),
    order('O12', REP_B, C3, 14, [[P1, 12], [P4, 4]]),
    // Voided: must count nowhere (revenue, last-order date, velocity, dead stock).
    order('O13', REP_A, C2, 1, [[P5, 1]], 'cancelled'),
  ]
}

export function buildProducts(): Product[] {
  return [P1, P2, P3, P4, P5, P6].map((p) => ({ ...p }))
}

export function buildTargets(): SalesTarget[] {
  const base = { startDate: '2026-10-01', endDate: '2026-10-31', createdAt: '2026-10-01T00:00:00.000Z' }
  return [
    { id: 'T1', userId: REP_A.id, type: 'revenue', targetValue: 1000, ...base },
    { id: 'T2', userId: REP_B.id, type: 'orders', targetValue: 5, ...base },
  ]
}

function visit(id: string, hoReCaId: number, userId: number, arrival: string, outcome: Visit['outcome']): Visit {
  return { id, hoReCaId, userId, arrivalTime: arrival, outcome, photos: [], createdAt: arrival }
}

export function buildVisits(): Visit[] {
  return [
    visit('V1', C2.id, REP_A.id, '2026-10-19T09:00:00.000Z', 'follow_up_needed'),
    visit('V2', C1.id, REP_A.id, '2026-10-07T01:00:00.000Z', 'order_placed'),
  ]
}

export function buildRoutes(): ScheduledVisit[] {
  const base = { createdBy: REP_A.id, createdAt: '2026-10-01T00:00:00.000Z' }
  return [
    {
      ...base, id: 'R1', name: 'Wednesday run', date: '2026-10-07', status: 'completed',
      stops: [
        { hoReCaId: C1.id, sequence: 1, status: 'arrived' },
        { hoReCaId: C2.id, sequence: 2, status: 'skipped' },
      ],
    },
    {
      ...base, id: 'R2', name: 'Monday run', date: '2026-10-19', status: 'in_progress',
      stops: [
        { hoReCaId: C2.id, sequence: 1, status: 'arrived' },
        { hoReCaId: C1.id, sequence: 2, status: 'pending' },
      ],
    },
  ]
}

export function userBlock(user: User): VoiceToolContext['user'] {
  return {
    numericId: user.id,
    // Deliberately not numeric-looking: a tool comparing against it would match nothing.
    uuid: `00000000-0000-4000-8000-${String(user.id).padStart(12, 'a')}`,
    role: user.role,
    name: user.name,
  }
}

/** A fresh, deep-frozen tool context. `as` is who is asking; `over` replaces fields. */
export function ctxFor(as: User, over: Partial<VoiceToolContext> = {}): VoiceToolContext {
  return deepFreeze({
    orders: buildOrders(),
    products: buildProducts(),
    hoReCas: [C1, C2, C3].map((c) => ({ ...c })),
    salesTargets: buildTargets(),
    visits: buildVisits(),
    routes: buildRoutes(),
    settings: { lowStockThreshold: 10 },
    now: NOW,
    user: userBlock(as),
    modules: [...ALL_MODULES],
    ...over,
  })
}

/** `count` orders spread over 60 customers, three reps and the six products. */
export function buildBulkWorld(count: number): Pick<VoiceToolContext, 'orders' | 'hoReCas'> {
  const customers = Array.from({ length: 60 }, (_, i) =>
    mkHoReCa({ id: 1000 + i, name: `Customer Number ${String(i).padStart(3, '0')} Pty Ltd`, address: `${i} Long Street, Sydney NSW` }),
  )
  const reps = [REP_A, REP_B, MANAGER]
  const catalogue = [P1, P2, P3, P4, P5]
  const orders = Array.from({ length: count }, (_, i) =>
    order(
      `B${i}`,
      reps[i % reps.length],
      customers[i % customers.length],
      (i * 7) % 85,
      [[catalogue[i % catalogue.length], 1 + (i % 9)], [catalogue[(i + 2) % catalogue.length], 2]],
      i % 11 === 0 ? 'processing' : 'delivered',
    ),
  )
  return { orders: deepFreeze(orders), hoReCas: deepFreeze(customers) }
}

/** The smallest valid arguments for each tool, for tests that call every tool. */
export const MINIMAL_ARGS: Readonly<Record<string, Record<string, unknown>>> = {
  get_sales_summary: { period: 'today' },
  get_target_progress: {},
  get_follow_up_list: {},
  find_customer: { query: 'harbour' },
  get_customer_insights: { horeca_id: C1.id },
  get_suggested_order_for_customer: { horeca_id: C1.id },
  get_stock_status: { filter: 'summary' },
  get_reorder_recommendations: {},
  get_product_movement: { kind: 'top' },
  get_visit_stats: { period: 'this_week' },
}
