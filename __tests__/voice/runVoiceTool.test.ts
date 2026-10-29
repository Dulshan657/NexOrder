import { describe, it, expect, vi } from 'vitest'
import { UserRole } from '../../types'
import type { User } from '../../types'
import { VOICE_TOOL_NAMES, toolsForRole } from '../../supabase/functions/_shared/voice/toolSchemas'
import type { VoiceToolName } from '../../supabase/functions/_shared/voice/toolSchemas'
import { runVoiceTool } from '../../lib/voice/runVoiceTool'
import type { VoiceToolResult } from '../../lib/voice/runVoiceTool'
import { getReorderRecommendations } from '../../lib/voice/tools/getReorderRecommendations'
import { MAX_RESULT_CHARS } from '../../lib/voice/resultBudget'
import {
  ALL_MODULES, C1, C2, C3, DAY_MS, MANAGER, MINIMAL_ARGS, NOW, OFFICE_REP, REP_A, REP_B,
  buildBulkWorld, buildOrders, ctxFor, deepFreeze,
} from './voiceFixtures'
import { mkHoReCa, mkUser } from '../fixtures'

// A spy that still runs the real implementation: the other tests in this file call
// the tool for real, and the refusal test needs to see whether it was reached.
vi.mock('../../lib/voice/tools/getReorderRecommendations', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/voice/tools/getReorderRecommendations')>()
  return { ...actual, getReorderRecommendations: vi.fn(actual.getReorderRecommendations) }
})

const NOT_AVAILABLE = { ok: false, error: 'Not available for your role' }
const AMADIYA = ['sales_orders', 'inventory_dispatch', 'voice_assistant']
const SALES_ONLY = ['sales_orders', 'voice_assistant']

interface SalesData {
  revenue: number
  orderCount: number
  averageOrderValue: number
  newCustomers: number
  topCustomers: Array<{ horecaId: number; name: string; revenue: number }>
  topProducts: Array<{ name: string; units: number }>
  previous?: { revenue: number; orderCount: number; deltaPercent: number | null }
}

function run(name: string, args: unknown, ctx = ctxFor(MANAGER)): VoiceToolResult {
  return runVoiceTool(name, args, ctx)
}

function dataOf<T>(result: VoiceToolResult): T {
  if (result.ok === false) throw new Error(`expected ok, got: ${result.error}`)
  return result.data as T
}

const daysAgoOf = (orderDate: string): number => (NOW.getTime() - new Date(orderDate).getTime()) / DAY_MS
const sum = (xs: number[]): number => xs.reduce((a, b) => a + b, 0)

describe('runVoiceTool', () => {
  it('sales summary for a rep counts only their own orders', () => {
    const ctx = ctxFor(REP_A)

    // Independent oracle straight off the fixture: A's live orders in the last 30 days.
    const live = ctx.orders.filter((o) => o.status !== 'cancelled' && daysAgoOf(o.orderDate) <= 29.99)
    const own = live.filter((o) => o.submittedBy.id === REP_A.id)
    const everyone = sum(live.map((o) => o.total))
    expect(own).toHaveLength(2)
    expect(Math.round(sum(own.map((o) => o.total)))).toBe(220)
    expect(Math.round(everyone)).toBe(460) // the fixture can tell the two apart

    const result = run('get_sales_summary', { period: 'last_30_days' }, ctx)
    const data = dataOf<SalesData>(result)
    expect(data.orderCount).toBe(2)
    expect(data.revenue).toBe(220)
    expect(data.revenue).not.toBe(Math.round(everyone))
    expect(data.topCustomers.map((c) => c.name)).toEqual(['Harbour Cafe'])
    expect(result.ok === true && result.basis).toContain('your own orders')

    // Arguments that try to widen scope change nothing about whose orders count.
    const otherRepsCustomer = dataOf<SalesData>(run('get_sales_summary', { period: 'last_30_days', horeca_id: C3.id }, ctx))
    expect(otherRepsCustomer.orderCount).toBe(0)
    expect(otherRepsCustomer.revenue).toBe(0)

    const sharedCustomer = dataOf<SalesData>(run('get_sales_summary', { period: 'last_30_days', horeca_id: C1.id }, ctx))
    expect(sharedCustomer.orderCount).toBe(2) // O6 and O7; B's O8 at the same customer is not theirs
    expect(sharedCustomer.revenue).toBe(220)

    // There is no argument for another rep, and an invented one is refused, not obeyed.
    expect(run('get_sales_summary', { period: 'last_30_days', rep_id: REP_B.id }, ctx).ok).toBe(false)
    expect(run('get_sales_summary', { period: 'last_30_days', submitted_by: REP_B.id }, ctx).ok).toBe(false)

    // The previous window is scoped the same way.
    expect(data.previous?.orderCount).toBe(5)
    expect(data.previous?.revenue).toBe(412)

    // A manager asking the very same question sees everyone.
    const manager = dataOf<SalesData>(run('get_sales_summary', { period: 'last_30_days' }, ctxFor(MANAGER)))
    expect(manager.orderCount).toBe(live.length)
    expect(manager.revenue).toBe(Math.round(everyone))
  })

  it('refuses a tool the role may not use', () => {
    const reorder = vi.mocked(getReorderRecommendations)
    reorder.mockClear()
    const rep = ctxFor(REP_A)
    expect(run('get_reorder_recommendations', {}, rep)).toEqual(NOT_AVAILABLE)

    // Permission is decided before the arguments are looked at, so a bad call to a
    // forbidden tool says nothing about what the arguments should have been.
    expect(run('get_reorder_recommendations', { lead_time_days: 'soon' }, rep)).toEqual(NOT_AVAILABLE)
    expect(run('get_reorder_recommendations', 42, rep)).toEqual(NOT_AVAILABLE)

    // Refusing is not enough: the tool behind the refusal must never have run.
    expect(reorder).not.toHaveBeenCalled()

    // The same call is fine for a manager, and that one does reach the tool.
    expect(run('get_reorder_recommendations', {}, ctxFor(MANAGER)).ok).toBe(true)
    expect(reorder).toHaveBeenCalledTimes(1)
  })
})

