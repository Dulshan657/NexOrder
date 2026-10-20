// Each tool through the public door, runVoiceTool, against the shared fixtures
// (voiceFixtures.ts). Expected numbers are worked out in the comments from the
// fixture, not read back from the code under test.

import { describe, it, expect } from 'vitest'
import { mkHoReCa, mkProduct } from '../fixtures'
import { runVoiceTool } from '../../lib/voice/runVoiceTool'
import type { VoiceToolResult } from '../../lib/voice/runVoiceTool'
import type { VoiceToolContext } from '../../lib/voice/context'
import type { HoReCa, Order, Product, Visit } from '../../types'
import {
  C1, C2, C3, MANAGER, NOW, P1, P2, P4, P6, REP_A, REP_B, buildBulkWorld, buildOrders, buildProducts,
  buildTargets, buildVisits, ctxFor, deepFreeze, iso, order,
} from './voiceFixtures'

function run(name: string, args: unknown, ctx: VoiceToolContext = ctxFor(MANAGER)): VoiceToolResult {
  return runVoiceTool(name, args, ctx)
}

function dataOf<T>(result: VoiceToolResult): T {
  if (result.ok === false) throw new Error(`expected ok, got: ${result.error}`)
  return result.data as T
}

function basisOf(result: VoiceToolResult): string {
  if (result.ok === false) throw new Error(`expected ok, got: ${result.error}`)
  return result.basis
}

// Fixture facts used below (NOW is Tuesday 20 Oct 2026, 04:00 UTC):
//   Harbour Cafe (C1)      A: 55d 40d 26d 12d ago, B: 8d ago        => next order due in 4 days
//   Bayside Bistro (C2)    A: 58d 45d 40d ago (+1 cancelled, 1d)    => 31 days overdue, at risk
//   The Grove (C3)         B: 56d 42d 28d 14d ago                   => due today

describe('get_sales_summary', () => {
  interface Sales {
    revenue: number
    orderCount: number
    averageOrderValue: number
    newCustomers: number
    ordersByStatus: Array<{ status: string; count: number }>
    topCustomers: Array<{ horecaId: number; name: string; revenue: number }>
    topProducts: Array<{ name: string; units: number }>
    previous?: { label: string; revenue: number; orderCount: number; deltaPercent: number | null; orderCountDeltaPercent: number | null }
  }

  const summary = (args: Record<string, unknown>, ctx?: VoiceToolContext): Sales =>
    dataOf<Sales>(run('get_sales_summary', args, ctx))

  it('totals everyone for a manager, in whole dollars, with the cancelled order left out', () => {
    // Orders in the last 30 days: O6 132, O7 88, O8 120, O11 48, O12 72 = 460 (O13 is cancelled).
    const data = summary({ period: 'last_30_days' })
    expect(data.revenue).toBe(460)
    expect(data.orderCount).toBe(5)
    expect(data.averageOrderValue).toBe(92)
    expect(Number.isInteger(data.revenue)).toBe(true)
  })

  it('ranks the top customers and products and caps both at five', () => {
    const data = summary({ period: 'last_30_days' })
    // Harbour Cafe 132 + 88 + 120 = 340, The Grove 48 + 72 = 120.
    expect(data.topCustomers).toEqual([
      { horecaId: C1.id, name: 'Harbour Cafe', revenue: 340 },
      { horecaId: C3.id, name: 'The Grove Restaurant', revenue: 120 },
    ])
    expect(data.topProducts[0]).toEqual({ name: 'Red Curry Paste', units: 24 + 16 + 30 + 12 + 12 })

    const world = buildBulkWorld(200)
    const big = summary({ period: 'custom', from: '2026-07-01', to: '2026-10-20' }, ctxFor(MANAGER, world))
    expect(big.topCustomers.length).toBeLessThanOrEqual(5)
    expect(big.topProducts.length).toBeLessThanOrEqual(5)
  })

  it('counts a customer as new only in the window of their first order', () => {
    // Nobody ordered for the first time in the last 30 days; Harbour Cafe and Bayside Bistro did in August.
    expect(summary({ period: 'last_30_days' }).newCustomers).toBe(0)
    expect(summary({ period: 'custom', from: '2026-08-22', to: '2026-08-31' }).newCustomers).toBe(3)
  })

  it('lists orders by status without the empty stages', () => {
    const data = summary({ period: 'last_30_days' })
    expect(data.ordersByStatus).toEqual([
      { status: 'dispatched', count: 1 },
      { status: 'delivered', count: 4 },
    ])
    expect(data.ordersByStatus.every((s) => s.count > 0)).toBe(true)
  })

  describe('comparison with the previous period', () => {
    it('is on by default and does the percentage sum', () => {
      // Previous 30 days: O1 55, O2 96.4, O3 48.3, O4 91, O5 121, O9 40, O10 64 = 515.7 over 7 orders.
      const data = summary({ period: 'last_30_days' })
      expect(data.previous).toMatchObject({ revenue: 516, orderCount: 7 })
      // (460 - 515.7) / 515.7 = -10.8 %
      expect(data.previous?.deltaPercent).toBeCloseTo(-10.8, 1)
      expect(data.previous?.orderCountDeltaPercent).toBeCloseTo(((5 - 7) / 7) * 100, 1)
    })

    it('gives a null percentage, not Infinity or NaN, when the previous period was empty', () => {
      const data = summary({ period: 'custom', from: '2026-08-22', to: '2026-08-31' })
      expect(data.previous?.revenue).toBe(0)
      expect(data.previous?.deltaPercent).toBeNull()
      expect(data.previous?.orderCountDeltaPercent).toBeNull()
      expect(JSON.stringify(data)).not.toMatch(/NaN|Infinity/)
    })

    it('is left out when compare_previous is false', () => {
      expect(summary({ period: 'last_30_days', compare_previous: false }).previous).toBeUndefined()
    })

    it('says what the previous window was in the answer', () => {
      expect(summary({ period: 'last_30_days' }).previous?.label).toBe('22 Aug to 20 Sep 2026')
    })
  })

  it('answers an empty period with zeros, not an error', () => {
    const data = summary({ period: 'custom', from: '2026-01-01', to: '2026-01-31' })
    expect(data).toMatchObject({ revenue: 0, orderCount: 0, averageOrderValue: 0, newCustomers: 0, topCustomers: [], topProducts: [] })
  })

  it('narrows to one customer and says so', () => {
    const result = run('get_sales_summary', { period: 'last_30_days', horeca_id: C3.id })
    expect(dataOf<Sales>(result).revenue).toBe(120)
    expect(basisOf(result)).toContain('The Grove Restaurant')
  })

  it('refuses a customer that does not exist', () => {
    expect(run('get_sales_summary', { period: 'today', horeca_id: 9999 })).toEqual({ ok: false, error: 'Unknown customer' })
  })

  it('states the period, whose orders and the cancelled rule in the basis', () => {
    expect(basisOf(run('get_sales_summary', { period: 'last_30_days' })))
      .toBe('orders placed the last 30 days (21 Sep to 20 Oct 2026), all orders, cancelled excluded')
    expect(basisOf(run('get_sales_summary', { period: 'today' }, ctxFor(REP_A))))
      .toBe('orders placed today (20 Oct 2026), your own orders, cancelled excluded')
  })
})

