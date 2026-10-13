import { describe, expect, it } from 'vitest'
import { decisionToastFor, newDecisionNotifications } from '@/lib/qr/decisionToasts'
import type { AppNotification } from '@/types'

const n = (over: Partial<AppNotification> & Pick<AppNotification, 'id' | 'type'>): AppNotification => ({
  message: 'm',
  timestamp: '2026-10-13T00:00:00Z',
  read: false,
  ...over,
})

describe('decisionToastFor', () => {
  it('says an approval was approved, as a success', () => {
    expect(decisionToastFor(n({ id: 'a', type: 'qr_order_approved' }))).toEqual({
      message: 'Your order was approved',
      type: 'success',
    })
  })

  it('says a rejection was not approved, with the reason, as an error', () => {
    expect(decisionToastFor(n({ id: 'r', type: 'qr_order_rejected', metadata: { reason: 'Out of season' } }))).toEqual({
      message: 'Your order was not approved — Out of season',
      type: 'error',
    })
  })

  it('leaves the dash off when the reason is missing or blank', () => {
    expect(decisionToastFor(n({ id: 'r', type: 'qr_order_rejected' })).message).toBe('Your order was not approved')
    expect(decisionToastFor(n({ id: 'r', type: 'qr_order_rejected', metadata: { reason: '   ' } })).message).toBe(
      'Your order was not approved',
    )
  })

  it('trims the reason', () => {
    expect(decisionToastFor(n({ id: 'r', type: 'qr_order_rejected', metadata: { reason: '  Too much ' } })).message).toBe(
      'Your order was not approved — Too much',
    )
  })
})

describe('newDecisionNotifications', () => {
  const approved = n({ id: 'a', type: 'qr_order_approved' })
  const rejected = n({ id: 'r', type: 'qr_order_rejected' })
  const other = n({ id: 'o', type: 'order_status' })
  const pending = n({ id: 'p', type: 'qr_order_pending' })

  it('returns only decisions it has not seen', () => {
    expect(newDecisionNotifications([approved, rejected], new Set(['a'])).map((x) => x.id)).toEqual(['r'])
  })

  it('ignores every other kind of notification, QR or not', () => {
    expect(newDecisionNotifications([other, pending, approved], new Set()).map((x) => x.id)).toEqual(['a'])
  })

  it('returns oldest first, so a burst reads in the order it happened', () => {
    const older = n({ id: 'older', type: 'qr_order_approved', timestamp: '2026-10-13T01:00:00Z' })
    const newer = n({ id: 'newer', type: 'qr_order_rejected', timestamp: '2026-10-13T02:00:00Z' })
    // The query hands them back newest first.
    expect(newDecisionNotifications([newer, older], new Set()).map((x) => x.id)).toEqual(['older', 'newer'])
  })

  it('does not look at, or touch, read state: a read decision is still news the first time', () => {
    const read = n({ id: 'x', type: 'qr_order_approved', read: true })
    expect(newDecisionNotifications([read], new Set()).map((x) => x.id)).toEqual(['x'])
  })
})
