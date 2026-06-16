import { describe, it, expect } from 'vitest'

import { isGmailScopeError } from '../supabase/functions/_shared/poInbox/gmail'

describe('isGmailScopeError', () => {
  it('flags a 403 "insufficient authentication scopes" as needing reconnect', () => {
    const body = JSON.stringify({
      error: {
        code: 403,
        message: 'Request had insufficient authentication scopes.',
        errors: [{ message: 'Insufficient Permission', domain: 'global' }],
      },
    })
    expect(isGmailScopeError(403, body)).toBe(true)
  })

  it('flags the "Insufficient Permission" wording too', () => {
    expect(isGmailScopeError(403, '{"error":{"message":"Insufficient Permission"}}')).toBe(true)
  })

  it('does NOT flag a 403 rate-limit (transient, no "insufficient")', () => {
    expect(isGmailScopeError(403, '{"error":{"message":"User Rate Limit Exceeded"}}')).toBe(false)
  })

  it('does NOT flag non-403 statuses', () => {
    expect(isGmailScopeError(500, 'insufficient something')).toBe(false)
    expect(isGmailScopeError(429, 'rate limited')).toBe(false)
  })
})