describe('get_target_progress', () => {
  interface Target {
    type: string
    target: number
    achieved: number
    percent: number
    projectedPercent: number
    status: string
    daysRemaining: number
    endDate: string
  }

  it('gives a rep their own revenue target with pace, ignoring cancelled orders', () => {
    // A's October orders: O7 = 88. The cancelled O13 (20) must not count.
    const { targets } = dataOf<{ targets: Target[] }>(run('get_target_progress', {}, ctxFor(REP_A)))
    expect(targets).toHaveLength(1)
    expect(targets[0]).toMatchObject({
      type: 'revenue', target: 1000, achieved: 88, percent: 9, daysRemaining: 11, endDate: '2026-10-31',
      projectedPercent: 14, status: 'at_risk',
    })
  })

  it('gives another rep only their target', () => {
    // B: O8 and O12 fall in October, so 2 of 5 orders; the pace gives about 3.1 of 5 = 63 %.
    const { targets } = dataOf<{ targets: Target[] }>(run('get_target_progress', {}, ctxFor(REP_B)))
    expect(targets).toHaveLength(1)
    expect(targets[0]).toMatchObject({ type: 'orders', target: 5, achieved: 2, percent: 40, projectedPercent: 63, status: 'behind' })
  })

  it('reports progress past 100 percent as it is, not capped like a progress bar', () => {
    // One October order of 35 x $4 = $140 against a $100 target.
    const orders = deepFreeze([order('X1', REP_A, C1, 5, [[P1, 35]])])
    const salesTargets = deepFreeze([{ ...buildTargets()[0], targetValue: 100 }])
    const result = run('get_target_progress', {}, ctxFor(REP_A, { orders, salesTargets }))
    const [row] = dataOf<{ targets: Target[] }>(result).targets
    expect(row).toMatchObject({ target: 100, achieved: 140, percent: 140 })
  })

  it('reports 0 percent, never NaN or Infinity, for a target of zero', () => {
    const salesTargets = deepFreeze([{ ...buildTargets()[0], targetValue: 0 }])
    const result = run('get_target_progress', {}, ctxFor(REP_A, { salesTargets }))
    const [row] = dataOf<{ targets: Target[] }>(result).targets
    expect(row).toMatchObject({ target: 0, achieved: 88, percent: 0, projectedPercent: 0 })
    expect(JSON.stringify(result)).not.toMatch(/NaN|Infinity|null/)
  })

  it('matches targets on the numeric id, never the uuid', () => {
    const trap = buildTargets().map((t) => ({ ...t, userId: t.userId === REP_A.id ? (ctxFor(REP_A).user.uuid as unknown as number) : t.userId }))
    const ctx = ctxFor(REP_A, { salesTargets: deepFreeze(trap) })
    expect(dataOf<{ targets: Target[] }>(run('get_target_progress', {}, ctx)).targets).toEqual([])
  })

  it('lists only targets that are running today, boundaries included', () => {
    const base = buildTargets()[0]
    const targets = deepFreeze([
      { ...base, id: 'past', startDate: '2026-08-01', endDate: '2026-09-30' },
      { ...base, id: 'future', startDate: '2026-10-21', endDate: '2026-11-30' },
      { ...base, id: 'ends-today', startDate: '2026-10-01', endDate: '2026-10-20', targetValue: 500 },
      { ...base, id: 'starts-today', startDate: '2026-10-20', endDate: '2026-10-31', targetValue: 700 },
    ])
    const result = dataOf<{ targets: Target[] }>(run('get_target_progress', {}, ctxFor(REP_A, { salesTargets: targets })))
    expect(result.targets.map((t) => t.target).sort()).toEqual([500, 700])
  })

  it('says there are no targets rather than failing', () => {
    const result = run('get_target_progress', {}, ctxFor(REP_A, { salesTargets: [] }))
    expect(dataOf<{ targets: Target[] }>(result).targets).toEqual([])
    expect(basisOf(result)).toMatch(/targets/)
  })

  describe('for a manager', () => {
    interface PerRep { reps: Array<{ name: string; targets: Target[] }>; repCount: number }

    it('groups by rep and names them from their orders', () => {
      const { reps, repCount } = dataOf<PerRep>(run('get_target_progress', {}))
      expect(repCount).toBe(2)
      expect(reps.map((r) => r.name).sort()).toEqual(['Alice Rep', 'Bob Rep'])
    })

    it('puts the rep furthest behind first', () => {
      const { reps } = dataOf<PerRep>(run('get_target_progress', {}))
      expect(reps[0].name).toBe('Alice Rep') // 14 % projected against Bob's 63 %
    })

    it('calls a target owner with no orders "Unknown rep"', () => {
      const orphan = { ...buildTargets()[0], id: 'T9', userId: 0 }
      const ctx = ctxFor(MANAGER, { salesTargets: deepFreeze([...buildTargets(), orphan]) })
      expect(dataOf<PerRep>(run('get_target_progress', {}, ctx)).reps.map((r) => r.name)).toContain('Unknown rep')
    })

    it('shows at most ten reps and still reports how many there are', () => {
      const many = Array.from({ length: 12 }, (_, i) => ({ ...buildTargets()[0], id: `M${i}`, userId: 900 + i }))
      const ctx = ctxFor(MANAGER, { salesTargets: deepFreeze(many) })
      const result = dataOf<PerRep>(run('get_target_progress', {}, ctx))
      expect(result.reps).toHaveLength(10)
      expect(result.repCount).toBe(12)
    })
  })
})

