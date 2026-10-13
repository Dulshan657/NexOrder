// The live "your order was approved / not approved" toast a kitchen phone shows.
//
// The server already writes a notification for each decision (qr-order-request ->
// notifyRequester) and the app already loads and live-refreshes them. This decides
// WHICH of those are news and WHAT to say; hooks/useQrDecisionToasts.ts does the
// watching. Pure, so the wording and the "new" rule are testable without a screen.

import type { AppNotification, ToastType } from '@/types'

const DECISION_TYPES = new Set<AppNotification['type']>(['qr_order_approved', 'qr_order_rejected'])

export function isQrDecision(n: Pick<AppNotification, 'type'>): boolean {
  return DECISION_TYPES.has(n.type)
}

/** The toast for one decision. A rejection carries the approver's reason when there is one. */
export function decisionToastFor(n: Pick<AppNotification, 'type' | 'metadata'>): { message: string; type: ToastType } {
  if (n.type === 'qr_order_approved') return { message: 'Your order was approved', type: 'success' }
  const reason = typeof n.metadata?.reason === 'string' ? n.metadata.reason.trim() : ''
  return {
    message: reason ? `Your order was not approved — ${reason}` : 'Your order was not approved',
    type: 'error',
  }
}

/**
 * The decisions in `notifications` that `seen` does not contain, oldest first so a
 * burst reads in the order it happened. Read state is ignored on purpose: a decision
 * that was read on another device is still news the first time THIS screen sees it.
 */
export function newDecisionNotifications(
  notifications: readonly AppNotification[],
  seen: ReadonlySet<string>,
): AppNotification[] {
  return notifications
    .filter((n) => isQrDecision(n) && !seen.has(n.id))
    .sort((a, b) => (Date.parse(a.timestamp) || 0) - (Date.parse(b.timestamp) || 0))
}
