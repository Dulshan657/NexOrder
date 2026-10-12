import { describe, it, expect } from 'vitest'
import { GENERIC_MESSAGE, NETWORK_MESSAGE, QrApiError, isQrApiError, toQrApiError } from '@/lib/qr/qrApiError'
import { extractFunctionErrorEnvelope } from '@/lib/functionError'

// Mirror supabase-js FunctionsHttpError: a generic message plus the raw Response
// (carrying the structured body) on `.context`.
function httpError(status: number, body: unknown, contentType = 'application/json'): Error {
  const err = new Error('Edge Function returned a non-2xx status code')
  ;(err as Error & { context: Response }).context = new Response(
    typeof body === 'string' ? body : JSON.stringify(body),
    { status, headers: { 'content-type': contentType } },
  )
  return err
}

describe('extractFunctionErrorEnvelope', () => {
  it('reads status, code, message and details', async () => {
    const env = await extractFunctionErrorEnvelope(
      httpError(423, { error: { code: 'QR_LOCKED', message: 'Too many incorrect PINs.', details: { permanent: false } } }),
    )
    expect(env).toEqual({
      status: 423,
      code: 'QR_LOCKED',
      message: 'Too many incorrect PINs.',
      details: { permanent: false },
    })
  })

  it('returns null when the failure had no HTTP response at all', async () => {
    expect(await extractFunctionErrorEnvelope(new Error('Failed to fetch'))).toBeNull()
    expect(await extractFunctionErrorEnvelope(null)).toBeNull()
    expect(await extractFunctionErrorEnvelope(undefined)).toBeNull()
  })

  it('gives the status with null code/message when the body is not our envelope', async () => {
    expect(await extractFunctionErrorEnvelope(httpError(502, '<html>Bad gateway</html>', 'text/html'))).toEqual({
      status: 502,
      code: null,
      message: null,
      details: undefined,
    })
    expect(await extractFunctionErrorEnvelope(httpError(500, { something: 'else' }))).toMatchObject({
      status: 500,
      code: null,
      message: null,
    })
  })

  it('treats a blank message as absent', async () => {
    const env = await extractFunctionErrorEnvelope(httpError(400, { error: { code: 'INVALID_INPUT', message: '   ' } }))
    expect(env?.message).toBeNull()
    expect(env?.code).toBe('INVALID_INPUT')
  })

  it('does not consume the response body', async () => {
    const err = httpError(400, { error: { code: 'INVALID_INPUT', message: 'm' } })
    await extractFunctionErrorEnvelope(err)
    const again = await (err as Error & { context: Response }).context.json()
    expect(again.error.code).toBe('INVALID_INPUT')
  })
})

describe('toQrApiError', () => {
  it('carries code, message, status and details off the envelope', async () => {
    const e = await toQrApiError(
      httpError(401, { error: { code: 'QR_BAD_PIN', message: 'Incorrect PIN' } }),
    )
    expect(e).toBeInstanceOf(QrApiError)
    expect(isQrApiError(e)).toBe(true)
    expect(e.name).toBe('QrApiError')
    expect(e.code).toBe('QR_BAD_PIN')
    expect(e.message).toBe('Incorrect PIN')
    expect(e.status).toBe(401)
    expect(e.locked).toBe(false)
  })

  it('never leaks the generic "non-2xx" message', async () => {
    const e = await toQrApiError(httpError(500, { nope: true }))
    expect(e.message).not.toMatch(/non-2xx/)
    expect(e.message).toBe(GENERIC_MESSAGE)
  })

  it('uses the caller fallback for a response with no message', async () => {
    const e = await toQrApiError(httpError(500, { nope: true }), 'Could not place the order')
    expect(e.message).toBe('Could not place the order')
  })

  it('derives a code from the status when the body is a gateway page', async () => {
    expect((await toQrApiError(httpError(401, '', 'text/plain'))).code).toBe('UNAUTHORIZED')
    expect((await toQrApiError(httpError(403, '', 'text/plain'))).code).toBe('FORBIDDEN')
    expect((await toQrApiError(httpError(404, '', 'text/plain'))).code).toBe('NOT_FOUND')
    expect((await toQrApiError(httpError(429, '', 'text/plain'))).code).toBe('TOO_MANY_REQUESTS')
    expect((await toQrApiError(httpError(502, '', 'text/plain'))).code).toBe('INTERNAL')
  })

  it('is NETWORK, with a human message and no status, when there was no response', async () => {
    const e = await toQrApiError(new Error('Failed to send a request to the Edge Function'))
    expect(e.code).toBe('NETWORK')
    expect(e.status).toBeNull()
    expect(e.message).toBe(NETWORK_MESSAGE)
  })

  it('passes an existing QrApiError straight through', async () => {
    const original = new QrApiError({ code: 'FORBIDDEN', message: 'no' })
    expect(await toQrApiError(original)).toBe(original)
  })
})