describe('get_follow_up_list', () => {
  interface Row {
    horecaId: number
    name: string
    segment: string
    daysSinceLastOrder: number
    daysUntilReorder: number | null
    lastVisitDate: string | null
    reason: string
  }
  const rowsOf = (result: VoiceToolResult): Row[] => dataOf<{ customers: Row[] }>(result).customers

  it('lists a manager the most overdue customer first, with reasons', () => {
    const rows = rowsOf(run('get_follow_up_list', {}))
    expect(rows.map((r) => r.name)).toEqual(['Bayside Bistro', 'The Grove Restaurant', 'Harbour Cafe'])

    expect(rows[0]).toMatchObject({ horecaId: C2.id, segment: 'at_risk', daysSinceLastOrder: 40, daysUntilReorder: -31, lastVisitDate: '2026-10-19' })
    expect(rows[0].reason).toMatch(/31 days overdue/)
    expect(rows[0].reason).toMatch(/no order for 40 days/)
    expect(rows[1]).toMatchObject({ horecaId: C3.id, daysUntilReorder: 0, lastVisitDate: null })
    expect(rows[1].reason).toMatch(/due today/)
    expect(rows[2]).toMatchObject({ horecaId: C1.id, daysUntilReorder: 4, lastVisitDate: '2026-10-07' })
    expect(rows[2].reason).toMatch(/due in 4 days/)
  })

  it('does not let a cancelled order reset a customer\'s last order date', () => {
    // O13 (cancelled, 1 day ago) would make Bayside Bistro look active.
    expect(rowsOf(run('get_follow_up_list', {}))[0].daysSinceLastOrder).toBe(40)
  })

  it('caps the list at the limit and reports the full count', () => {
    const result = run('get_follow_up_list', { limit: 1 })
    expect(rowsOf(result).map((r) => r.name)).toEqual(['Bayside Bistro'])
    expect(dataOf<{ total: number }>(result).total).toBe(3)
  })

  it('sorts a longer list by how overdue each customer is, whatever order they arrive in', () => {
    // Customer k: three orders 5 days apart, the last 10 + 7k days ago => overdue by 5 + 7k days.
    const customers: HoReCa[] = Array.from({ length: 6 }, (_, k) => mkHoReCa({ id: 700 + k, name: `Cust ${k}`, address: 'x' }))
    const orders: Order[] = customers.flatMap((c, k) => {
      const last = 10 + 7 * k
      return [last + 10, last + 5, last].map((d, j) => order(`S${k}-${j}`, MANAGER, c, d, [[P1, 1]]))
    })
    const shuffled = [3, 0, 5, 1, 4, 2].map((i) => customers[i])
    const ctx = ctxFor(MANAGER, { orders: deepFreeze(orders), hoReCas: deepFreeze(shuffled) })
    expect(rowsOf(run('get_follow_up_list', { limit: 15 }, ctx)).map((r) => r.name))
      .toEqual(['Cust 5', 'Cust 4', 'Cust 3', 'Cust 2', 'Cust 1', 'Cust 0'])
    expect(rowsOf(run('get_follow_up_list', { limit: 3 }, ctx)).map((r) => r.name)).toEqual(['Cust 5', 'Cust 4', 'Cust 3'])
  })

  it('gives a rep only customers they have sold to who are at risk or declining', () => {
    const rows = rowsOf(run('get_follow_up_list', {}, ctxFor(REP_A)))
    expect(rows.map((r) => r.name)).toEqual(['Bayside Bistro'])
    expect(rows[0].reason).toMatch(/no order for 40 days/)
  })

  it('gives a rep nothing about another rep\'s customers', () => {
    // The Grove is Bob's; for Alice it is not a follow-up even though a manager sees it.
    const alice = rowsOf(run('get_follow_up_list', {}, ctxFor(REP_A)))
    expect(alice.map((r) => r.horecaId)).not.toContain(C3.id)
    expect(rowsOf(run('get_follow_up_list', {}, ctxFor(REP_B)))).toEqual([])
  })

  it('shows a rep only their own last visit, a manager the latest by anyone', () => {
    const bobVisit: Visit = { id: 'V9', hoReCaId: C2.id, userId: REP_B.id, arrivalTime: '2026-10-20T01:00:00.000Z', outcome: 'stock_check_only', photos: [], createdAt: iso(0) }
    const visits = deepFreeze([...buildVisits(), bobVisit])
    expect(rowsOf(run('get_follow_up_list', {}, ctxFor(REP_A, { visits })))[0].lastVisitDate).toBe('2026-10-19')
    expect(rowsOf(run('get_follow_up_list', {}, ctxFor(MANAGER, { visits })))[0].lastVisitDate).toBe('2026-10-20')
  })

  it('returns an empty list, with a basis, when nobody needs a call', () => {
    const result = run('get_follow_up_list', {}, ctxFor(REP_B))
    expect(dataOf<{ customers: Row[]; total: number }>(result)).toEqual({ customers: [], total: 0 })
    expect(basisOf(result).length).toBeGreaterThan(10)
  })
})

