import { beforeEach, describe, expect, it, vi } from 'vitest'

// NX-0018: what a customer save says when it fails. `supabase.functions.invoke`
// turns any non-2xx answer into an error whose own message is the useless
// "Edge Function returned a non-2xx status code"; the reason is in the response
// body. The service must pass the reason on, and the app shell must turn a thrown
// error into a value the dialog can act on.

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }))
vi.mock('@/lib/supabase', () => ({ supabase: { functions: { invoke } } }))

import { createHoReCa, updateHoReCa } from '../services/supabase/horecaService'

function httpError(status: number, body: unknown): Error {
  const err = new Error('Edge Function returned a non-2xx status code')
  ;(err as Error & { context: Response }).context = new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
  return err
}

beforeEach(() => {
  invoke.mockReset()
})

describe('customer save errors', () => {
  it("carries the server's reason for a refused save, not the generic status text", async () => {
    // What mutate-horeca sends for a body zod refused: the field errors are in details.
    invoke.mockResolvedValue({
      data: null,
      error: httpError(400, {
        error: {
          code: 'INVALID_INPUT',
          message: 'Invalid request body',
          details: { formErrors: [], fieldErrors: { data: ['Invalid email'] } },
        },
      }),
    })
    await expect(updateHoReCa(7, { billing_email: 'a@b' })).rejects.toThrow(/Invalid email/)
    await expect(createHoReCa({ name: 'X', address: 'Y', billing_email: 'a@b' })).rejects.toThrow(/Invalid email/)

    // A refusal that already says everything is passed on as it is.
    invoke.mockResolvedValue({
      data: null,
      error: httpError(400, {
        error: { code: 'INVALID_INPUT', message: 'A reason is required when modifying sensitive fields as Manager' },
      }),
    })
    await expect(updateHoReCa(7, { tier: 'Gold' })).rejects.toThrow(
      'A reason is required when modifying sensitive fields as Manager',
    )
  })

  it('never shows the generic non-2xx text, whatever the failure looks like', async () => {
    // A response that is not our envelope (a gateway page), and no response at all.
    invoke.mockResolvedValueOnce({ data: null, error: httpError(502, 'Bad gateway') })
    const gateway = await updateHoReCa(7, { phone: '1' }).catch((e: Error) => e)
    expect(gateway).toBeInstanceOf(Error)
    expect((gateway as Error).message).not.toMatch(/non-2xx/)
    expect((gateway as Error).message).toMatch(/502|try again/i)

    invoke.mockResolvedValueOnce({ data: null, error: new Error('Failed to send a request to the Edge Function') })
    await expect(updateHoReCa(7, { phone: '1' })).rejects.toThrow('Failed to send a request to the Edge Function')
  })

  it('reports a failed save as a value and a good one as ok, and never rejects', async () => {
    const { settleHoReCaSave } = await import('../lib/horecaSave')
    await expect(settleHoReCaSave(async () => 'saved')).resolves.toEqual({ ok: true })
    await expect(settleHoReCaSave(async () => { throw new Error('Invalid email') })).resolves.toEqual({
      ok: false,
      message: 'Invalid email',
    })
    // Something that is not an Error still gives the person a sentence.
    const result = await settleHoReCaSave(async () => { throw 'boom' })
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.message.length).toBeGreaterThan(0)
  })
})
