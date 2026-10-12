import { describe, expect, it } from 'vitest'

import {
  CREDIT_FAILURE_REDACTED,
  GENERIC_APPROVAL_FAILURE,
  QR_CLAIM_STALE_MS,
  QR_REQUEST_STATUSES,
  approvalFailureMessage,
  canClaim,
  canTransition,
  claimableFilter,
  conflictMessage,
  isClaimStale,
  isQrRequestStatus,
  isTerminal,
  staleClaimCutoff,
  storedFailureMessage,
  type QrRequestActor,
  type QrRequestStatus,
} from '../supabase/functions/_shared/qrRequestTransitions'

const NOW = Date.parse('2026-10-12T10:00:00.000Z')

describe('canTransition', () => {
  // The whole machine, written out. Anything not listed here must be refused.
  const ALLOWED: ReadonlyArray<[QrRequestStatus, QrRequestStatus, QrRequestActor]> = [
    ['pending', 'cancelled', 'requester'],
    ['pending', 'approving', 'approver'],
    ['pending', 'rejected', 'approver'],
    ['approving', 'approved', 'approver'],
    ['approving', 'pending', 'approver'],
  ]

  it('allows exactly the five edges of the lifecycle', () => {
    const found: string[] = []
    for (const from of QR_REQUEST_STATUSES) {
      for (const to of QR_REQUEST_STATUSES) {
        for (const actor of ['requester', 'approver'] as const) {
          if (canTransition(from, to, actor)) found.push(`${from}>${to}:${actor}`)
        }
      }
    }
    expect(found.sort()).toEqual(ALLOWED.map(([f, t, a]) => `${f}>${t}:${a}`).sort())
  })

  it('lets the requester cancel only while the order is still pending', () => {
    expect(canTransition('pending', 'cancelled', 'requester')).toBe(true)
    // Mid-approval an order may already exist: cancelling the request would not undo it.
    expect(canTransition('approving', 'cancelled', 'requester')).toBe(false)
    expect(canTransition('approved', 'cancelled', 'requester')).toBe(false)
  })

  it('never lets the requester approve, reject or claim', () => {
    for (const to of ['approving', 'approved', 'rejected', 'pending'] as const) {
      expect(canTransition('pending', to, 'requester')).toBe(false)
    }
  })

  it('never lets an approver cancel on the requester\'s behalf (they reject instead)', () => {
    expect(canTransition('pending', 'cancelled', 'approver')).toBe(false)
  })

  it('refuses to reject an order that is mid-approval', () => {
    expect(canTransition('approving', 'rejected', 'approver')).toBe(false)
  })

  it.each(['approved', 'rejected', 'cancelled'] as const)('%s is terminal: nothing leaves it', (from) => {
    expect(isTerminal(from)).toBe(true)
    for (const to of QR_REQUEST_STATUSES) {
      expect(canTransition(from, to, 'approver')).toBe(false)
      expect(canTransition(from, to, 'requester')).toBe(false)
    }
  })

  it('refuses self-transitions (a re-claim is canClaim, not an edge)', () => {
    for (const s of QR_REQUEST_STATUSES) {
      expect(canTransition(s, s, 'approver')).toBe(false)
      expect(canTransition(s, s, 'requester')).toBe(false)
    }
  })

  it('refuses a status it does not know, on either side', () => {
    expect(canTransition('pending', 'shipped', 'approver')).toBe(false)
    expect(canTransition('draft', 'pending', 'approver')).toBe(false)
    expect(canTransition('', '', 'approver')).toBe(false)
  })
})

describe('isTerminal / isQrRequestStatus', () => {
  it('treats pending and approving as live', () => {
    expect(isTerminal('pending')).toBe(false)
    expect(isTerminal('approving')).toBe(false)
  })

  it('recognises exactly the five statuses', () => {
    for (const s of QR_REQUEST_STATUSES) expect(isQrRequestStatus(s)).toBe(true)
    expect(isQrRequestStatus('Pending')).toBe(false)
    expect(isQrRequestStatus(null)).toBe(false)
    expect(isQrRequestStatus(undefined)).toBe(false)
    expect(isQrRequestStatus(3)).toBe(false)
  })
})