describe('find_customer', () => {
  interface Found { candidates: Array<{ id: number; name: string; address: string; score: number }>; ambiguous: boolean }

  it('finds a customer by a spoken name', () => {
    const data = dataOf<Found>(run('find_customer', { query: 'harbour cafe' }))
    expect(data.candidates[0]).toMatchObject({ id: C1.id, name: 'Harbour Cafe', score: 100 })
    expect(data.ambiguous).toBe(false)
  })

  it('returns no candidates, still ok, for a name nobody has', () => {
    expect(dataOf<Found>(run('find_customer', { query: 'zzzz' }))).toEqual({ candidates: [], ambiguous: false })
  })

  it('passes ambiguity through so the model asks which one', () => {
    const twin = mkHoReCa({ id: 14, name: 'Harbour Cafe', address: '99 Other Rd' })
    const ctx = ctxFor(MANAGER, { hoReCas: deepFreeze([C1, C2, C3, twin]) })
    const data = dataOf<Found>(run('find_customer', { query: 'harbour cafe' }, ctx))
    expect(data.candidates.map((c) => c.id).sort()).toEqual([C1.id, twin.id])
    expect(data.ambiguous).toBe(true)
  })

  it('lets a rep find only customers in their own orders', () => {
    const find = (rep: typeof REP_A, query: string): number[] =>
      dataOf<Found>(run('find_customer', { query }, ctxFor(rep))).candidates.map((c) => c.id)
    expect(find(REP_A, 'harbour')).toEqual([C1.id])
    expect(find(REP_A, 'grove')).toEqual([])
    expect(find(REP_B, 'grove')).toEqual([C3.id])
    expect(find(REP_B, 'bayside')).toEqual([])
  })

  it('searches every customer for a rep with no orders yet', () => {
    const ctx = ctxFor(REP_A, { orders: [] })
    expect(dataOf<Found>(run('find_customer', { query: 'grove' }, ctx)).candidates.map((c) => c.id)).toEqual([C3.id])
  })

  it('does not search customers a manager cannot see', () => {
    const ctx = ctxFor(MANAGER, { hoReCas: deepFreeze([C2]) })
    expect(dataOf<Found>(run('find_customer', { query: 'harbour' }, ctx)).candidates).toEqual([])
  })
})