describe('runVoiceTool permissions', () => {
  const roles = [
    UserRole.ADMIN, UserRole.MANAGER, UserRole.FIELD_REP, UserRole.OFFICE_REP,
    UserRole.WAREHOUSE, UserRole.CUSTOMER, UserRole.QR_STAFF, 'Nobody',
  ]
  const moduleSets: Array<[string, readonly string[]]> = [
    ['every module', ALL_MODULES], ['the Amadiya set', AMADIYA], ['sales only', SALES_ONLY],
  ]

  it.each(roles.flatMap((role) => moduleSets.map(([label, modules]) => [role, label, modules] as const)))(
    'decides %s with %s exactly as toolsForRole does',
    (role, _label, modules) => {
      const ctx = ctxFor(mkUser({ id: 150, role: role as UserRole }), { modules })
      const offered = new Set(toolsForRole(role, modules).map((t) => t.name))
      for (const name of VOICE_TOOL_NAMES) {
        const result = run(name, MINIMAL_ARGS[name], ctx)
        if (offered.has(name)) expect(result.ok === false && result.error).not.toBe(NOT_AVAILABLE.error)
        else expect(result).toEqual(NOT_AVAILABLE)
      }
    },
  )

  it('withholds the warehouse tools when the inventory module is off', () => {
    const ctx = ctxFor(MANAGER, { modules: SALES_ONLY })
    for (const name of ['get_stock_status', 'get_reorder_recommendations', 'get_product_movement']) {
      expect(run(name, MINIMAL_ARGS[name], ctx)).toEqual(NOT_AVAILABLE)
    }
    expect(run('get_sales_summary', { period: 'today' }, ctx).ok).toBe(true)
  })

  it('withholds visit stats without the field ops module, and from every role but the field rep', () => {
    expect(run('get_visit_stats', { period: 'this_week' }, ctxFor(REP_A, { modules: AMADIYA }))).toEqual(NOT_AVAILABLE)
    expect(run('get_visit_stats', { period: 'this_week' }, ctxFor(OFFICE_REP))).toEqual(NOT_AVAILABLE)
    expect(run('get_visit_stats', { period: 'this_week' }, ctxFor(MANAGER))).toEqual(NOT_AVAILABLE)
    expect(run('get_visit_stats', { period: 'this_week' }, ctxFor(REP_A)).ok).toBe(true)
  })

  it('offers the warehouse role nothing at all', () => {
    const ctx = ctxFor(mkUser({ id: 160, role: UserRole.WAREHOUSE }))
    for (const name of VOICE_TOOL_NAMES) expect(run(name, MINIMAL_ARGS[name], ctx)).toEqual(NOT_AVAILABLE)
  })
})

