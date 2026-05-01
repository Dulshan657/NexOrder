import React from 'react';
import type { Invoice } from '../types';

export type PaymentDisplayState = 'not_invoiced' | 'pending' | 'paid' | 'overdue';

interface PaymentStatusBadgeProps {
  invoice: Invoice | undefined;
  /** Compact omits the days-late suffix for overdue invoices. Lists use compact; details don't. */
  compact?: boolean;
}

const STATE_STYLES: Record<PaymentDisplayState, { container: string; dot: string }> = {
  not_invoiced: {
    container: 'bg-stone-100 text-stone-600 border-stone-200',
    dot: 'bg-stone-400',
  },
  pending: {
    container: 'bg-amber-50 text-amber-800 border-amber-200',
    dot: 'bg-amber-500',
  },
  paid: {
    container: 'bg-emerald-50 text-emerald-800 border-emerald-200',
    dot: 'bg-emerald-500',
  },
  overdue: {
    container: 'bg-rose-50 text-rose-800 border-rose-200',
    dot: 'bg-rose-500',
  },
};

const SHORT_DATE_FORMAT: Intl.DateTimeFormatOptions = { day: '2-digit', month: 'short' };

function formatShortDate(iso: string): string {
  const d = new Date(iso + (iso.length === 10 ? 'T00:00:00' : ''));
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, SHORT_DATE_FORMAT);
}

function daysBetween(fromIso: string, toIso: string): number {
  const a = new Date(fromIso + (fromIso.length === 10 ? 'T00:00:00' : ''));
  const b = new Date(toIso + (toIso.length === 10 ? 'T00:00:00' : ''));
  return Math.round((b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24));
}

export function getPaymentDisplayState(invoice: Invoice | undefined): PaymentDisplayState {
  if (!invoice) return 'not_invoiced';
  return invoice.status;
}

export function getPaymentLabel(invoice: Invoice | undefined, compact = false): string {
  if (!invoice) return 'Not Invoiced';
  switch (invoice.status) {
    case 'paid':
      return invoice.paidDate
        ? `Paid · ${formatShortDate(invoice.paidDate)}`
        : 'Paid';
    case 'overdue': {
      const base = `Overdue · due ${formatShortDate(invoice.dueDate)}`;
      if (compact) return base;
      const today = new Date().toISOString().slice(0, 10);
      const daysLate = daysBetween(invoice.dueDate, today);
      return daysLate > 0 ? `${base} (${daysLate}d late)` : base;
    }
    case 'pending':
    default:
      return `Pending · due ${formatShortDate(invoice.dueDate)}`;
  }
}

const PaymentStatusBadge: React.FC<PaymentStatusBadgeProps> = ({ invoice, compact = false }) => {
  const state = getPaymentDisplayState(invoice);
  const styles = STATE_STYLES[state];
  const label = getPaymentLabel(invoice, compact);

  return (
    <span
      className={`inline-flex items-center gap-1.5 text-xs font-medium px-2 py-0.5 rounded-full border ${styles.container}`}
      title={invoice ? `Invoice ${invoice.id}` : 'No invoice issued yet'}
    >
      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${styles.dot}`} />
      {label}
    </span>
  );
};

export default PaymentStatusBadge;
