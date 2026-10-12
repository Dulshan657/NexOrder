import React, { useState } from 'react'
import { AlertTriangle, Info } from 'lucide-react'
import { Button, Callout, Field, Modal, Textarea } from '@/components/ui'
import { formatMoney, itemCountLabel } from '@/lib/qr/qrFormat'
import type { ReorderLine, ReorderPlan } from '@/lib/kitchen/reorderPlan'

// The confirm step of "Order same again": what is about to be ordered, at today's
// prices, with anything that will NOT be ordered named and explained.
//
// The wording differs by who is asking, because the consequence does:
//   QR Staff   "Send for approval" -- nothing is ordered until a manager says so.
//   Customer   "Place order"       -- this one is real, immediately.
// Totals are an ESTIMATE either way (the server reprices); the label says so.

export interface KitchenSameAgainModalProps {
  open: boolean
  onClose: () => void
  /** "12 Oct" -- when the order being repeated was placed. */
  fromLabel: string
  plan: ReorderPlan
  /** QR Staff: the request is held for approval rather than placed. */
  heldForApproval: boolean
  busy: boolean
  /** The last attempt's failure, worded for a person. */
  error: string | null
  onConfirm: (notes: string) => void
  /** Load these lines into the cart instead. */
  onEdit: () => void
}

function LineRow({ line }: { line: ReorderLine }) {
  return (
    <li className="flex items-start justify-between gap-3 py-2.5">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-stone-900">{line.source.name}</p>
        <p className="text-xs text-stone-600">
          {line.quantity} × {line.unitLabel}
          {line.status !== 'unavailable' && <> · {formatMoney(line.unitPrice)} each</>}
        </p>
        {line.status === 'low' && line.reason && (
          <p className="mt-0.5 flex items-center gap-1 text-xs font-medium text-amber-800">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            {line.reason}
          </p>
        )}
      </div>
      <p className="shrink-0 text-sm font-semibold tabular-nums text-stone-900">{formatMoney(line.lineTotal)}</p>
    </li>
  )
}

const KitchenSameAgainModal: React.FC<KitchenSameAgainModalProps> = ({
  open,
  onClose,
  fromLabel,
  plan,
  heldForApproval,
  busy,
  error,
  onConfirm,
  onEdit,
}) => {
  const [notes, setNotes] = useState('')
  const nothingToSend = plan.included.length === 0
  const confirmLabel = heldForApproval ? 'Send for approval' : 'Place order'

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="md"
      title="Order same again"
      description={`From ${fromLabel} · at today's prices`}
      dirty={notes.trim().length > 0}
      footer={({ requestClose }) => (
        <div className="flex w-full flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="ghost" onClick={requestClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="secondary" onClick={onEdit} disabled={busy || nothingToSend}>
            Edit before ordering
          </Button>
          <Button onClick={() => onConfirm(notes.trim())} loading={busy} disabled={nothingToSend}>
            {confirmLabel}
          </Button>
        </div>
      )}
    >
      <div className="space-y-4">
        {heldForApproval ? (
          <Callout tone="info" icon={<Info className="h-4 w-4" aria-hidden="true" />} dense>
            This goes to your manager for approval first. Nothing is ordered until they approve it.
          </Callout>
        ) : null}

        {nothingToSend ? (
          <Callout tone="warning" icon={<AlertTriangle className="h-4 w-4" aria-hidden="true" />} title="Nothing to order">
            None of the items from that order can be ordered right now.
          </Callout>
        ) : (
          <section aria-label="Items in this order">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-stone-600">
              {itemCountLabel(plan.included.length)}
            </h3>
            <ul className="divide-y divide-stone-100">
              {plan.included.map((line) => (
                // `key` can't go on a typed local component here (no @types/react).
                <React.Fragment key={line.key}>
                  <LineRow line={line} />
                </React.Fragment>
              ))}
            </ul>
          </section>
        )}

        {plan.excluded.length > 0 && (
          <section aria-label="Items not included">
            <Callout
              tone="warning"
              icon={<AlertTriangle className="h-4 w-4" aria-hidden="true" />}
              title={`${itemCountLabel(plan.excluded.length)} left out`}
              dense
            >
              <ul className="mt-1 space-y-0.5">
                {plan.excluded.map((line) => (
                  <li key={line.key}>
                    {line.source.name} — {line.reason}
                  </li>
                ))}
              </ul>
            </Callout>
          </section>
        )}

        {!nothingToSend && (
          <div className="rounded-lg bg-stone-50 p-3 text-sm">
            <dl className="space-y-1">
              {plan.promoDiscount > 0 && (
                <>
                  <div className="flex justify-between text-stone-700">
                    <dt>Subtotal</dt>
                    <dd className="tabular-nums">{formatMoney(plan.subtotal)}</dd>
                  </div>
                  <div className="flex justify-between text-emerald-800">
                    <dt>Promotions</dt>
                    <dd className="tabular-nums">−{formatMoney(plan.promoDiscount)}</dd>
                  </div>
                </>
              )}
              <div className="flex justify-between font-semibold text-stone-900">
                <dt>Estimated total</dt>
                <dd className="tabular-nums">{formatMoney(plan.estimatedTotal)}</dd>
              </div>
            </dl>
            <p className="pt-1 text-xs text-stone-600">
              An estimate. The final price is set when the order is {heldForApproval ? 'approved' : 'placed'}.
            </p>
          </div>
        )}

        {!nothingToSend && (
          <Field label="Note for your supplier (optional)" htmlFor="kitchen-same-again-notes">
            <Textarea
              id="kitchen-same-again-notes"
              rows={2}
              value={notes}
              maxLength={500}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Anything they should know about this order"
            />
          </Field>
        )}

        {error && (
          <p role="alert" className="text-sm font-medium text-red-700">
            {error}
          </p>
        )}
      </div>
    </Modal>
  )
}

export default KitchenSameAgainModal
