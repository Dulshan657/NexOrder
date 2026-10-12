import { describe, expect, it } from 'vitest'
import {
  isQrNotificationType,
  qrActionLabel,
  qrNotificationAction,
  qrNotificationDetail,
} from '@/lib/qr/notificationText'

describe('qrNotificationAction', () => {
  it('a pending order opens its review', () => {
    expect(qrNotificationAction({ type: 'qr_order_pending', metadata: { requestId: 'r1' } })).toEqual({
      kind: 'review',
      requestId: 'r1',
    })
  })

  it('a pending order with no request id has nowhere to go', () => {
    expect(qrNotificationAction({ type: 'qr_order_pending', metadata: {} })).toBeNull()
    expect(qrNotificationAction({ type: 'qr_order_pending' })).toBeNull()
  })

  it('a decision goes to order history, with the order when there is one', () => {
    expect(qrNotificationAction({ type: 'qr_order_approved', metadata: { orderId: 'ORD-1' } })).toEqual({
      kind: 'orders',
      orderId: 'ORD-1',
    })
    expect(qrNotificationAction({ type: 'qr_order_rejected', metadata: { reason: 'x' } })).toEqual({
      kind: 'orders',
      orderId: null,
    })
  })

  it('a lock opens QR & PINs for its venue, and needs a real venue id', () => {
    expect(qrNotificationAction({ type: 'qr_code_locked', metadata: { horecaId: 7 } })).toEqual({
      kind: 'access',
      horecaId: 7,
    })
    expect(qrNotificationAction({ type: 'qr_code_locked', metadata: {} })).toBeNull()
  })

  it('every other type has no action', () => {
    expect(qrNotificationAction({ type: 'low_stock', metadata: { productId: 1 } })).toBeNull()
  })
})

describe('qrNotificationDetail', () => {
  it('summarises a pending order from its metadata, never from the message', () => {
    expect(
      qrNotificationDetail({ type: 'qr_order_pending', metadata: { staffName: 'Sam', itemCount: 1, quotedTotal: 12.5 } }),
    ).toBe('Sam · 1 item · $12.50 est.')
  })

  it('leaves out what the sender did not write', () => {
    expect(qrNotificationDetail({ type: 'qr_order_pending', metadata: { staffName: 'Sam' } })).toBe('Sam')
    expect(qrNotificationDetail({ type: 'qr_order_pending', metadata: {} })).toBeNull()
  })

  it('carries the reason of a rejection and the "with changes" of an approval', () => {
    expect(qrNotificationDetail({ type: 'qr_order_rejected', metadata: { reason: 'Out of season' } })).toBe(
      'Reason: Out of season',
    )
    expect(qrNotificationDetail({ type: 'qr_order_approved', metadata: { edited: true } })).toBe('Approved with changes')
    expect(qrNotificationDetail({ type: 'qr_order_approved', metadata: { edited: false } })).toBeNull()
  })
})

describe('isQrNotificationType / qrActionLabel', () => {
  it('recognises exactly the four kitchen-QR types', () => {
    for (const t of ['qr_order_pending', 'qr_order_approved', 'qr_order_rejected', 'qr_code_locked']) {
      expect(isQrNotificationType(t)).toBe(true)
    }
    expect(isQrNotificationType('order_status')).toBe(false)
  })

  it('names each action', () => {
    expect(qrActionLabel({ kind: 'review', requestId: 'r' })).toBe('Review order')
    expect(qrActionLabel({ kind: 'orders', orderId: null })).toBe('View order history')
    expect(qrActionLabel({ kind: 'access', horecaId: 1 })).toBe('Open QR & PINs')
  })
})
