import type { Order } from '../types';
import { UserRole } from '../types';

export type OrderSourceKey =
  | 'walk_in'
  | 'customer_web'
  | 'rep_field'
  | 'rep_office'
  | 'admin'
  | 'manager'
  | 'email_inbound';

export type OrderSourceTone = 'blue' | 'amber' | 'emerald' | 'stone' | 'violet' | 'sky' | 'teal';

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
 *   2. Walk-in — the HoReCa was created by a rep on a route (`isTemporary`)
 *      or promoted from a walk-in record (`reviewedAt`), regardless of who
 *      keyed the order in.
 *   3. submittedBy.role fallback for human-placed orders.
 */
export function getOrderSource(order: Order): OrderSource {
  if (order.inboundMessageId) {
    return { key: 'email_inbound', label: 'Email PO', tone: 'teal' };
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
    case UserRole.ADMIN:
      return { key: 'admin', label: 'Admin', tone: 'violet' };
    case UserRole.MANAGER:
      return { key: 'manager', label: 'Manager', tone: 'stone' };
    default:
      return { key: 'customer_web', label: 'Customer Web', tone: 'blue' };
  }
}