describe('get_customer_insights', () => {
  interface Insights {
    name: string
    segment: string
    totalOrders: number
    totalSpend: number
    avgOrderValue: number
    avgDaysBetweenOrders: number | null
    predictedNextOrderDate: string | null
    daysSinceLastOrder: number | null
    lastOrderDate: string | null
    topProducts: Array<{ name: string; orderCount: number; avgQuantityPerOrder: number; isOverdue: boolean }>
    spendingTrends: Array<{ month: string; totalSpend: number; orderCount: number }>
  }
  const insights = (id: number, ctx?: VoiceToolContext): Insights => dataOf<Insights>(run('get_customer_insights', { horeca_id: id }, ctx))

  it('refuses a customer it has never heard of', () => {
    expect(run('get_customer_insights', { horeca_id: 9999 })).toEqual({ ok: false, error: 'Unknown customer' })
  })

  it('summarises a manager\'s view of a customer', () => {
    // Harbour Cafe: 91 + 121 + 132 + 88 + 120 = 552 over 5 orders.
    const data = insights(C1.id)
    expect(data).toMatchObject({
      name: 'Harbour Cafe', segment: 'growing', totalOrders: 5, totalSpend: 552, avgOrderValue: 110,
      avgDaysBetweenOrders: 12, predictedNextOrderDate: '2026-10-24', daysSinceLastOrder: 8, lastOrderDate: '2026-10-12',
    })
  })

  it('lists top products by how often they are ordered and flags the overdue ones', () => {
    const { topProducts } = insights(C1.id)
    expect(topProducts.map((p) => [p.name, p.orderCount])).toEqual([['Red Curry Paste', 5], ['Fish Sauce', 3], ['Green Curry Paste', 2]])
    expect(topProducts.map((p) => p.isOverdue)).toEqual([false, false, true])
    expect(topProducts[0].avgQuantityPerOrder).toBe(22)
  })

  it('gives monthly spend for the last three months, oldest first', () => {
    const { spendingTrends } = insights(C1.id)
    expect(spendingTrends.map((m) => [m.month, m.totalSpend, m.orderCount])).toEqual([
      ['2026-08', 91, 1], ['2026-09', 253, 2], ['2026-10', 208, 2],
    ])
  })

  it('keeps only the three latest months and eight products of a long history', () => {
    const catalogue = Array.from({ length: 10 }, (_, i) => mkProduct({ id: 300 + i, name: `Item ${i}`, price: 1 }))
    const orders = [150, 120, 90, 60, 30, 5].map((d, j) => order(`H${j}`, MANAGER, C1, d, catalogue.map((p) => [p, 1] as const)))
    const data = insights(C1.id, ctxFor(MANAGER, { orders: deepFreeze(orders) }))
    expect(data.topProducts).toHaveLength(8)
    expect(data.spendingTrends).toHaveLength(3)
    expect(data.spendingTrends.map((m) => m.month)).toEqual([...data.spendingTrends.map((m) => m.month)].sort())
  })

  it('ignores cancelled orders', () => {
    const data = insights(C2.id)
    expect(data.totalOrders).toBe(3)
    expect(data.daysSinceLastOrder).toBe(40)
  })

  it('describes a customer who has never ordered', () => {
    const fresh = mkHoReCa({ id: 77, name: 'Brand New Bar', address: 'y' })
    const data = insights(77, ctxFor(MANAGER, { hoReCas: deepFreeze([C1, fresh]) }))
    expect(data).toMatchObject({ segment: 'new', totalOrders: 0, totalSpend: 0, lastOrderDate: null, daysSinceLastOrder: null })
    expect(data.topProducts).toEqual([])
  })

  it('shows a rep only what they sold, and nothing at all of another rep\'s customer', () => {
    // Alice's four orders at Harbour Cafe: 91 + 121 + 132 + 88 = 432. Bob's O8 is not hers.
    const own = insights(C1.id, ctxFor(REP_A))
    expect(own.totalOrders).toBe(4)
    expect(own.totalSpend).toBe(432)
    expect(run('get_customer_insights', { horeca_id: C3.id }, ctxFor(REP_A))).toEqual({ ok: false, error: 'Unknown customer' })
  })
})

