import { describe, expect, it } from 'vitest'

import {
  MAX_CLIENT_IP_LENGTH,
  UNKNOWN_CLIENT_IP,
  clientIp,
} from '@/supabase/functions/_shared/clientIp'

const req = (headers: Record<string, string>) => ({ headers: new Headers(headers) })

/**
 * The limiter's per-IP bucket is only as good as this key. The old rule took the
 * LEFT-most `x-forwarded-for` entry, which is the part of that header a client
 * writes, so rotating it minted a fresh bucket per request.
 */
describe('clientIp -- which header wins', () => {
  it('prefers cf-connecting-ip over everything', () => {
    expect(
      clientIp(req({ 'cf-connecting-ip': '203.0.113.7', 'x-real-ip': '198.51.100.1', 'x-forwarded-for': '10.0.0.1' })),
    ).toBe('203.0.113.7')
  })

  it('then x-real-ip', () => {
    expect(clientIp(req({ 'x-real-ip': '198.51.100.1', 'x-forwarded-for': '10.0.0.1' }))).toBe('198.51.100.1')
  })

  it('then the RIGHT-most x-forwarded-for entry, which the platform appended', () => {
    expect(clientIp(req({ 'x-forwarded-for': '6.6.6.6, 7.7.7.7, 203.0.113.9' }))).toBe('203.0.113.9')
  })

  it('is "unknown" when no proxy header says anything', () => {
    expect(clientIp(req({}))).toBe(UNKNOWN_CLIENT_IP)
  })
})

describe('clientIp -- a spoofed X-Forwarded-For cannot move the bucket', () => {
  it('ignores whatever the client prepends', () => {
    const honest = clientIp(req({ 'x-forwarded-for': '203.0.113.9' }))
    for (const forged of ['1.1.1.1', '2.2.2.2, 3.3.3.3', 'garbage', '']) {
      const header = forged ? `${forged}, 203.0.113.9` : '203.0.113.9'
      expect(clientIp(req({ 'x-forwarded-for': header }))).toBe(honest)
    }
  })

  it('cannot be overridden by a forged x-forwarded-for when a platform header is set', () => {
    expect(clientIp(req({ 'cf-connecting-ip': '203.0.113.7', 'x-forwarded-for': '9.9.9.9' }))).toBe('203.0.113.7')
  })
})

describe('clientIp -- hygiene', () => {
  it('trims whitespace and skips empty list entries', () => {
    expect(clientIp(req({ 'x-forwarded-for': ' 1.1.1.1 ,  , 203.0.113.9 ,  ' }))).toBe('203.0.113.9')
    expect(clientIp(req({ 'cf-connecting-ip': '   ' , 'x-real-ip': ' 198.51.100.1 ' }))).toBe('198.51.100.1')
  })

  it('treats a header of only separators as absent', () => {
    expect(clientIp(req({ 'x-forwarded-for': ', ,' }))).toBe(UNKNOWN_CLIENT_IP)
  })

  it('caps the key length, whichever header it came from', () => {
    const long = 'a'.repeat(500)
    for (const name of ['cf-connecting-ip', 'x-real-ip', 'x-forwarded-for']) {
      expect(clientIp(req({ [name]: long })).length).toBe(MAX_CLIENT_IP_LENGTH)
    }
  })

  it('keeps an IPv6 literal whole', () => {
    expect(clientIp(req({ 'cf-connecting-ip': '2001:db8:85a3::8a2e:370:7334' }))).toBe('2001:db8:85a3::8a2e:370:7334')
  })
})
