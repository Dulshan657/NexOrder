import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PickCallError, refusalMessage, toPickCallError } from '../lib/pickRefusal'

const invoke = vi.hoisted(() => vi.fn())
vi.mock('@/lib/supabase', () => ({ supabase: { functions: { invoke } } }))

const { getOrderPickTasks, recordPick, recordShortPick } = await import('../services/supabase/pickService')

/** What supabase-js hands back for a non-2xx: a generic message and the raw Response on `.context`. */
function httpError(status: number, body: unknown): Error {
  const err = new Error('Edge Function returned a non-2xx status code')
  ;(err as Error & { context: Response }).context = new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
  return err
}

const refusal = (code: string, message: string, reason?: string) =>
  httpError(409, { error: { code, message, ...(reason ? { details: { reason } } : {}) } })

describe('refusalMessage', () => {
  const words = (reason: string) => refusalMessage(new PickCallError('server', { reason, code: 'CONFLICT', status: 409 }), 'fallback')

  it('says what to do about each refusal a picker can meet', () => {
    expect(words('HELD_AT_OTHER_WAREHOUSE')).toMatch(/another warehouse still holds stock/i)
    expect(words('BAD_LOCATION')).toMatch(/not in a warehouse that is picking this order/i)
    expect(words('LINE_CLOSED_SHORT')).toMatch(/already finished short.*put anything you took back/i)
    expect(words('ORDER_CANCELLED')).toMatch(/cancelled.*put anything already taken back/i)
    expect(words('NOT_YOUR_WAREHOUSE')).toMatch(/your own warehouse/i)
  })

  it('prefers its own wording to the server\'s for a reason it knows', () => {
    expect(words('ORDER_CANCELLED')).not.toBe('server')
  })

  it('uses the server\'s words for a refusal it has no wording for', () => {
    const err = new PickCallError('Rate limit exceeded', { reason: null, code: 'TOO_MANY_REQUESTS', status: 429 })
    expect(refusalMessage(err, 'fallback')).toBe('Rate limit exceeded')
  })

  it('uses the caller\'s fallback for an error that says nothing', () => {
    expect(refusalMessage(new Error('   '), 'Could not record the pick.')).toBe('Could not record the pick.')
    expect(refusalMessage(undefined, 'Could not record the pick.')).toBe('Could not record the pick.')
    expect(refusalMessage('boom', 'Could not record the pick.')).toBe('Could not record the pick.')
  })

  it('reads a plain Error\'s own message', () => {
    expect(refusalMessage(new Error('Network request failed'), 'fallback')).toBe('Network request failed')
  })
})

describe('toPickCallError', () => {
  it('reads the reason, code, status and message off the response body', async () => {
    const err = await toPickCallError(refusal('CONFLICT', 'Another warehouse still holds stock.', 'HELD_AT_OTHER_WAREHOUSE'), 'fallback')
    expect(err).toBeInstanceOf(PickCallError)
    expect(err).toMatchObject({ reason: 'HELD_AT_OTHER_WAREHOUSE', code: 'CONFLICT', status: 409, message: 'Another warehouse still holds stock.' })
  })

  it('has no reason when the body carries none', async () => {
    const err = await toPickCallError(refusal('CONFLICT', 'pick failed: OVER_PICK'), 'fallback')
    expect(err.reason).toBeNull()
    expect(err.message).toBe('pick failed: OVER_PICK')
  })

  it('falls back when the failure had no response at all', async () => {
    const err = await toPickCallError(new Error('Failed to fetch'), 'Could not record the pick.')
    expect(err).toMatchObject({ reason: null, code: null, status: null })
    expect(err.message).toBe('Failed to fetch')
  })

  it('falls back to the caller\'s words when nothing readable came back', async () => {
    const bad = httpError(502, 'x')
    ;(bad as Error & { context: Response }).context = new Response('<html>bad gateway</html>', { status: 502 })
    expect((await toPickCallError(bad, 'Could not record the pick.')).message).toBe('Could not record the pick.')
  })
})

describe('the pick calls', () => {
  beforeEach(() => invoke.mockReset())

  it('record-pick throws a PickCallError that names why, not the transport message', async () => {
    invoke.mockResolvedValue({ data: null, error: refusal('CONFLICT', 'This line was already finished short.', 'LINE_CLOSED_SHORT') })
    await expect(recordPick(7, 2, 501)).rejects.toMatchObject({ reason: 'LINE_CLOSED_SHORT', status: 409 })
  })

  it('record-short-pick posts the line, and the bin only when one is known', async () => {
    invoke.mockResolvedValue({ data: { ok: true, status: 'closed', line_closed: true }, error: null })

    await recordShortPick(7, 501)
    await recordShortPick(8)

    expect(invoke).toHaveBeenNthCalledWith(1, 'record-short-pick', { body: { orderItemId: 7, locationId: 501 } })
    expect(invoke).toHaveBeenNthCalledWith(2, 'record-short-pick', { body: { orderItemId: 8 } })
  })

  it('record-short-pick throws a PickCallError carrying the reason', async () => {
    invoke.mockResolvedValue({ data: null, error: refusal('CONFLICT', 'Another warehouse still holds stock.', 'HELD_AT_OTHER_WAREHOUSE') })
    await expect(recordShortPick(7)).rejects.toMatchObject({ reason: 'HELD_AT_OTHER_WAREHOUSE' })
  })

  it('order-pick-tasks answers with everything the screen needs, whatever the function version', async () => {
    invoke.mockResolvedValue({
      data: { ok: true, tasks: [{ orderItemId: 1 }], imported: true, closedShortLineIds: [3], foundByLine: { '1': 2, '3': 0 } },
      error: null,
    })
    expect(await getOrderPickTasks('ORD-TEST-1')).toEqual({
      tasks: [{ orderItemId: 1 }],
      imported: true,
      closedShortLineIds: [3],
      foundByLine: { 1: 2, 3: 0 },
    })

    // A function deployed before this change says only `tasks`: not imported, nothing closed.
    invoke.mockResolvedValue({ data: { ok: true, tasks: [{ orderItemId: 1 }] }, error: null })
    expect(await getOrderPickTasks('ORD-TEST-1')).toEqual({
      tasks: [{ orderItemId: 1 }],
      imported: false,
      closedShortLineIds: [],
      foundByLine: {},
    })
  })

  it('order-pick-tasks only ever calls imported when the function says exactly true', async () => {
    invoke.mockResolvedValue({ data: { ok: true, tasks: [], imported: 'yes' }, error: null })
    expect((await getOrderPickTasks('ORD-TEST-1')).imported).toBe(false)
  })
})
