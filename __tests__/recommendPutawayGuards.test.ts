import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// NX-0032 fix round 1: three guards on recommend-putaway, which the receive
// screen's Retry now calls. They live in _shared so they can be tested without
// the edge runtime (recommend-putaway/index.ts imports Deno-only modules).
//
//   1. Who may put away at a warehouse: the same rule receive-stock uses to say
//      who may receive there. A dock user with NO home site is unrestricted.
//   2. A receipt named in the request must have landed in the warehouse named.
//   3. A Retry is idempotent: a receipt that already has open tasks is not put
//      away twice.
import { assertMayActAtWarehouse } from '../supabase/functions/_shared/receiveDestination'
import {
  assertReceiptRequestAllowed,
  PUTAWAY_TASKS_EXIST_MESSAGE,
  PUTAWAY_TASKS_EXIST_REASON,
} from '../supabase/functions/_shared/putawayReceiptGuards'
import { EdgeFunctionError } from '../supabase/functions/_shared/errors'

const MESSAGE = 'You can only put away stock at your own warehouse'
const warehouseActor = (homeWarehouseId: number | null) => ({ role: 'Warehouse', homeWarehouseId })

async function refusal(promise: Promise<void>): Promise<EdgeFunctionError> {
  const err = await promise.then(() => null, (e: unknown) => e)
  expect(err).toBeInstanceOf(EdgeFunctionError)
  return err as EdgeFunctionError
}

describe('assertMayActAtWarehouse', () => {
  it('lets a Warehouse role with NO home site act anywhere (the receive-stock rule)', () => {
    expect(() => assertMayActAtWarehouse(warehouseActor(null), 9, MESSAGE)).not.toThrow()
  })

  it('refuses a Warehouse role whose home site is a different warehouse', () => {
    let thrown: unknown
    try {
      assertMayActAtWarehouse(warehouseActor(5), 9, MESSAGE)
    } catch (e) {
      thrown = e
    }
    expect(thrown).toBeInstanceOf(EdgeFunctionError)
    expect((thrown as EdgeFunctionError).code).toBe('FORBIDDEN')
    expect((thrown as EdgeFunctionError).status).toBe(403)
    expect((thrown as EdgeFunctionError).message).toBe(MESSAGE)
  })

  it('lets a Warehouse role act at its own home site', () => {
    expect(() => assertMayActAtWarehouse(warehouseActor(9), 9, MESSAGE)).not.toThrow()
  })

  it('never restricts Admin or Manager', () => {
    expect(() => assertMayActAtWarehouse({ role: 'Admin', homeWarehouseId: 5 }, 9, MESSAGE)).not.toThrow()
    expect(() => assertMayActAtWarehouse({ role: 'Manager', homeWarehouseId: null }, 9, MESSAGE)).not.toThrow()
  })

  it('has nothing to check when no warehouse is named', () => {
    expect(() => assertMayActAtWarehouse(warehouseActor(5), null, MESSAGE)).not.toThrow()
    expect(() => assertMayActAtWarehouse(warehouseActor(5), undefined, MESSAGE)).not.toThrow()
  })
})

interface Reply {
  receipt?: { id: number; location_id: number } | null
  receiptError?: { message: string }
  openTasks?: Array<{ id: number }>
  tasksError?: { message: string }
}

/** A client that answers the two reads the guard makes, and logs what it was asked. */
function adminReplying(reply: Reply) {
  const calls: string[] = []
  const taskFilters: Array<[string, unknown]> = []
  const admin = {
    from(table: string) {
      calls.push(table)
      return {
        select: () => {
          const chain: Record<string, unknown> = {
            eq: (col: string, val: unknown) => {
              taskFilters.push([`${table}.${col}`, val])
              return chain
            },
            in: (col: string, val: unknown) => {
              taskFilters.push([`${table}.${col}`, val])
              return chain
            },
            limit: () => chain,
            maybeSingle: async () =>
              reply.receiptError
                ? { data: null, error: reply.receiptError }
                : { data: reply.receipt ?? null, error: null },
            then: (res: (v: { data: unknown; error: unknown }) => unknown) =>
              Promise.resolve(
                reply.tasksError
                  ? { data: null, error: reply.tasksError }
                  : { data: reply.openTasks ?? [], error: null },
              ).then(res),
          }
          return chain
        },
      }
    },
  }
  return { admin: admin as unknown as Parameters<typeof assertReceiptRequestAllowed>[0], calls, taskFilters }
}