describe('runVoiceTool input handling', () => {
  it('rejects a tool it has never heard of, including names that live on Object.prototype', () => {
    for (const name of ['get_weather', 'constructor', '__proto__', 'toString', '']) {
      expect(run(name, {})).toEqual({ ok: false, error: 'Unknown tool' })
    }
  })

  it('turns invalid arguments into a readable error naming the field', () => {
    const result = run('get_sales_summary', { period: 'next_year' })
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.error).toMatch(/^Invalid arguments: /)
    expect(result.ok === false && result.error).toMatch(/period/)
  })

  it('names the missing required argument', () => {
    const result = run('get_customer_insights', {})
    expect(result.ok === false && result.error).toMatch(/horeca_id/)
  })

  it('reports an unexpected argument', () => {
    const result = run('find_customer', { query: 'harbour', limit: 3 })
    expect(result.ok === false && result.error).toMatch(/limit/)
  })

  it('reads missing arguments as an empty object', () => {
    expect(run('get_target_progress', undefined).ok).toBe(true)
    expect(run('get_target_progress', null).ok).toBe(true)
    expect(run('get_customer_insights', undefined).ok).toBe(false)
  })

  it('refuses arguments that are not an object', () => {
    for (const bad of ['{"period":"today"}', 7, true, ['today']]) {
      const result = run('get_sales_summary', bad)
      expect(result.ok).toBe(false)
      expect(result.ok === false && result.error).toMatch(/^Invalid arguments/)
    }
  })

  it('keeps the error short enough to be spoken', () => {
    const result = run('get_sales_summary', { period: 'x', from: 1, to: 2, compare_previous: 'y', horeca_id: 'z', extra: 1 })
    expect(result.ok === false && result.error.length).toBeLessThan(400)
  })
})

describe('runVoiceTool result contract', () => {
  const callers: Array<[VoiceToolName, User]> = VOICE_TOOL_NAMES.map((name) => [
    name, name === 'get_visit_stats' ? REP_A : MANAGER,
  ])

  it.each(callers)('%s returns a basis and the time it was computed', (name, caller) => {
    const result = run(name, MINIMAL_ARGS[name], ctxFor(caller))
    expect(result.ok).toBe(true)
    if (result.ok === false) return
    expect(typeof result.basis).toBe('string')
    expect(result.basis.trim().length).toBeGreaterThan(10)
    expect(result.asOf).toBe(NOW.toISOString())
    expect(result.data).toBeDefined()
  })

  it('is deterministic: the same question twice gives the same answer', () => {
    for (const [name, caller] of callers) {
      const ctx = ctxFor(caller)
      expect(run(name, MINIMAL_ARGS[name], ctx)).toEqual(run(name, MINIMAL_ARGS[name], ctx))
    }
  })

  it('never modifies the context it is given', () => {
    // Fixtures are deep-frozen, so a write would throw; the snapshot catches a swallowed one.
    for (const caller of [REP_A, REP_B, MANAGER]) {
      const ctx = ctxFor(caller)
      const before = JSON.stringify(ctx)
      for (const name of VOICE_TOOL_NAMES) {
        expect(() => run(name, MINIMAL_ARGS[name], ctx)).not.toThrow()
      }
      expect(JSON.stringify(ctx)).toBe(before)
      expect(ctx.now.getTime()).toBe(NOW.getTime())
    }
  })

  it('returns plain JSON: it survives a round trip unchanged', () => {
    const result = run('get_sales_summary', { period: 'last_30_days' })
    expect(JSON.parse(JSON.stringify(result))).toEqual(result)
  })
})

