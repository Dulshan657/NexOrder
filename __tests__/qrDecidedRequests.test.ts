import { describe, expect, it } from 'vitest'
import {
  NOT_APPROVED_CARD_MAX_AGE_MS,
  decidedForHistory,
  isOwnRequest,
  notApprovedForHome,
} from '@/lib/qr/decidedRequests'
import { DAY_MS, HOUR_MS, ago, mkQrRequest } from './support/qrRequestFixture'

// Two questions with two different answers:
//   - the Order home card: MY rejected requests, not put away, from the last 7 days;
//   - Order history: everything decided -- all of mine as staff, the whole venue's
//     as a Customer -- with nothing hidden by age or dismissal.

const NOW = Date.now()

describe('isOwnRequest', () => {
  it('is true only for the login that sent it', () => {
    expect(isOwnRequest(mkQrRequest({ requestedBy: 'sam' }), 'sam')).toBe(true)
    expect(isOwnRequest(mkQrRequest({ requestedBy: 'ana' }), 'sam')).toBe(false)
  })

  it('is false when nobody is signed in, or the sender profile is gone', () => {
    expect(isOwnRequest(mkQrRequest({ requestedBy: 'sam' }), null)).toBe(false)
    expect(isOwnRequest(mkQrRequest({ requestedBy: null }), null)).toBe(false)
    expect(isOwnRequest(mkQrRequest({ requestedBy: null }), 'sam')).toBe(false)
  })
})

describe('notApprovedForHome', () => {
  const opts = (over = {}) => ({ userId: 'sam', dismissed: [] as string[], now: NOW, ...over })

  it('keeps my rejected requests', () => {
    const mine = mkQrRequest({ id: 'a', requestedBy: 'sam', status: 'rejected' })
    expect(notApprovedForHome([mine], opts()).map((r) => r.id)).toEqual(['a'])
  })

  it('leaves out a colleague\'s, even though the venue can see it', () => {
    const theirs = mkQrRequest({ id: 'b', requestedBy: 'ana', status: 'rejected' })
    expect(notApprovedForHome([theirs], opts())).toEqual([])
  })

  it('leaves out my cancelled ones: I did that, there is nothing to explain', () => {
    const cancelled = mkQrRequest({ id: 'c', requestedBy: 'sam', status: 'cancelled', decisionReason: null })
    expect(notApprovedForHome([cancelled], opts())).toEqual([])
  })

  it('leaves out anything still open or approved', () => {
    const rows = (['pending', 'approving', 'approved'] as const).map((status) =>
      mkQrRequest({ id: status, requestedBy: 'sam', status }),
    )
    expect(notApprovedForHome(rows, opts())).toEqual([])
  })

  it('leaves out a card that was dismissed', () => {
    const a = mkQrRequest({ id: 'a', requestedBy: 'sam' })
    const b = mkQrRequest({ id: 'b', requestedBy: 'sam' })
    expect(notApprovedForHome([a, b], opts({ dismissed: ['a'] })).map((r) => r.id)).toEqual(['b'])
  })

  it('hides a card once the decision is more than 7 days old', () => {
    const fresh = mkQrRequest({ id: 'fresh', requestedBy: 'sam', decidedAt: ago(6 * DAY_MS + 23 * HOUR_MS) })
    const stale = mkQrRequest({ id: 'stale', requestedBy: 'sam', decidedAt: ago(7 * DAY_MS + HOUR_MS) })
    expect(notApprovedForHome([fresh, stale], opts()).map((r) => r.id)).toEqual(['fresh'])
    expect(NOT_APPROVED_CARD_MAX_AGE_MS).toBe(7 * DAY_MS)
  })

  it('ages a card from when it was decided, and from when it was sent if that is unknown', () => {
    const sentLongAgoDecidedToday = mkQrRequest({ id: 'x', requestedBy: 'sam', createdAt: ago(30 * DAY_MS), decidedAt: ago(HOUR_MS) })
    const noDecisionTime = mkQrRequest({ id: 'y', requestedBy: 'sam', createdAt: ago(30 * DAY_MS), decidedAt: null })
    expect(notApprovedForHome([sentLongAgoDecidedToday, noDecisionTime], opts()).map((r) => r.id)).toEqual(['x'])
  })

  it('shows nothing when nobody is signed in', () => {
    expect(notApprovedForHome([mkQrRequest({ requestedBy: 'sam' })], opts({ userId: null }))).toEqual([])
  })

  it('keeps the order it was given (newest first from the server) and does not mutate it', () => {
    const rows = [mkQrRequest({ id: '2' }), mkQrRequest({ id: '1' })].map((r) => ({ ...r, requestedBy: 'sam' }))
    const copy = [...rows]
    expect(notApprovedForHome(rows, opts()).map((r) => r.id)).toEqual(['2', '1'])
    expect(rows).toEqual(copy)
  })
})

describe('decidedForHistory', () => {
  const rows = [
    mkQrRequest({ id: 'mine-rej', requestedBy: 'sam', status: 'rejected' }),
    mkQrRequest({ id: 'mine-can', requestedBy: 'sam', status: 'cancelled', decisionReason: null }),
    mkQrRequest({ id: 'theirs-rej', requestedBy: 'ana', status: 'rejected' }),
    mkQrRequest({ id: 'old', requestedBy: 'sam', status: 'rejected', decidedAt: ago(60 * DAY_MS) }),
  ]

  it('shows kitchen staff their own, both kinds, however old', () => {
    expect(decidedForHistory(rows, { mode: 'requester', userId: 'sam' }).map((r) => r.id)).toEqual([
      'mine-rej',
      'mine-can',
      'old',
    ])
  })

  it('shows a Customer everything the venue\'s staff sent', () => {
    expect(decidedForHistory(rows, { mode: 'approver', userId: 'cust' }).map((r) => r.id)).toEqual([
      'mine-rej',
      'mine-can',
      'theirs-rej',
      'old',
    ])
  })

  it('never shows an open or approved request here: those have their own homes', () => {
    const mixed = [
      ...rows,
      mkQrRequest({ id: 'p', status: 'pending', requestedBy: 'sam' }),
      mkQrRequest({ id: 'ok', status: 'approved', requestedBy: 'sam' }),
    ]
    expect(decidedForHistory(mixed, { mode: 'approver', userId: 'cust' }).map((r) => r.id)).not.toContain('p')
    expect(decidedForHistory(mixed, { mode: 'approver', userId: 'cust' }).map((r) => r.id)).not.toContain('ok')
  })

  it('shows staff nothing when nobody is signed in', () => {
    expect(decidedForHistory(rows, { mode: 'requester', userId: null })).toEqual([])
  })
})