describe('assertReceiptRequestAllowed', () => {
  let logged: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    logged = vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => {
    logged.mockRestore()
  })

  it('asks nothing when the request names no receipt', async () => {
    const { admin, calls } = adminReplying({})
    await assertReceiptRequestAllowed(admin, { warehouseId: 9 })
    expect(calls).toEqual([])
  })

  it('allows a receipt that landed in this warehouse and has no open tasks', async () => {
    const { admin, calls, taskFilters } = adminReplying({ receipt: { id: 501, location_id: 9 }, openTasks: [] })
    await assertReceiptRequestAllowed(admin, { warehouseId: 9, goodsReceiptId: 501 })
    expect(calls).toEqual(['goods_receipts', 'wie_putaway_recommendations'])
    expect(taskFilters).toContainEqual(['goods_receipts.id', 501])
    expect(taskFilters).toContainEqual(['wie_putaway_recommendations.goods_receipt_id', 501])
    // Open means still on its way to a bin, nothing else.
    expect(taskFilters).toContainEqual(['wie_putaway_recommendations.status', ['suggested', 'assigned']])
  })

  describe('the receipt must belong to the warehouse', () => {
    it('refuses a receipt that landed in another warehouse', async () => {
      const { admin, calls } = adminReplying({ receipt: { id: 501, location_id: 4 } })
      const err = await refusal(assertReceiptRequestAllowed(admin, { warehouseId: 9, goodsReceiptId: 501 }))
      expect(err.code).toBe('INVALID_INPUT')
      expect(err.message).toContain('501')
      // Refused before it looked at anyone's tasks.
      expect(calls).toEqual(['goods_receipts'])
    })

    it('refuses a receipt that does not exist', async () => {
      const { admin } = adminReplying({ receipt: null })
      const err = await refusal(assertReceiptRequestAllowed(admin, { warehouseId: 9, goodsReceiptId: 501 }))
      expect(err.code).toBe('INVALID_INPUT')
    })

    it('fails closed when the receipt cannot be read', async () => {
      const { admin } = adminReplying({ receiptError: { message: 'boom' } })
      const err = await refusal(assertReceiptRequestAllowed(admin, { warehouseId: 9, goodsReceiptId: 501 }))
      expect(err.code).toBe('INTERNAL')
      expect(logged).toHaveBeenCalledWith(expect.stringContaining('boom'))
    })

    it('still checks the warehouse on a re-run and on a dry run', async () => {
      const rerun = adminReplying({ receipt: { id: 501, location_id: 4 } })
      const err1 = await refusal(
        assertReceiptRequestAllowed(rerun.admin, { warehouseId: 9, goodsReceiptId: 501, replacesRecommendationId: 77 }),
      )
      expect(err1.code).toBe('INVALID_INPUT')

      const dry = adminReplying({ receipt: { id: 501, location_id: 4 } })
      const err2 = await refusal(
        assertReceiptRequestAllowed(dry.admin, { warehouseId: 9, goodsReceiptId: 501, dryRun: true }),
      )
      expect(err2.code).toBe('INVALID_INPUT')
    })
  })

  describe('a retry is idempotent', () => {
    it('refuses with CONFLICT when the receipt already has open tasks', async () => {
      const { admin } = adminReplying({ receipt: { id: 501, location_id: 9 }, openTasks: [{ id: 1 }] })
      const err = await refusal(assertReceiptRequestAllowed(admin, { warehouseId: 9, goodsReceiptId: 501 }))
      expect(err.code).toBe('CONFLICT')
      expect(err.status).toBe(409)
      expect(err.message).toBe('Putaway tasks already exist for this receipt.')
      expect(err.message).toBe(PUTAWAY_TASKS_EXIST_MESSAGE)
      // A stable marker, so the screen does not have to match prose.
      expect(err.details).toEqual({ reason: PUTAWAY_TASKS_EXIST_REASON })
    })

    it('fails closed when the open tasks cannot be read', async () => {
      const { admin } = adminReplying({ receipt: { id: 501, location_id: 9 }, tasksError: { message: 'boom' } })
      const err = await refusal(assertReceiptRequestAllowed(admin, { warehouseId: 9, goodsReceiptId: 501 }))
      expect(err.code).toBe('INTERNAL')
      expect(logged).toHaveBeenCalledWith(expect.stringContaining('boom'))
    })

    it('does not count the row a re-run is replacing', async () => {
      // The queue's Re-run names the receipt of a task that is itself open.
      const { admin, calls } = adminReplying({ receipt: { id: 501, location_id: 9 }, openTasks: [{ id: 77 }] })
      await assertReceiptRequestAllowed(admin, { warehouseId: 9, goodsReceiptId: 501, replacesRecommendationId: 77 })
      expect(calls).toEqual(['goods_receipts'])
    })

    it('does not count open tasks for a dry run, which creates none', async () => {
      const { admin, calls } = adminReplying({ receipt: { id: 501, location_id: 9 }, openTasks: [{ id: 1 }] })
      await assertReceiptRequestAllowed(admin, { warehouseId: 9, goodsReceiptId: 501, dryRun: true })
      expect(calls).toEqual(['goods_receipts'])
    })
  })
})