describe('get_suggested_order_for_customer', () => {
  interface Suggestion {
    customer: string
    total: number
    items: Array<{ productId: number; name: string; suggestedQty: number; usualQty: number; daysSinceLastBought: number; overdue: boolean }>
  }
  const suggest = (id: number, ctx?: VoiceToolContext): Suggestion =>
    dataOf<Suggestion>(run('get_suggested_order_for_customer', { horeca_id: id }, ctx))

  it('puts overdue products first, then the rest by how often they are bought', () => {
    const { items } = suggest(C1.id)
    // Green Curry Paste is overdue (2 orders). Red Curry Paste (5 orders) and Fish Sauce (3) are due within a week.
    expect(items.map((i) => i.name)).toEqual(['Green Curry Paste', 'Red Curry Paste', 'Fish Sauce'])
    expect(items.map((i) => i.overdue)).toEqual([true, false, false])
  })

  it('suggests the usual quantity and says how long since each was bought', () => {
    const { items } = suggest(C1.id)
    expect(items.map((i) => [i.suggestedQty, i.usualQty, i.daysSinceLastBought])).toEqual([[2, 2, 40], [22, 22, 8], [5, 5, 12]])
  })

  it('suggests at least one of anything it suggests', () => {
    const zero = mkProduct({ id: 310, name: 'Zero Qty', price: 1 })
    const orders = [30, 20].map((d, j) => order(`Z${j}`, MANAGER, C3, d, [[zero, 0]]))
    const { items } = suggest(C3.id, ctxFor(MANAGER, { orders: deepFreeze(orders) }))
    expect(items).toHaveLength(1)
    expect(items[0].suggestedQty).toBe(1)
  })

  it('leaves out products that are not due and customers with too little history', () => {
    // The Grove buys Red Curry Paste every 14 days and last did so 14 days ago: due today, so it is in.
    const grove = suggest(C3.id).items.map((i) => i.name)
    expect(grove).toContain('Red Curry Paste')
    // One order per product is not a pattern.
    const single = order('one', MANAGER, C3, 20, [[P1, 3]])
    expect(suggest(C3.id, ctxFor(MANAGER, { orders: deepFreeze([single]) })).items).toEqual([])
  })

  it('does not suggest a product that has been retired', () => {
    const orders = [40, 30].map((d, j) => order(`R${j}`, MANAGER, C3, d, [[P6, 4]]))
    expect(suggest(C3.id, ctxFor(MANAGER, { orders: deepFreeze(orders) })).items).toEqual([])
  })

  it('returns at most 15 and reports how many were due', () => {
    const catalogue = Array.from({ length: 20 }, (_, i) => mkProduct({ id: 400 + i, name: `Line ${i}`, price: 1 }))
    const orders = [60, 50].map((d, j) => order(`T${j}`, MANAGER, C3, d, catalogue.map((p) => [p, 1] as const)))
    const data = suggest(C3.id, ctxFor(MANAGER, { orders: deepFreeze(orders), products: deepFreeze([...buildProducts(), ...catalogue]) }))
    expect(data.items).toHaveLength(15)
    expect(data.total).toBe(20)
  })

  it('refuses an unknown customer, and another rep\'s customer to a rep', () => {
    expect(run('get_suggested_order_for_customer', { horeca_id: 9999 })).toEqual({ ok: false, error: 'Unknown customer' })
    expect(run('get_suggested_order_for_customer', { horeca_id: C3.id }, ctxFor(REP_A))).toEqual({ ok: false, error: 'Unknown customer' })
  })

  it('says it is advisory in the basis', () => {
    expect(basisOf(run('get_suggested_order_for_customer', { horeca_id: C1.id }))).toMatch(/usual/i)
  })
})

describe('get_stock_status', () => {
  interface Rows {
    filter: string
    total: number
    products: Array<{ name: string; sku: string; category: string; onHand: number; available: number; threshold: number }>
  }
  const rows = (args: Record<string, unknown>, ctx?: VoiceToolContext): Rows => dataOf<Rows>(run('get_stock_status', args, ctx))

  it('summarises health and units for active products only', () => {
    // In stock: Red Curry Paste, Fish Sauce, Rice. Low: Green Curry Paste (3 of 10). Out: Coconut Milk.
    // On hand 100 + 3 + 0 + 40 + 80 = 223; available 80 + 3 + 0 + 40 + 80 = 203. The retired product is ignored.
    expect(dataOf(run('get_stock_status', { filter: 'summary' }))).toEqual({
      inStock: 3, lowStock: 1, outOfStock: 1, onHandUnits: 223, availableUnits: 203,
    })
  })

  it('lists low stock with the numbers a buyer needs', () => {
    expect(rows({ filter: 'low' })).toEqual({
      filter: 'low', total: 1,
      products: [{ name: 'Green Curry Paste', sku: 'GCP', category: 'Meal Pastes', onHand: 3, available: 3, threshold: 10 }],
    })
  })

  it('lists out of stock separately from low', () => {
    const out = rows({ filter: 'out' })
    expect(out.products.map((p) => p.name)).toEqual(['Coconut Milk'])
    expect(out.products[0]).toMatchObject({ onHand: 0, available: 0 })
  })

  it('uses a product\'s own reorder point over the app setting', () => {
    const products = deepFreeze(buildProducts().map((p) => (p.id === P4.id ? { ...p, reorderPoint: 60 } : p)))
    const low = rows({ filter: 'low' }, ctxFor(MANAGER, { products }))
    expect(low.products.map((p) => [p.name, p.threshold])).toContainEqual(['Fish Sauce', 60])
  })

  it('never reports a retired product, even at zero', () => {
    const products = deepFreeze(buildProducts().map((p) => (p.id === P6.id ? { ...p, inventory: 0, available: 0 } : p)))
    expect(rows({ filter: 'out' }, ctxFor(MANAGER, { products })).products.map((p) => p.name)).toEqual(['Coconut Milk'])
  })

  it('filters by category without regard to case, for rows and for the summary', () => {
    expect(rows({ filter: 'low', category: 'meal pastes' }).products.map((p) => p.name)).toEqual(['Green Curry Paste'])
    expect(rows({ filter: 'out', category: 'PANTRY' }).products.map((p) => p.name)).toEqual(['Coconut Milk'])
    expect(rows({ filter: 'low', category: 'Sauces' }).products).toEqual([])
    expect(dataOf(run('get_stock_status', { filter: 'summary', category: 'sauces' }))).toMatchObject({ inStock: 1, lowStock: 0, outOfStock: 0, onHandUnits: 40 })
  })

  it('returns 15 products at most, lowest stock first, and the true total', () => {
    const many = Array.from({ length: 20 }, (_, i) => mkProduct({ id: 800 + i, sku: `S${i}`, name: `Low ${i}`, inventory: 1 + (i % 9), available: 1 + (i % 9) }))
    const out = rows({ filter: 'low' }, ctxFor(MANAGER, { products: deepFreeze(many) }))
    expect(out.products).toHaveLength(15)
    expect(out.total).toBe(20)
    const counts = out.products.map((p) => p.onHand)
    expect(counts).toEqual([...counts].sort((a, b) => a - b))
  })
})

