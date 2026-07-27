import React, { useEffect, useState } from 'react';
import type { InvoiceStatus } from '../types';
import { Button, Modal, Textarea, type ButtonVariant } from './ui';

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

const ACTION_LABELS: Record<InvoiceStatus, { title: string; verb: string; variant: ButtonVariant }> = {
  paid:    { title: 'Mark as Paid',    verb: 'paid',    variant: 'primary' },
  overdue: { title: 'Mark as Overdue', verb: 'overdue', variant: 'danger'  },
  pending: { title: 'Mark as Pending', verb: 'pending', variant: 'primary' },
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

  return (
    <Modal
      open
      onClose={onCancel}
      size="md"
      // Terminal, audit-logged action: a stray click outside must not dismiss it.
      dismissOnBackdrop={false}
      // Only the audit reason is worth protecting; without one there is nothing to discard.
      dirty={reasonRequired && trimmed.length > 0}
      onSubmit={handleSubmit}
      title={config.title}
      footer={({ requestClose }) => (
        <>
          <Button variant="secondary" onClick={requestClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button type="submit" variant={config.variant} disabled={!canSubmit} loading={isSubmitting}>
            {isSubmitting ? 'Saving…' : config.title}
          </Button>
        </>
      )}
    >
      <div className="space-y-4">
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
            <Textarea
              id="payment-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              maxLength={500}
              placeholder="e.g. Bank confirmation received from HoReCa accounts payable."
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
    </Modal>
  );
};

export default PaymentActionModal;