describe('claim staleness', () => {
  it('is two minutes', () => {
    expect(QR_CLAIM_STALE_MS).toBe(120_000)
  })

  it('honours a claim up to and including the limit', () => {
    expect(isClaimStale(new Date(NOW - 1_000).toISOString(), NOW)).toBe(false)
    expect(isClaimStale(new Date(NOW - QR_CLAIM_STALE_MS).toISOString(), NOW)).toBe(false)
  })

  it('treats a claim older than the limit as abandoned', () => {
    expect(isClaimStale(new Date(NOW - QR_CLAIM_STALE_MS - 1).toISOString(), NOW)).toBe(true)
    expect(isClaimStale(new Date(NOW - 10 * 60_000).toISOString(), NOW)).toBe(true)
  })

  it('accepts a Date or a number as well as an ISO string', () => {
    expect(isClaimStale(new Date(NOW - 5_000), NOW)).toBe(false)
    expect(isClaimStale(NOW - 5_000, NOW)).toBe(false)
    expect(isClaimStale(NOW - 999_999, NOW)).toBe(true)
  })

  it('treats a missing or unreadable timestamp as abandoned rather than stranding the request', () => {
    expect(isClaimStale(null, NOW)).toBe(true)
    expect(isClaimStale(undefined, NOW)).toBe(true)
    expect(isClaimStale('not a date', NOW)).toBe(true)
  })

  it('is not stale when the clock is behind the claim (skew)', () => {
    expect(isClaimStale(new Date(NOW + 30_000).toISOString(), NOW)).toBe(false)
  })
})

describe('canClaim', () => {
  const fresh = new Date(NOW - 10_000).toISOString()
  const old = new Date(NOW - 5 * 60_000).toISOString()

  it('claims a pending request', () => {
    expect(canClaim('pending', null, NOW)).toBe(true)
  })

  it('does not steal a live claim', () => {
    expect(canClaim('approving', fresh, NOW)).toBe(false)
  })

  it('takes over an abandoned claim', () => {
    expect(canClaim('approving', old, NOW)).toBe(true)
    expect(canClaim('approving', null, NOW)).toBe(true)
  })

  it.each(['approved', 'rejected', 'cancelled', 'bogus'])('never claims %s', (status) => {
    expect(canClaim(status, old, NOW)).toBe(false)
    expect(canClaim(status, null, NOW)).toBe(false)
  })
})

describe('staleClaimCutoff / claimableFilter', () => {
  it('puts the cutoff exactly QR_CLAIM_STALE_MS in the past, as ISO', () => {
    expect(staleClaimCutoff(NOW)).toBe('2026-10-12T09:58:00.000Z')
  })

  it('builds the PostgREST or-filter for pending OR an abandoned claim', () => {
    expect(claimableFilter(NOW)).toBe(
      'status.eq.pending,' +
        'and(status.eq.approving,claimed_at.lt.2026-10-12T09:58:00.000Z),' +
        'and(status.eq.approving,claimed_at.is.null)',
    )
  })

  it('selects the same rows canClaim accepts (the two cannot drift)', () => {
    // Evaluate the filter's three arms by hand against a grid of rows.
    const cutoff = Date.parse(staleClaimCutoff(NOW))
    const matches = (status: string, claimedAt: number | null): boolean =>
      status === 'pending' ||
      (status === 'approving' && claimedAt !== null && claimedAt < cutoff) ||
      (status === 'approving' && claimedAt === null)

    for (const status of [...QR_REQUEST_STATUSES, 'bogus']) {
      for (const age of [null, 0, 1_000, QR_CLAIM_STALE_MS - 1, QR_CLAIM_STALE_MS + 1, 3_600_000]) {
        const claimedAt = age === null ? null : NOW - age
        const iso = claimedAt === null ? null : new Date(claimedAt).toISOString()
        // The boundary (age === limit) is the one place `<` and `>` could disagree.
        if (age === QR_CLAIM_STALE_MS) continue
        expect(matches(status, claimedAt), `${status} age=${age}`).toBe(canClaim(status, iso, NOW))
      }
    }
  })
})

