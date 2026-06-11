import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock the supabase client singleton before importing the service.
// `vi.hoisted` so the mock factory (hoisted to the top) can reference `invoke`.
const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }))
vi.mock('@/lib/supabase', () => ({
  supabase: { functions: { invoke } },
}))

import { placeOrder } from '../services/supabase/orderService'

function httpError(status: number, body: unknown): Error {
  // Mirror supabase-js FunctionsHttpError: a generic message plus the raw
  // Response (carrying the structured body) on `.context`.
  const err = new Error('Edge Function returned a non-2xx status code')
  ;(err as Error & { context: Response }).context = new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
  return err
}

const input = { hoReCaId: 1, items: [{ productId: 3, quantity: 25 }] }

describe('placeOrder error mapping', () => {
  beforeEach(() => invoke.mockReset())

  it('surfaces the structured INSUFFICIENT_STOCK message, not the generic one', async () => {
    invoke.mockResolvedValue({
      data: null,
      error: httpError(409, {
        error: { code: 'INSUFFICIENT_STOCK', message: '19 of "Coconut Milk 400ml" available, 25 requested' },
      }),
    })
    await expect(placeOrder(input)).rejects.toThrow('19 of "Coconut Milk 400ml" available, 25 requested')
  })

  it('does not leak the generic "non-2xx status code" message', async () => {
    invoke.mockResolvedValue({
      data: null,
      error: httpError(422, { error: { code: 'CREDIT_EXCEEDED', message: 'Credit limit $500 would be exceeded' } }),
    })
    await expect(placeOrder(input)).rejects.toThrow('Credit limit $500 would be exceeded')
  })

  it('returns the result payload on success', async () => {
    const result = { orderId: 'ORD-1', total: 50, cartDiscount: 0, appliedPromotionIds: [], bogoFreeItems: [] }
    invoke.mockResolvedValue({ data: result, error: null })
    await expect(placeOrder(input)).resolves.toEqual(result)
  })
})
