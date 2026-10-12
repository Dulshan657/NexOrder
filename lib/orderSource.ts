import type { Order } from '../types';
import { UserRole } from '../types';

export type OrderSourceKey =
  | 'walk_in'
  | 'customer_web'
  | 'rep_field'
  | 'rep_office'
  | 'admin'
  | 'manager'
  | 'email_inbound'
  | 'qr_kitchen';

export type OrderSourceTone = 'blue' | 'amber' | 'emerald' | 'stone' | 'violet' | 'sky' | 'teal' | 'rose';

export interface OrderSource {
  key: OrderSourceKey;
  label: string;
  tone: OrderSourceTone;
}

/**
 * Derive a display source for an order from existing data.
 *
 * Precedence:
 *   1. Email Inbound — the order was created by the approve-po Edge Function
 *      from an automatically-extracted customer PO. Populated on Order when
 *      the data adapter joins `pending_pos.approved_order_id`.
 *   2. Kitchen QR — the order was placed by approving a QR order request
 *      (mig 00129). Populated on Order when the adapter joins
 *      `qr_order_requests.approved_order_id`; the label carries the staff
 *      member's name AT SUBMIT. The request's RLS is Admin/Manager, the venue's
 *      assigned reps and the venue itself, so for other viewers the join is
 *      absent and the order falls through to the role fallback below -- which is
 *      correct, since they never saw the request either.
 *   3. Walk-in — the HoReCa was created by a rep on a route (`isTemporary`)
 *      or promoted from a walk-in record (`reviewedAt`), regardless of who
 *      keyed the order in.
 *   4. submittedBy.role fallback for human-placed orders.
 */
/**
 * "via QR · Sam". A name is free text a manager typed; an empty one (the 00130
 * snapshot column defaults to '') must not render as a dangling "via QR ·".
 */
function qrKitchenSource(staffName: string | null | undefined): OrderSource {
  const name = (staffName ?? '').trim();
  return { key: 'qr_kitchen', label: name ? `via QR · ${name}` : 'via QR', tone: 'rose' };
}

export function getOrderSource(order: Order): OrderSource {
  if (order.inboundMessageId) {
    return { key: 'email_inbound', label: 'Email PO', tone: 'teal' };
  }

  if (order.qrRequest) {
    return qrKitchenSource(order.qrRequest.staffName);
  }

  const horeca = order.hoReCa;
  const wasWalkIn = Boolean(horeca?.isTemporary || horeca?.reviewedAt);

  if (wasWalkIn) {
    return { key: 'walk_in', label: 'Walk-in', tone: 'amber' };
  }

  switch (order.submittedBy?.role) {
    case UserRole.CUSTOMER:
      return { key: 'customer_web', label: 'Customer Web', tone: 'blue' };
    case UserRole.FIELD_REP:
      return { key: 'rep_field', label: 'Field Rep', tone: 'emerald' };
    case UserRole.OFFICE_REP:
      return { key: 'rep_office', label: 'Office Rep', tone: 'sky' };
    case UserRole.QR_STAFF:
      // The qr_order_requests join above is RLS-gated (Admin/Manager, assigned
      // reps, the venue). A viewer outside that set can still read the
      // submitter's profile name, so the order is not mislabelled "Customer Web".
      return qrKitchenSource(order.submittedBy?.name);
    case UserRole.ADMIN:
      return { key: 'admin', label: 'Admin', tone: 'violet' };
    case UserRole.MANAGER:
      return { key: 'manager', label: 'Manager', tone: 'stone' };
    default:
      return { key: 'customer_web', label: 'Customer Web', tone: 'blue' };
  }
}

export interface InboundApproval {
  /** True when auto-approved (no human reviewer) — show "Auto-approved (system)". */
  auto: boolean;
  /** Approver's name for human approvals; null when auto-approved. */
  name: string | null;
}

/**
 * Approval descriptor for a PO-Inbox order, or null when the order did not
 * originate from the PO Inbox. For human approvals `submittedBy` IS the
 * approver (see approve-po: submitted_by = approverUserId in human mode), so no
 * separate reviewer lookup is needed; auto approvals deliberately drop the name
 * because submittedBy then points at the mailbox owner, not an approver.
 */
export function getInboundApproval(order: Order): InboundApproval | null {
  if (!order.inboundMessageId) return null;
  return order.autoApproved
    ? { auto: true, name: null }
    : { auto: false, name: order.submittedBy?.name ?? null };
}