describe('get_reorder_recommendations', () => {
  interface Reco {
    leadTimeDays: number
    total: number
    products: Array<{ name: string; onHand: number; unitsPerWeek: number; daysRemaining: number; suggestedQty: number; outOfStock: boolean }>
  }
  const reco = (args: Record<string, unknown>, ctx?: VoiceToolContext): Reco => dataOf<Reco>(run('get_reorder_recommendations', args, ctx))

  it('puts out-of-stock products that are still selling first, then those running out inside the lead time', () => {
    const { products } = reco({})
    expect(products.map((p) => p.name)).toEqual(['Coconut Milk', 'Green Curry Paste'])
    expect(products.map((p) => p.outOfStock)).toEqual([true, false])
  })

  it('works the quantity from the weekly rate, lead time and a fortnight of cover', () => {
    const [coconut, green] = reco({}).products
    // Coconut Milk: 26 units in 90 days = 2.0 a week, none on hand: ceil(2/7 x (14 + 14) - 0) = 8, zero days left.
    expect(coconut).toMatchObject({ onHand: 0, unitsPerWeek: 2, daysRemaining: 0, suggestedQty: 8 })
    // Green Curry Paste: 24 units = 1.9 a week, 3 on hand: round(3 / (1.9/7)) = 11 days, ceil(1.9/7 x 28 - 3) = 5.
    expect(green).toMatchObject({ onHand: 3, unitsPerWeek: 1.9, daysRemaining: 11, suggestedQty: 5 })
  })

  it('follows the lead time asked for', () => {
    const wide = reco({ lead_time_days: 60 })
    expect(wide.leadTimeDays).toBe(60)
    const red = wide.products.find((p) => p.name === 'Red Curry Paste')!
    // 154 units = 12.0 a week, 100 on hand: round(100 / (12/7)) = 58 days, ceil(12/7 x (60 + 14) - 100) = 27.
    expect(red).toMatchObject({ onHand: 100, unitsPerWeek: 12, daysRemaining: 58, suggestedQty: 27 })
    expect(reco({ lead_time_days: 1 }).products.map((p) => p.name)).toEqual(['Coconut Milk'])
  })

  it('caps the list at the limit and still reports the total', () => {
    const one = reco({ limit: 1 })
    expect(one.products.map((p) => p.name)).toEqual(['Coconut Milk'])
    expect(one.total).toBe(2)
  })

  it('does not recommend what is out of stock but not selling, or selling only on a cancelled order', () => {
    const products = deepFreeze(buildProducts().map((p) => (p.id === 5 ? { ...p, inventory: 0, available: 0 } : p)))
    // Jasmine Rice's only sale is the cancelled O13.
    expect(reco({}, ctxFor(MANAGER, { products })).products.map((p) => p.name)).not.toContain('Jasmine Rice 5kg')
  })

  it('does not recommend retired products', () => {
    const retired = mkProduct({ id: 9, name: 'Gone Sauce', inventory: 0, available: 0, isActive: false })
    const orders = deepFreeze([...buildOrders(), order('RT', MANAGER, C1, 5, [[retired, 50]])])
    const ctx = ctxFor(MANAGER, { orders, products: deepFreeze([...buildProducts(), retired]) })
    expect(reco({}, ctx).products.map((p) => p.name)).not.toContain('Gone Sauce')
  })
})

