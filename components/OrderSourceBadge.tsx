import React from 'react';
import type { Order } from '../types';
import { getOrderSource, getInboundApproval, type OrderSourceTone } from '../lib/orderSource';

interface OrderSourceBadgeProps {
  order: Order;
}

const TONE_CLASSES: Record<OrderSourceTone, string> = {
  blue: 'bg-blue-50 text-blue-700 border-blue-200',
  amber: 'bg-amber-50 text-amber-800 border-amber-200',
  emerald: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  stone: 'bg-stone-100 text-stone-700 border-stone-200',
  violet: 'bg-violet-50 text-violet-700 border-violet-200',
  sky: 'bg-sky-50 text-sky-700 border-sky-200',
  teal: 'bg-teal-50 text-teal-700 border-teal-200',
};

const OrderSourceBadge: React.FC<OrderSourceBadgeProps> = ({ order }) => {
  const source = getOrderSource(order);
  const classes = TONE_CLASSES[source.tone];

  // For PO-Inbox orders, append who approved on the same badge:
  // "Email PO · Auto-approved" or "Email PO · Jane Smith". The approver is
  // rendered in normal case so a person's name stays readable next to the
  // uppercased source label.
  const approval = getInboundApproval(order);
  const approver = approval ? (approval.auto ? 'Auto-approved' : approval.name) : null;

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${classes}`}
      title={approver ? `Source: ${source.label} — Approved by ${approver}` : `Source: ${source.label}`}
    >
      <span className={`w-1 h-1 rounded-full ${classes.split(' ')[1].replace('text-', 'bg-')}`} />
      {source.label}
      {approver && (
        <span className="font-medium normal-case opacity-80">· {approver}</span>
      )}
    </span>
  );
};

export default OrderSourceBadge;
