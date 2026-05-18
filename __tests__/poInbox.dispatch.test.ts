import { describe, it, expect } from 'vitest'

import {
  constantTimeEquals,
  isServiceRoleBearer,
} from '../supabase/functions/_shared/poInbox/dispatch'

describe('constantTimeEquals (dispatch.ts re-export)', () => {
  it('returns true for identical strings', () => {
    expect(constantTimeEquals('abc', 'abc')).toBe(true)
  })

  it('returns false for non-identical strings of equal length', () => {
    expect(constantTimeEquals('abc', 'abd')).toBe(false)
  })

  it('returns false for different lengths', () => {
    expect(constantTimeEquals('abc', 'abcd')).toBe(false)
    expect(constantTimeEquals('', 'x')).toBe(false)
  })

  it('handles long strings of equal length', () => {
    const a = 'x'.repeat(500)
    const b = 'x'.repeat(500)
    expect(constantTimeEquals(a, b)).toBe(true)
    const c = 'x'.repeat(499) + 'y'
    expect(constantTimeEquals(a, c)).toBe(false)
  })
})

describe('isServiceRoleBearer', () => {
  it('returns false for missing header', () => {
    expect(isServiceRoleBearer(null, 'sek')).toBe(false)
  })

  it('returns false for non-Bearer schemes', () => {
    expect(isServiceRoleBearer('Basic c2VrOg==', 'sek')).toBe(false)
  })

  it('returns false for mismatched bearer token', () => {
    expect(isServiceRoleBearer('Bearer wrong', 'sek')).toBe(false)
  })

  it('returns true for matching bearer token', () => {
    expect(isServiceRoleBearer('Bearer sek', 'sek')).toBe(true)
  })

  it('is case-insensitive on the Bearer scheme word', () => {
    expect(isServiceRoleBearer('bearer sek', 'sek')).toBe(true)
  })

  it('tolerates whitespace around the token', () => {
    expect(isServiceRoleBearer('Bearer  sek  ', 'sek')).toBe(true)
  })
})