describe('get_product_movement', () => {
  interface Movement {
    kind: string
    total: number
    products: Array<{ name: string; category: string; unitsPerWeek: number; trend: string; currentStock: number; lastSoldDate: string | null }>
  }
  const move = (args: Record<string, unknown>, ctx?: VoiceToolContext): Movement => dataOf<Movement>(run('get_product_movement', args, ctx))

  it('ranks top movers by weekly units', () => {
    const { products } = move({ kind: 'top' })
    // Over 90 days: Red 154 units = 12.0/wk, Coconut 26 = 2.0, Green 24 = 1.9, Fish 23 = 1.8.
    expect(products.map((p) => [p.name, p.unitsPerWeek])).toEqual([
      ['Red Curry Paste', 12], ['Coconut Milk', 2], ['Green Curry Paste', 1.9], ['Fish Sauce', 1.8],
    ])
    expect(products[0]).toMatchObject({ category: 'Meal Pastes', currentStock: 100, lastSoldDate: '2026-10-12' })
    expect(['accelerating', 'declining', 'stable']).toContain(products[0].trend)
  })

  it('ranks slow movers slowest first, and only those with stock', () => {
    // Coconut Milk sells but has nothing on hand, so it cannot be a slow mover.
    expect(move({ kind: 'slow' }).products.map((p) => p.name)).toEqual(['Fish Sauce', 'Green Curry Paste', 'Red Curry Paste'])
  })

  it('finds dead stock: on the shelf and not sold for 30 days, biggest pile first', () => {
    const dead = move({ kind: 'dead' })
    // Rice has never sold (its one order was cancelled); Green Curry Paste last sold on 10 Sep.
    expect(dead.products.map((p) => [p.name, p.currentStock, p.lastSoldDate])).toEqual([
      ['Jasmine Rice 5kg', 80, null], ['Green Curry Paste', 3, '2026-09-10'],
    ])
  })

  it('slices to the limit and reports the total', () => {
    const top = move({ kind: 'top', limit: 2 })
    expect(top.products).toHaveLength(2)
    expect(top.total).toBe(4)
  })

  it('never lists a retired product', () => {
    const everything = ['top', 'slow', 'dead'].flatMap((kind) => move({ kind }).products.map((p) => p.name))
    expect(everything).not.toContain('Retired Sauce')
  })

  it('counts a rep\'s own orders only, and says so', () => {
    const result = run('get_product_movement', { kind: 'top' }, ctxFor(REP_B))
    // Bob sold 74 Red Curry Paste (5.8/wk) and 8 Fish Sauce (0.6/wk) and nothing else.
    expect(dataOf<Movement>(result).products.map((p) => [p.name, p.unitsPerWeek])).toEqual([['Red Curry Paste', 5.8], ['Fish Sauce', 0.6]])
    expect(basisOf(result)).toContain('your own orders')
  })

  it('says it is the last 90 days and that stock is what is on hand', () => {
    const text = basisOf(run('get_product_movement', { kind: 'top' }))
    expect(text).toMatch(/90 days/)
    expect(text).toMatch(/on hand/)
  })
})

describe('get_visit_stats', () => {
  interface Stats {
    planned: number
    completed: number
    skipped: number
    completionRate: number
    visits: number
    ordersPlaced: number
    conversionRate: number
  }
  const stats = (period: string, ctx?: VoiceToolContext): Stats => dataOf<Stats>(run('get_visit_stats', { period }, ctx ?? ctxFor(REP_A)))

  it('reports a month of routes and visits', () => {
    // Routes R1 (2 stops: 1 arrived, 1 skipped) and R2 (2 stops: 1 arrived, 1 pending); visits V1 and V2, one an order.
    expect(stats('this_month')).toEqual({ planned: 4, completed: 2, skipped: 1, completionRate: 50, visits: 2, ordersPlaced: 1, conversionRate: 50 })
  })

  it('reports this week on its own', () => {
    expect(stats('this_week')).toEqual({ planned: 2, completed: 1, skipped: 0, completionRate: 50, visits: 1, ordersPlaced: 0, conversionRate: 0 })
  })

  it('reports an empty month as zeros', () => {
    expect(stats('last_month')).toEqual({ planned: 0, completed: 0, skipped: 0, completionRate: 0, visits: 0, ordersPlaced: 0, conversionRate: 0 })
  })

  it('counts only the caller\'s own routes and visits', () => {
    const extraRoute = { ...buildExtraRoute(), createdBy: REP_B.id }
    const extraVisit: Visit = { id: 'V8', hoReCaId: C3.id, userId: REP_B.id, arrivalTime: '2026-10-19T12:00:00.000Z', outcome: 'order_placed', photos: [], createdAt: iso(1) }
    const ctx = ctxFor(REP_A, { routes: deepFreeze([...ctxFor(REP_A).routes, extraRoute]), visits: deepFreeze([...buildVisits(), extraVisit]) })
    expect(stats('this_month', ctx)).toEqual(stats('this_month'))
    expect(stats('this_month', ctxFor(REP_B, { routes: ctx.routes, visits: ctx.visits }))).toMatchObject({ planned: 1, visits: 1, ordersPlaced: 1 })
  })

  it('names the period and whose visits in the basis', () => {
    const text = basisOf(run('get_visit_stats', { period: 'this_month' }, ctxFor(REP_A)))
    expect(text).toContain('this month (1 Oct to 20 Oct 2026)')
    expect(text).toContain('your')
  })
})

function buildExtraRoute(): VoiceToolContext['routes'][number] {
  return {
    id: 'R3', name: 'Other rep run', date: '2026-10-15', status: 'completed', createdBy: REP_B.id, createdAt: iso(5),
    stops: [{ hoReCaId: C3.id, sequence: 1, status: 'arrived' }],
  }
}

describe('fixtures sanity', () => {
  it('has the thirteen orders, two reps and a cancelled order the numbers above rely on', () => {
    const orders = buildOrders()
    expect(orders).toHaveLength(13)
    expect(orders.filter((o) => o.status === 'cancelled').map((o) => o.id)).toEqual(['O13'])
    expect(new Set(orders.map((o) => o.submittedBy.id))).toEqual(new Set([REP_A.id, REP_B.id]))
    expect(NOW.getUTCDay()).toBe(2)
  })

  it('keeps product ids stable for the stock tests', () => {
    const ids = buildProducts().map((p: Product) => p.id)
    expect(ids).toEqual([P1.id, P2.id, 3, P4.id, 5, P6.id])
  })
})
