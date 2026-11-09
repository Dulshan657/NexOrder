import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// NX-0032: what receive-stock does when putaway cannot read a product's home
// bin. The receipt is already committed by then (putaway is advice), so the
// response still says ok and carries the receipt, plus `putaway_error` and the
// exact `putaway_lines` it tried, for the receive screen's Retry. Any other
// putaway failure stays silent, as before.
import { putawayForReceipt, receiveStockBody } from '../supabase/functions/_shared/receivePutaway'
import { generatePutawayTasks, type GeneratePutawayResult } from '../supabase/functions/_shared/putawayTasks'
import { EdgeFunctionError } from '../supabase/functions/_shared/errors'
import { HOME_UNAVAILABLE } from '../supabase/functions/_shared/putawayHomeBlock'

const RECEIPT = { lines_received: 1, receipt_id: 501, location_id: 9 }

/** What receive-stock hands generatePutawayTasks: base units, plate, hold flag. */
const LINES = [
  { product_id: 1, quantity: 48, hu_type: 'pallet' as const, hu_id: 900, quarantine: false },
  { product_id: 2, quantity: 6, hu_type: 'carton' as const, hu_id: 901, quarantine: true },
]

const ENGINE: GeneratePutawayResult = { mode: 'engine', layoutId: 3, recommendations: [] }

/** A client where every read is empty, except product_home_bins, which fails. */
function adminWithFailingHomeRead() {
  const inserted: unknown[] = []
  const racked = { id: 9, kind: 'WAREHOUSE', location_type: 'racked', active_layout_id: 3 }
  const builder = (table: string) => {
    const failed = table === 'product_home_bins'
    const error = failed ? { message: 'boom' } : null
    const rows = table === 'locations' ? [racked] : []
    const b = {
      eq: () => b,
      in: () => b,
      or: () => b,
      order: () => b,
      maybeSingle: async () => ({ data: failed ? null : rows[0] ?? null, error }),
      single: async () => ({ data: failed ? null : rows[0] ?? null, error }),
      then: (res: (v: { data: unknown; error: unknown }) => unknown) =>
        Promise.resolve({ data: failed ? null : rows, error }).then(res),
    }
    return b
  }
  const admin = {
    from: (table: string) => ({
      select: () => builder(table),
      insert: (row: unknown) => {
        inserted.push(row)
        return { select: () => ({ single: async () => ({ data: { id: 1 }, error: null }) }) }
      },
    }),
    rpc: async () => ({ data: [], error: null }),
  }
  return { admin: admin as unknown as Parameters<typeof generatePutawayTasks>[0], inserted }
}

describe('putawayForReceipt', () => {
  let logged: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    logged = vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => {
    logged.mockRestore()
  })

  it('passes the putaway result through when it works', async () => {
    const generate = vi.fn(async () => ENGINE)
    const outcome = await putawayForReceipt(LINES, generate)
    expect(outcome).toEqual({ putaway: ENGINE })
    expect('putaway_error' in outcome).toBe(false)
    expect('putaway_lines' in outcome).toBe(false)
    expect(generate).toHaveBeenCalledWith(LINES)
  })

  it('turns a failed home read into putaway_error, with the lines to retry', async () => {
    const outcome = await putawayForReceipt(LINES, async () => {
      throw new EdgeFunctionError('INTERNAL', HOME_UNAVAILABLE)
    })
    expect(outcome).toEqual({
      putaway: null,
      putaway_error: 'Home bin unavailable, try again.',
      putaway_lines: LINES,
    })
  })

  it.each([
    ['a rule load failure', new Error('rule load failed: boom')],
    ['a product that is gone', new Error('Product 4 not found')],
    ['another internal error', new EdgeFunctionError('INTERNAL', 'something else broke')],
    ['a refusal', new EdgeFunctionError('CONFLICT', HOME_UNAVAILABLE)],
    ['a non-Error throw', 'boom'],
  ])('keeps today\'s silence for %s', async (_name, thrown) => {
    const outcome = await putawayForReceipt(LINES, async () => {
      throw thrown
    })
    expect(outcome).toEqual({ putaway: null })
    expect('putaway_error' in outcome).toBe(false)
    expect('putaway_lines' in outcome).toBe(false)
  })
})

describe('receiveStockBody', () => {
  it('is the same body as before when putaway worked', () => {
    expect(receiveStockBody(RECEIPT, { putaway: ENGINE })).toEqual({ ok: true, result: RECEIPT, putaway: ENGINE })
  })

  it('keeps the receipt and adds putaway_error and putaway_lines when the home could not be read', () => {
    expect(
      receiveStockBody(RECEIPT, { putaway: null, putaway_error: HOME_UNAVAILABLE, putaway_lines: LINES }),
    ).toEqual({
      ok: true,
      result: RECEIPT,
      putaway: null,
      putaway_error: 'Home bin unavailable, try again.',
      putaway_lines: LINES,
    })
  })
})

describe('receive-stock with an unreadable home bin', () => {
  let logged: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    logged = vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => {
    logged.mockRestore()
  })

  it('books the receipt, creates no task and returns putaway_error', async () => {
    const { admin, inserted } = adminWithFailingHomeRead()

    const outcome = await putawayForReceipt(LINES, (lines) =>
      generatePutawayTasks(admin, { warehouseId: 9, lines, actorId: 'u1', goodsReceiptId: 501 }),
    )
    const body = receiveStockBody(RECEIPT, outcome)

    expect(body).toEqual({
      ok: true,
      result: RECEIPT,
      putaway: null,
      putaway_error: 'Home bin unavailable, try again.',
      // Exactly what was tried, so a Retry sends the same plates and hold flags.
      putaway_lines: LINES,
    })
    expect(inserted).toHaveLength(0)
    expect(logged).toHaveBeenCalledWith(expect.stringContaining('boom'))
  })
})
