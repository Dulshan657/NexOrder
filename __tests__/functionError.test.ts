import { describe, it, expect } from 'vitest'

import { extractFunctionErrorMessage } from '../lib/functionError'

function httpError(status: number, body: unknown, contentType = 'application/json'): Error {
  // Mirror supabase-js FunctionsHttpError: a generic message plus the raw
  // Response on `.context`. The structured body lives only on the Response.
  const err = new Error('Edge Function returned a non-2xx status code')
  ;(err as Error & { context: Response }).context = new Response(
    typeof body === 'string' ? body : JSON.stringify(body),
    { status, headers: { 'content-type': contentType } },
  )
  return err
}

describe('extractFunctionErrorMessage', () => {
  it('reads the structured { error: { message } } body off the Response context', async () => {
    const err = httpError(409, {
      error: { code: 'CONFLICT', message: 'Insufficient stock for Thai Green Curry Paste 195g: 0 available, 2 requested' },
    })
    expect(await extractFunctionErrorMessage(err, 'fallback')).toBe(
      'Insufficient stock for Thai Green Curry Paste 195g: 0 available, 2 requested',
    )
  })

  it('prefers the structured body message over the generic FunctionsHttpError message', async () => {
    const err = httpError(400, { error: { code: 'INVALID_INPUT', message: 'No horeca_id available' } })
    expect(await extractFunctionErrorMessage(err, 'fallback')).toBe('No horeca_id available')
  })

  it('falls back to error.message when there is no context Response', async () => {
    expect(await extractFunctionErrorMessage(new Error('network down'), 'fallback')).toBe('network down')
  })

  it('falls back to the provided fallback when the body has no usable message', async () => {
    const err = httpError(500, { something: 'else' })
    expect(await extractFunctionErrorMessage(err, 'approve-po failed')).toBe('approve-po failed')
  })

  it('falls back to the provided fallback when the body is not JSON', async () => {
    const err = httpError(502, '<html>bad gateway</html>', 'text/html')
    expect(await extractFunctionErrorMessage(err, 'approve-po failed')).toBe('approve-po failed')
  })

  it('ignores blank structured messages and falls back', async () => {
    const err = httpError(409, { error: { code: 'CONFLICT', message: '   ' } })
    expect(await extractFunctionErrorMessage(err, 'approve-po failed')).toBe('approve-po failed')
  })

  it('returns the fallback for non-error values', async () => {
    expect(await extractFunctionErrorMessage(null, 'fallback')).toBe('fallback')
    expect(await extractFunctionErrorMessage('oops', 'fallback')).toBe('fallback')
  })
})
