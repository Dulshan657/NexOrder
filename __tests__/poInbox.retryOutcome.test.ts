import { describe, it, expect } from 'vitest'

import { deriveRetryOutcome } from '../supabase/functions/_shared/poInbox/retryOutcome'

describe('deriveRetryOutcome', () => {
  it('maps a clean poll (active + ok) to "synced"', () => {
    expect(deriveRetryOutcome('active', 'ok')).toBe('synced')
  })

  it('maps a transient failure (still active + error) to "still_failing"', () => {
    // processAccount reports CycleResult.status 'error' for transient failures
    // too, but the mailbox stays 'active' and keeps auto-retrying.
    expect(deriveRetryOutcome('active', 'error')).toBe('still_failing')
  })

  it('maps a grant revocation (flipped to error) to "needs_reconnect"', () => {
    expect(deriveRetryOutcome('error', 'error')).toBe('needs_reconnect')
  })

  it('prioritises the revoked status even if the cycle somehow reported ok', () => {
    // Defensive: the DB status is authoritative over the cycle status.
    expect(deriveRetryOutcome('error', 'ok')).toBe('needs_reconnect')
  })
})
