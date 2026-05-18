import { describe, it, expect, afterEach } from 'vitest'

import { readEnv, sanitizeForLog } from '../supabase/functions/_shared/poInbox/env'

const TEST_VAR = '__PO_INBOX_TEST_VAR__'

afterEach(() => {
  delete process.env[TEST_VAR]
})

describe('readEnv', () => {
  it('reads an env var via the Node fallback', () => {
    process.env[TEST_VAR] = 'hello'
    expect(readEnv(TEST_VAR)).toBe('hello')
  })

  it('returns undefined for unset', () => {
    delete process.env[TEST_VAR]
    expect(readEnv(TEST_VAR)).toBeUndefined()
  })

  it('returns undefined for empty string', () => {
    process.env[TEST_VAR] = ''
    expect(readEnv(TEST_VAR)).toBeUndefined()
  })
})

describe('sanitizeForLog', () => {
  it('redacts Google refresh tokens', () => {
    const out = sanitizeForLog('error: invalid 1//abc123xyz456PQRSTUV here')
    expect(out).not.toContain('1//abc')
    expect(out).toContain('[REDACTED]')
  })

  it('redacts Google access tokens (ya29.)', () => {
    const out = sanitizeForLog('msg: ya29.AB-cdef_ghij1234567890XYZ')
    expect(out).not.toContain('ya29.AB')
    expect(out).toContain('[REDACTED]')
  })

  it('redacts JWTs (Microsoft / Supabase service-role tokens)', () => {
    const jwt = 'eyJhbGc.eyJzdWIxMjM0NTY3.SflKxwRJSMeKKF2QT4f-' // synthetic
    const out = sanitizeForLog(`bad: ${jwt} here`)
    expect(out).not.toContain('eyJh')
    expect(out).toContain('[REDACTED]')
  })

  it('redacts Microsoft refresh tokens (M.A. shape)', () => {
    const out = sanitizeForLog('msg: M.C.refresh_aaaaaaaaaaaaaaaa')
    expect(out).not.toContain('M.C.refresh')
    expect(out).toContain('[REDACTED]')
  })

  it('truncates to the requested max length', () => {
    const long = 'x'.repeat(500)
    expect(sanitizeForLog(long, 100).length).toBeLessThanOrEqual(101)  // +1 for ellipsis
  })

  it('passes short, token-free strings through unchanged', () => {
    expect(sanitizeForLog('plain old error message')).toBe('plain old error message')
  })

  it('returns empty for empty input', () => {
    expect(sanitizeForLog('')).toBe('')
  })
})
