import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { InvoiceStatus } from '../types';
import { X } from 'lucide-react';

export interface PaymentActionModalProps {
  isOpen: boolean;
  orderId: string;
  targetStatus: InvoiceStatus;
  reasonRequired: boolean;
  isSubmitting?: boolean;
  errorMessage?: string;
  onConfirm: (reason?: string) => void;
  onCancel: () => void;
}

const ACTION_LABELS: Record<InvoiceStatus, { title: string; verb: string; tone: string }> = {
  paid:    { title: 'Mark as Paid',    verb: 'paid',    tone: 'bg-emerald-600 hover:bg-emerald-700' },
  overdue: { title: 'Mark as Overdue', verb: 'overdue', tone: 'bg-rose-600 hover:bg-rose-700' },
  pending: { title: 'Mark as Pending', verb: 'pending', tone: 'bg-amber-600 hover:bg-amber-700' },
};

const PaymentActionModal: React.FC<PaymentActionModalProps> = ({
  isOpen,
  orderId,
  targetStatus,
  reasonRequired,
  isSubmitting = false,
  errorMessage,
  onConfirm,
  onCancel,
}) => {
  const [reason, setReason] = useState('');

  useEffect(() => {
    if (isOpen) setReason('');
  }, [isOpen, orderId, targetStatus]);

  if (!isOpen) return null;

  // Diagnostic — remove once payment-modal flow is confirmed working live.
  console.debug('[payment-action] modal mount', orderId, targetStatus);

  const config = ACTION_LABELS[targetStatus];
  const trimmed = reason.trim();
  const reasonInvalid = reasonRequired && (trimmed.length < 5 || trimmed.length > 500);
  const canSubmit = !isSubmitting && !reasonInvalid;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    onConfirm(reasonRequired ? trimmed : trimmed || undefined);
  };

  return createPortal(
    <div
      className="fixed inset-0 bg-stone-900/60 backdrop-blur-sm z-50 flex justify-center items-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="payment-action-title"
    >
      <form
        onSubmit={handleSubmit}
        className="bg-white rounded-xl shadow-2xl w-full max-w-md border border-stone-200"
      >
        <div className="flex items-center justify-between px-6 pt-5 pb-3 border-b border-stone-100">
          <h2 id="payment-action-title" className="text-lg font-display font-semibold text-stone-900">
            {config.title}
          </h2>
          <button
            type="button"
            onClick={onCancel}
            className="p-1 text-stone-400 hover:text-stone-700 rounded-lg hover:bg-stone-100 transition-colors"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-6 py-4 space-y-4">
          <p className="text-sm text-stone-700">
            Mark order <span className="font-mono font-semibold text-stone-900">{orderId}</span> as{' '}
            <span className="font-semibold">{config.verb}</span>.
          </p>

          {reasonRequired && (
            <div>
              <label htmlFor="payment-reason" className="block text-sm font-semibold text-stone-700">
                Reason <span className="text-red-500">*</span>
              </label>
              <p className="text-xs text-stone-500 mt-0.5 mb-1.5">
                Manager actions on payment status are audit-logged. Minimum 5 characters.
              </p>
              <textarea
                id="payment-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={3}
                maxLength={500}
                placeholder="e.g. Bank confirmation received from HoReCa accounts payable."
                className="w-full rounded-lg border-0 bg-stone-50 px-3 py-2 text-sm text-stone-900 ring-1 ring-inset ring-stone-200 focus:ring-2 focus:ring-inset focus:ring-blue-600 transition-all"
                autoFocus
              />
              <p className="text-xs text-stone-400 text-right mt-1 tabular-nums">
                {trimmed.length}/500
              </p>
            </div>
          )}

          {errorMessage && (
            <p className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">
              {errorMessage}
            </p>
          )}
        </div>

        <div className="px-6 pb-5 flex justify-end gap-3 border-t border-stone-100 pt-4">
          <button
            type="button"
            onClick={onCancel}
            disabled={isSubmitting}
            className="bg-white py-2 px-4 border border-stone-300 rounded-lg shadow-sm text-sm font-medium text-stone-700 hover:bg-stone-50 transition-colors disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!canSubmit}
            className={`inline-flex justify-center py-2 px-4 border border-transparent shadow-sm text-sm font-medium rounded-lg text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${config.tone}`}
          >
            {isSubmitting ? 'Saving…' : config.title}
          </button>
        </div>
      </form>
    </div>,
    document.body,
  );
};

export default PaymentActionModal;
