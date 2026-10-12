// What the four kitchen-QR notification types say and where tapping them goes.
//
// The server composes each `message` (supabase/functions/_shared/qrNotify.ts,
// qr-order-request, qr-unlock) and writes the structured facts into `metadata`.
// This reads `metadata` -- it never parses the message -- to add a detail line
// and to decide the one action a tap performs. Pure, so the decision is testable
// without a bell, a panel, or a router.
//
// An action is only a REQUEST: whether it can run depends on things this file
// cannot know (is the module shipped, did the parent give the bell a way to
// navigate). The bell checks that; a notification whose action is unavailable
// simply marks itself read, as every other type does.

import type { AppNotification } from '@/types'
import { formatMoney, itemCountLabel } from './qrFormat'

export type QrNotificationAction =
  | { kind: 'review'; requestId: string }
  | { kind: 'orders'; orderId: string | null }
  | { kind: 'access'; horecaId: number }

export function isQrNotificationType(type: string): boolean {
  return (
    type === 'qr_order_pending' ||
    type === 'qr_order_approved' ||
    type === 'qr_order_rejected' ||
    type === 'qr_code_locked'
  )
}

/** The one thing a tap does, or null when the metadata needed for it is missing. */
export function qrNotificationAction(n: Pick<AppNotification, 'type' | 'metadata'>): QrNotificationAction | null {
  const m = n.metadata ?? {}
  switch (n.type) {
    case 'qr_order_pending':
      return m.requestId ? { kind: 'review', requestId: m.requestId } : null
    case 'qr_order_approved':
    case 'qr_order_rejected':
      return { kind: 'orders', orderId: m.orderId ?? null }
    case 'qr_code_locked':
      return typeof m.horecaId === 'number' ? { kind: 'access', horecaId: m.horecaId } : null
    default:
      return null
  }
}

/** The label on the tap target, for a screen reader and the sighted alike. */
export function qrActionLabel(action: QrNotificationAction): string {
  switch (action.kind) {
    case 'review':
      return 'Review order'
    case 'orders':
      return 'View order history'
    case 'access':
      return 'Open QR & PINs'
  }
}

/** A second line of facts under the server's message, or null when there is nothing to add. */
export function qrNotificationDetail(n: Pick<AppNotification, 'type' | 'metadata'>): string | null {
  const m = n.metadata ?? {}
  switch (n.type) {
    case 'qr_order_pending': {
      const parts: string[] = []
      if (m.staffName) parts.push(m.staffName)
      if (typeof m.itemCount === 'number') parts.push(itemCountLabel(m.itemCount))
      if (typeof m.quotedTotal === 'number') parts.push(`${formatMoney(m.quotedTotal)} est.`)
      return parts.length > 0 ? parts.join(' · ') : null
    }
    case 'qr_order_approved':
      return m.edited ? 'Approved with changes' : null
    case 'qr_order_rejected':
      return m.reason ? `Reason: ${m.reason}` : null
    default:
      return null
  }
}
