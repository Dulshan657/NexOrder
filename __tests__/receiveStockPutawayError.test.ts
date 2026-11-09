import { beforeEach, describe, expect, it, vi } from 'vitest'

// NX-0032: receive-stock answers 201 with `putaway_error` and `putaway_lines`
// when a product's home bin could not be read. The service must pass both on to
// the receive screen, and must not invent them when putaway worked.

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }))
vi.mock('@/lib/supabase', () => ({ supabase: { functions: { invoke } } }))

import { receiveStock } from '@/services/supabase/receivingService'

const RECEIPT = { lines_received: 1, receipt_id: 501, location_id: 9 }
const LINES = [{ product_id: 1, quantity: 48, hu_type: 'pallet' as const, hu_id: 900, quarantine: false }]
const HEADER = { supplier_id: 4 }

describe('receiveStock', () => {
  beforeEach(() => invoke.mockReset())

  it('returns the putaway error and the lines to retry', async () => {
    invoke.mockResolvedValue({
      data: {
        ok: true,
        result: RECEIPT,
        putaway: null,
        putaway_error: 'Home bin unavailable, try again.',
        putaway_lines: LINES,
      },
      error: null,
    })
    const res = await receiveStock(HEADER, [{ product_id: 1, quantity: 2 }])
    expect(res).toMatchObject({
      receipt_id: 501,
      location_id: 9,
      putaway: null,
      putaway_error: 'Home bin unavailable, try again.',
      putaway_lines: LINES,
    })
  })

  it('has neither when putaway worked', async () => {
    invoke.mockResolvedValue({
      data: { ok: true, result: RECEIPT, putaway: { mode: 'engine', layoutId: 3, recommendations: [] } },
      error: null,
    })
    const res = await receiveStock(HEADER, [{ product_id: 1, quantity: 2 }])
    expect(res.putaway_error).toBeUndefined()
    expect(res.putaway_lines).toBeUndefined()
  })
})