describe('conflictMessage', () => {
  it('says why a cancel was refused', () => {
    expect(conflictMessage('approved', 'cancel')).toMatch(/already approved/i)
    expect(conflictMessage('approving', 'cancel')).toMatch(/being approved/i)
    expect(conflictMessage('cancelled', 'cancel')).toMatch(/already cancelled/i)
    expect(conflictMessage('rejected', 'cancel')).toMatch(/declined/i)
  })

  it('says why an approve or reject was refused', () => {
    expect(conflictMessage('approved', 'approve')).toMatch(/already been approved/i)
    expect(conflictMessage('approving', 'reject')).toMatch(/approving this order right now/i)
    expect(conflictMessage('cancelled', 'approve')).toMatch(/cancelled by the person/i)
    expect(conflictMessage('rejected', 'approve')).toMatch(/declined/i)
  })

  it('does not blame anyone when the status is unchanged or the row is gone', () => {
    expect(conflictMessage('pending', 'approve')).toMatch(/changed/i)
    expect(conflictMessage(null, 'approve')).toMatch(/no longer exists/i)
  })
})

describe('approvalFailureMessage', () => {
  it('passes business-rule sentences through for the approver to act on', () => {
    expect(approvalFailureMessage('INSUFFICIENT_STOCK', '3 of "Cream" available, 5 requested')).toBe(
      '3 of "Cream" available, 5 requested',
    )
    expect(approvalFailureMessage('CREDIT_EXCEEDED', 'Credit limit $500 would be exceeded')).toMatch(/Credit limit/)
    expect(approvalFailureMessage('BELOW_MINIMUM', 'Order total $10 is below minimum $50')).toMatch(/minimum/)
  })

  it('replaces anything that may carry a database or driver message', () => {
    expect(approvalFailureMessage('DB_ORDER_INSERT_FAILED', 'duplicate key value violates unique constraint "orders_pkey"')).toBe(
      GENERIC_APPROVAL_FAILURE,
    )
    expect(approvalFailureMessage('STOCK_RACE', 'function inv_reserve_order(uuid) does not exist')).toBe(
      GENERIC_APPROVAL_FAILURE,
    )
    expect(approvalFailureMessage('INTERNAL', 'connect ECONNREFUSED 10.0.0.1:5432')).toBe(GENERIC_APPROVAL_FAILURE)
  })

  it('falls back to the generic text when there is no code or no message', () => {
    expect(approvalFailureMessage(null, 'boom')).toBe(GENERIC_APPROVAL_FAILURE)
    expect(approvalFailureMessage('INSUFFICIENT_STOCK', '')).toBe(GENERIC_APPROVAL_FAILURE)
    expect(approvalFailureMessage('INSUFFICIENT_STOCK', undefined)).toBe(GENERIC_APPROVAL_FAILURE)
  })
})

describe('storedFailureMessage (the copy the kitchen can read)', () => {
  const credit = 'Credit limit $500 would be exceeded ($480 outstanding + $60 new)'

  it('never stores the venue\'s credit figures', () => {
    const stored = storedFailureMessage('CREDIT_EXCEEDED', credit)
    expect(stored).toBe(CREDIT_FAILURE_REDACTED)
    expect(stored).not.toMatch(/\$|\d/)
  })

  it('leaves the approver\'s own message untouched', () => {
    // approvalFailureMessage is what the approver is shown: it keeps the figures.
    expect(approvalFailureMessage('CREDIT_EXCEEDED', credit)).toBe(credit)
  })

  it('stores the other business-rule sentences, which carry no invoice data', () => {
    expect(storedFailureMessage('INSUFFICIENT_STOCK', '3 of "Cream" available, 5 requested')).toBe(
      '3 of "Cream" available, 5 requested',
    )
    expect(storedFailureMessage('BELOW_MINIMUM', 'Order total $10 is below minimum $50')).toMatch(/minimum/)
  })

  it('still replaces anything that may carry a database message', () => {
    expect(storedFailureMessage('DB_ITEMS_INSERT_FAILED', 'violates foreign key constraint')).toBe(
      GENERIC_APPROVAL_FAILURE,
    )
    expect(storedFailureMessage(null, 'boom')).toBe(GENERIC_APPROVAL_FAILURE)
  })
})