describe('QrApiError derived fields', () => {
  it('QR_LOCKED: locked, with the end time', () => {
    const e = new QrApiError({
      code: 'QR_LOCKED',
      message: 'Too many incorrect PINs. Try again later.',
      status: 423,
      details: { lockedUntil: '2026-10-12T10:15:00.000Z', permanent: false },
    })
    expect(e.locked).toBe(true)
    expect(e.lockedUntil).toBe('2026-10-12T10:15:00.000Z')
    expect(e.permanent).toBe(false)
  })

  it('QR_LOCKED permanent: no end time', () => {
    const e = new QrApiError({
      code: 'QR_LOCKED',
      message: 'This code is locked. Ask your manager to unlock it.',
      details: { lockedUntil: null, permanent: true },
    })
    expect(e.locked).toBe(true)
    expect(e.permanent).toBe(true)
    expect(e.lockedUntil).toBeNull()
  })

  it('QR_BAD_PIN: locked only when this attempt tripped the lock', () => {
    expect(new QrApiError({ code: 'QR_BAD_PIN', message: 'Incorrect PIN' }).locked).toBe(false)
    const tripped = new QrApiError({
      code: 'QR_BAD_PIN',
      message: 'Incorrect PIN',
      details: { locked: true, lockedUntil: '2026-10-12T10:01:00.000Z', permanent: false },
    })
    expect(tripped.locked).toBe(true)
    expect(tripped.lockedUntil).toBe('2026-10-12T10:01:00.000Z')
  })

  it('QR_REQUEST_CONFLICT: where the request stands now', () => {
    const e = new QrApiError({
      code: 'QR_REQUEST_CONFLICT',
      message: 'Already approved',
      details: { status: 'approved' },
    })
    expect(e.requestStatus).toBe('approved')
  })

  it('ignores a status it does not recognise', () => {
    expect(new QrApiError({ code: 'QR_REQUEST_CONFLICT', message: 'x', details: { status: 'weird' } }).requestStatus).toBeNull()
    expect(new QrApiError({ code: 'QR_REQUEST_CONFLICT', message: 'x', details: { status: null } }).requestStatus).toBeNull()
  })

  it('INTERNAL after a placed order exposes the order id', () => {
    const e = new QrApiError({ code: 'INTERNAL', message: 'Order ORD-9 was placed, but ...', details: { orderId: 'ORD-9' } })
    expect(e.orderId).toBe('ORD-9')
  })

  it('every derived field is neutral when details are missing or odd', () => {
    for (const details of [undefined, null, 'a string', 42, [], [1, 2]]) {
      const e = new QrApiError({ code: 'INTERNAL', message: 'x', details })
      expect(e.lockedUntil).toBeNull()
      expect(e.permanent).toBe(false)
      expect(e.locked).toBe(false)
      expect(e.requestStatus).toBeNull()
      expect(e.orderId).toBeNull()
    }
  })

  it('sessionEnded covers an expired unlock and a vanished session, and nothing else', () => {
    expect(new QrApiError({ code: 'QR_SESSION_EXPIRED', message: 'x' }).sessionEnded).toBe(true)
    expect(new QrApiError({ code: 'UNAUTHORIZED', message: 'x' }).sessionEnded).toBe(true)
    expect(new QrApiError({ code: 'FORBIDDEN', message: 'x' }).sessionEnded).toBe(false)
    expect(new QrApiError({ code: 'QR_BAD_PIN', message: 'x' }).sessionEnded).toBe(false)
  })

  it('issues normalises both server validation shapes', () => {
    const fromArray = new QrApiError({
      code: 'INVALID_INPUT',
      message: 'Invalid request body',
      details: [{ path: 'items.0.quantity', message: 'Number must be greater than 0' }],
    })
    expect(fromArray.issues).toEqual([{ path: 'items.0.quantity', message: 'Number must be greater than 0' }])

    const fromObject = new QrApiError({
      code: 'INVALID_INPUT',
      message: 'x',
      details: { issues: [{ path: 'name', message: 'Required' }] },
    })
    expect(fromObject.issues).toEqual([{ path: 'name', message: 'Required' }])

    // zod's flatten() shape carries no paths we can use: report none rather than guess.
    expect(
      new QrApiError({ code: 'INVALID_INPUT', message: 'x', details: { formErrors: [], fieldErrors: { name: ['Required'] } } })
        .issues,
    ).toEqual([])
    expect(new QrApiError({ code: 'INVALID_INPUT', message: 'x' }).issues).toEqual([])
  })

  it('is an Error with a stack, so it reports like one', () => {
    const e = new QrApiError({ code: 'NETWORK', message: 'm' })
    expect(e).toBeInstanceOf(Error)
    expect(typeof e.stack).toBe('string')
  })
})
