import { beforeEach, describe, expect, it, vi } from 'vitest'

// NX-0032: recommendPutaway is what the receive screen's Retry calls. Like
// decidePutaway, it must throw the server's own words: supabase-js reports any
// non-2xx as a generic "non-2xx status code" and leaves the real body unread on
// `.context`, so without this the dock would read nothing about WHY a retry
// failed ("Home bin unavailable, try again." is the one that matters).

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }))
vi.mock('@/lib/supabase', () => ({ supabase: { functions: { invoke } } }))

import { recommendPutaway } from '@/services/supabase/putawayService'

const HOME_UNAVAILABLE = 'Home bin unavailable, try again.'

function httpError(message: string, status = 500, code = 'INTERNAL') {
  return Object.assign(new Error('Edge Function returned a non-2xx status code'), {
    context: new Response(JSON.stringify({ error: { code, message } }), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  })
}

describe('recommendPutaway', () => {
  beforeEach(() => invoke.mockReset())

  it('throws the home message, not the generic non-2xx text', async () => {
    invoke.mockResolvedValue({ data: null, error: httpError(HOME_UNAVAILABLE) })
    await expect(recommendPutaway(9, [{ product_id: 1, quantity: 4 }], 501)).rejects.toThrow(HOME_UNAVAILABLE)
  })

  it('throws the message of a refused plate the same way', async () => {
    const message = 'Plate 777 is not on receipt 501'
    invoke.mockResolvedValue({ data: null, error: httpError(message, 400, 'INVALID_INPUT') })
    await expect(
      recommendPutaway(9, [{ product_id: 1, quantity: 4, hu_id: 777 }], 501),
    ).rejects.toThrow(message)
  })

  it('keeps a readable message when the response carried no body', async () => {
    const empty = Object.assign(new Error('Edge Function returned a non-2xx status code'), {
      context: new Response('', { status: 502 }),
    })
    invoke.mockResolvedValue({ data: null, error: empty })
    await expect(recommendPutaway(9, [{ product_id: 1, quantity: 4 }])).rejects.toThrow(
      'Could not get putaway recommendations',
    )
  })

  it('still reports a network failure by its own message', async () => {
    invoke.mockResolvedValue({ data: null, error: new Error('Failed to fetch') })
    await expect(recommendPutaway(9, [{ product_id: 1, quantity: 4 }])).rejects.toThrow('Failed to fetch')
  })

  it('sends each line with its plate, plate type and hold flag', async () => {
    invoke.mockResolvedValue({ data: { ok: true, mode: 'engine', layout_id: 3, recommendations: [] }, error: null })
    const lines = [
      { product_id: 1, quantity: 48, hu_type: 'pallet' as const, hu_id: 900, quarantine: false },
      { product_id: 2, quantity: 6, hu_type: 'carton' as const, hu_id: 901, quarantine: true },
    ]
    const res = await recommendPutaway(9, lines, 501)
    expect(res).toEqual({ mode: 'engine', layoutId: 3, recommendations: [] })
    expect(invoke).toHaveBeenCalledWith('recommend-putaway', {
      body: expect.objectContaining({ warehouse_id: 9, goods_receipt_id: 501, lines }),
    })
  })
})