describe('runVoiceTool when the data is bad', () => {
  const broken = (): ReturnType<typeof ctxFor> => {
    const orders = buildOrders()
    const hurt = { ...orders[0], items: undefined as unknown as never[] }
    return ctxFor(MANAGER, { orders: deepFreeze([hurt, ...orders.slice(1)]) })
  }

  it('answers with an error instead of throwing, and reports what happened', () => {
    const onError = vi.fn()
    const result = runVoiceTool('get_customer_insights', { horeca_id: C2.id }, broken(), { onError })
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.error).toBe('That lookup failed')
    expect(onError).toHaveBeenCalledTimes(1)
    expect(onError.mock.calls[0][0]).toBe('get_customer_insights')
    expect(onError.mock.calls[0][1]).toBeInstanceOf(Error)
  })

  it('does not echo internal error text to the model', () => {
    const result = runVoiceTool('get_customer_insights', { horeca_id: C2.id }, broken())
    expect(JSON.stringify(result)).not.toMatch(/undefined|TypeError|iterable|items/)
  })

  it('survives a clock that is not a real instant', () => {
    const result = runVoiceTool('get_sales_summary', { period: 'today' }, ctxFor(MANAGER, { now: new Date('nonsense') }))
    expect(result.ok).toBe(false)
  })

  it('survives an onError callback that throws', () => {
    const result = runVoiceTool('get_customer_insights', { horeca_id: C2.id }, broken(), {
      onError: () => { throw new Error('reporter down') },
    })
    expect(result.ok).toBe(false)
  })

  it('does not report refusals and bad arguments as faults', () => {
    const onError = vi.fn()
    runVoiceTool('get_reorder_recommendations', {}, ctxFor(REP_A), { onError })
    runVoiceTool('get_sales_summary', { period: 'next_year' }, ctxFor(MANAGER), { onError })
    runVoiceTool('nope', {}, ctxFor(MANAGER), { onError })
    expect(onError).not.toHaveBeenCalled()
  })
})

describe('runVoiceTool result size', () => {
  type Call = [VoiceToolName, Record<string, unknown>]
  const managerCalls: Call[] = [
    ['get_sales_summary', { period: 'last_30_days' }],
    ['get_sales_summary', { period: 'custom', from: '2026-07-01', to: '2026-10-20' }],
    ['get_target_progress', {}],
    ['get_follow_up_list', { limit: 15 }],
    ['find_customer', { query: 'customer' }],
    ['get_customer_insights', { horeca_id: 1000 }],
    ['get_suggested_order_for_customer', { horeca_id: 1000 }],
    ['get_stock_status', { filter: 'summary' }],
    ['get_stock_status', { filter: 'low' }],
    ['get_stock_status', { filter: 'out' }],
    ['get_reorder_recommendations', { limit: 15, lead_time_days: 60 }],
    ['get_product_movement', { kind: 'top', limit: 15 }],
    ['get_product_movement', { kind: 'slow', limit: 15 }],
    ['get_product_movement', { kind: 'dead', limit: 15 }],
  ]
  const repCalls: Call[] = [
    ['get_sales_summary', { period: 'last_30_days' }],
    ['get_target_progress', {}],
    ['get_follow_up_list', { limit: 15 }],
    ['find_customer', { query: 'customer' }],
    ['get_customer_insights', { horeca_id: 1000 }],
    ['get_suggested_order_for_customer', { horeca_id: 1000 }],
    ['get_visit_stats', { period: 'this_month' }],
  ]

  it.each(managerCalls)('keeps %s %j under the cap with 500 orders in the cache', (name, args) => {
    const result = run(name, args, ctxFor(MANAGER, buildBulkWorld(500)))
    expect(result.ok).toBe(true)
    expect(JSON.stringify(result).length).toBeLessThan(MAX_RESULT_CHARS)
  })

  it.each(repCalls)('keeps the rep version of %s %j under the cap with 500 orders in the cache', (name, args) => {
    const result = run(name, args, ctxFor(REP_A, buildBulkWorld(500)))
    expect(result.ok).toBe(true)
    expect(JSON.stringify(result).length).toBeLessThan(MAX_RESULT_CHARS)
  })

  it('halves long lists to fit and says it did', () => {
    // 15 customers with very long names: the list alone is larger than the cap.
    const long = Array.from({ length: 20 }, (_, i) => mkHoReCa({ id: 500 + i, name: `${'Long Name '.repeat(20)}${i}`, address: 'x' }))
    const orders = long.flatMap((customer, i) =>
      [90, 60, 40].map((daysAgo, j) => ({ ...buildOrders()[0], id: `L${i}-${j}`, hoReCa: customer, orderDate: new Date(NOW.getTime() - (daysAgo + i) * DAY_MS).toISOString(), submittedBy: MANAGER })),
    )
    const result = run('get_follow_up_list', { limit: 15 }, ctxFor(MANAGER, { orders: deepFreeze(orders), hoReCas: deepFreeze(long) }))
    expect(result.ok).toBe(true)
    expect(JSON.stringify(result).length).toBeLessThan(MAX_RESULT_CHARS)
    const data = dataOf<{ customers: unknown[]; truncated?: boolean }>(result)
    expect(data.truncated).toBe(true)
    expect(data.customers.length).toBeLessThan(15)
  })
})
