// Client-side entry point for cancelling an order.
//
// The rules live in the pure shared module so the Edge Function and the browser
// run the very same code — the dialog's live verdict ("picking has already
// started", "refund the invoice first") is not a second implementation of the
// server's decision, it IS the server's decision, evaluated early. This file
// re-exports it under `@/` and adds the one thing only a UI needs: assembling a
// CancelSubject out of the shapes the app already holds.
//
// Mirrors lib/binCount.ts, which does the same job for the stocktake sheet.

export {
  cancelBlocker,
  evaluateCancel,
  CANCELLABLE_STATUSES,
  CANCEL_ROLES,
  CANCEL_REASON_MIN,
  CANCEL_REASON_MAX,
} from '@/supabase/functions/_shared/orderCancel'

export type {
  CancelDecision,
  CancelRefusal,
  CancelRefusalCode,
  CancelSubject,
  CancelInvoiceStatus,
  CancellableOrderStatus,
} from '@/supabase/functions/_shared/orderCancel'

import {
  cancelBlocker,
  type CancelRefusal,
  type CancelSubject,
} from '@/supabase/functions/_shared/orderCancel'
import type { Invoice, Order } from '@/types'

/**
 * Build the decision input from what a detail view already has to hand.
 *
 * `pickedUnits` is deliberately a parameter rather than something derived from
 * the order: the browser's `Order` type carries no pick progress, and inventing
 * a zero here would let the button offer to cancel a part-picked order that the
 * server then refuses. Callers that cannot answer it pass `undefined`, which is
 * treated as "unknown" and reported as not-yet-cancellable rather than as zero.
 */
export function cancelSubjectFor(
  order: Pick<Order, 'status'>,
  invoice: Pick<Invoice, 'status'> | null | undefined,
  actorRole: string,
  pickedUnits: number,
): CancelSubject {
  return {
    status: order.status as CancelSubject['status'],
    invoiceStatus: (invoice?.status ?? null) as CancelSubject['invoiceStatus'],
    pickedUnits,
    actorRole,
  }
}

/** The reason the Cancel action is unavailable, or null when it is available.
 *  Thin wrapper so components never assemble a CancelSubject by hand. */
export function cancelUnavailableReason(
  order: Pick<Order, 'status'>,
  invoice: Pick<Invoice, 'status'> | null | undefined,
  actorRole: string,
  pickedUnits: number,
): CancelRefusal | null {
  return cancelBlocker(cancelSubjectFor(order, invoice, actorRole, pickedUnits))
}
