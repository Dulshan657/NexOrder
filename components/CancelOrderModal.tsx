import React, { useEffect, useState } from 'react';
import { Button, Modal, Textarea } from './ui';
import { CANCEL_REASON_MAX, CANCEL_REASON_MIN } from '../lib/orderCancel';

export interface CancelOrderModalProps {
  isOpen: boolean;
  orderId: string;
  /** Shown so the operator can see what they are voiding before they confirm. */
  orderTotal: number;
  customerName?: string;
  /** True when the order has an invoice that is not yet paid — it will be
   *  cancelled alongside the order, and saying so beforehand is the difference
   *  between an informed decision and a surprise. */
  invoiceWillCancel: boolean;
  isSubmitting?: boolean;
  errorMessage?: string;
  onConfirm: (reason: string) => void;
  onCancel: () => void;
}

/**
 * Confirm cancelling an order.
 *
 * Deliberately not a ConfirmDialog: cancellation demands a typed reason (mig
 * 00111 enforces it at the CHECK as well as in the Edge Function), and the
 * reason is the whole record of why. The length rule is imported from the
 * shared module rather than restated, so the client cannot start refusing at a
 * different threshold from the server.
 */
const CancelOrderModal: React.FC<CancelOrderModalProps> = ({
  isOpen,
  orderId,
  orderTotal,
  customerName,
  invoiceWillCancel,
  isSubmitting = false,
  errorMessage,
  onConfirm,
  onCancel,
}) => {
  const [reason, setReason] = useState('');

  useEffect(() => {
    if (isOpen) setReason('');
  }, [isOpen, orderId]);

  if (!isOpen) return null;

  const trimmed = reason.trim();
  const reasonInvalid = trimmed.length < CANCEL_REASON_MIN || trimmed.length > CANCEL_REASON_MAX;
  const canSubmit = !isSubmitting && !reasonInvalid;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    onConfirm(trimmed);
  };

  return (
    <Modal
      open
      onClose={onCancel}
      size="md"
      // Terminal, audit-logged action: a stray click outside must not dismiss it.
      dismissOnBackdrop={false}
      dirty={trimmed.length > 0}
      onSubmit={handleSubmit}
      title="Cancel this order"
      footer={({ requestClose }) => (
        <>
          <Button variant="secondary" onClick={requestClose} disabled={isSubmitting}>
            Keep order
          </Button>
          <Button type="submit" variant="danger" disabled={!canSubmit} loading={isSubmitting}>
            {isSubmitting ? 'Cancelling…' : 'Cancel order'}
          </Button>
        </>
      )}
    >
      <div className="space-y-4">
        <p className="text-sm text-stone-700">
          Cancel order <span className="font-mono font-semibold text-stone-900">{orderId}</span>
          {customerName ? <> for <span className="font-semibold">{customerName}</span></> : null}
          {', '}
          <span className="font-semibold tabular-nums">
            {orderTotal.toLocaleString('en-AU', { style: 'currency', currency: 'AUD' })}
          </span>
          .
        </p>

        <ul className="text-sm text-stone-600 bg-stone-50 border border-stone-200 rounded-lg px-4 py-3 space-y-1 list-disc list-inside">
          <li>The reserved stock is released back to available.</li>
          {invoiceWillCancel && <li>Its invoice is cancelled too, so it will not age into overdue.</li>}
          <li>The order is kept and marked Cancelled — nothing is deleted.</li>
          <li>This cannot be undone from the app.</li>
        </ul>

        <div>
          <label htmlFor="cancel-reason" className="block text-sm font-semibold text-stone-700">
            Reason <span className="text-red-500">*</span>
          </label>
          <p className="text-xs text-stone-500 mt-0.5 mb-1.5">
            Stored on the order and in the audit log. Minimum {CANCEL_REASON_MIN} characters.
          </p>
          <Textarea
            id="cancel-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            maxLength={CANCEL_REASON_MAX}
            placeholder="e.g. Customer phoned to cancel — ordered against the wrong site."
            autoFocus
          />
          <p className="text-xs text-stone-500 text-right mt-1 tabular-nums">
            {trimmed.length}/{CANCEL_REASON_MAX}
          </p>
        </div>

        {errorMessage && (
          <p className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">
            {errorMessage}
          </p>
        )}
      </div>
    </Modal>
  );
};

export default CancelOrderModal;
