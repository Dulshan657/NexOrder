// Order history: the orders that never became orders.
//
// A kitchen order an approver turns down, or that staff withdraw, leaves the
// pending banner and -- being no order -- appears nowhere else. This is its record:
// "Not approved and cancelled", directly under the pending banner.
//
//   mode="requester"   QR Staff. Their OWN requests only, each with "Edit and resend".
//   mode="approver"    a Customer login. The whole venue's, naming who sent each; no resend
//                      (the Customer is the one who said no, or is not the one who ordered).
//
// Each row: when it was sent, a status badge ("Not approved" red; "Cancelled by you" /
// "Cancelled by staff" grey), what was in it, the estimate (labelled as one -- the real
// price is set at approval, which never happened), and the approver's reason.
//
// Nothing here hides by age or dismissal: this is the record. Resending from here does
// put the matching Order home card away, since the person has acted on it.
//
// Laid out as stacked rows rather than a table so it reads at 360px: the text wraps,
// nothing truncates, and the button takes the row's full width on a phone.
//
// Renders nothing when there is nothing decided.

import { useState } from 'react'
import { Pencil } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { useDecidedQrRequests } from '@/hooks/queries/useQrOrderRequests'
import { useDismissedQrRequests } from '@/hooks/useDismissedQrRequests'
import { decidedForHistory } from '@/lib/qr/decidedRequests'
import { formatMoney, formatWhen, requestItemsSummary } from '@/lib/qr/qrFormat'
import { requestStatusLabel } from '@/lib/qr/requestStatusLabel'
import type { QrOrderRequest } from '@/types'
import { BADGE_CLASS, QUIET_BUTTON_CLASS, RESEND_BUTTON_CLASS } from './decidedRequestStyles'

/** How many rows show before "Show all". */
const VISIBLE_ROWS = 5

export interface DecidedQrRequestsProps {
  horecaId: number
  mode: 'requester' | 'approver'
  /** Load this request's lines into the cart; true if it did. Only used in requester mode. */
  onResend?: (request: QrOrderRequest) => boolean
}

export default function DecidedQrRequests({ horecaId, mode, onResend }: DecidedQrRequestsProps) {
  const { user } = useAuth()
  const userId = user?.id ?? null
  const { data: requests = [] } = useDecidedQrRequests(horecaId)
  const { dismiss } = useDismissedQrRequests(userId)
  const [showAll, setShowAll] = useState(false)

  const rows = decidedForHistory(requests, { mode, userId })
  if (rows.length === 0) return null

  const visible = showAll ? rows : rows.slice(0, VISIBLE_ROWS)
  const canResend = mode === 'requester' && onResend !== undefined

  const resend = (request: QrOrderRequest) => {
    if (onResend?.(request)) dismiss(request.id)
  }

  return (
    <section aria-label="Not approved and cancelled" className="rounded-xl border border-stone-200 bg-white px-4 py-3">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-stone-600">Not approved and cancelled</h2>
      <ul className="divide-y divide-stone-100">
        {visible.map((r) => {
          const status = requestStatusLabel(r.status, mode)
          const when = formatWhen(r.createdAt)
          const reason = r.decisionReason?.trim()
          const sent = mode === 'approver' ? `${r.staffName || 'Staff'} · sent ${when}` : `sent ${when}`
          return (
            <li key={r.id} className="py-3">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${BADGE_CLASS[status.tone]}`}>
                  {status.label}
                </span>
                <span className="text-xs text-stone-700 sm:text-sm">{sent}</span>
              </div>
              <p className="mt-1 break-words text-sm text-stone-800">{requestItemsSummary(r.items)}</p>
              <p className="mt-0.5 text-sm text-stone-700">{`${formatMoney(r.quotedTotal)} est.`}</p>
              {reason && <p className="mt-0.5 break-words text-sm text-stone-800">{`Reason: ${reason}`}</p>}
              {canResend && (
                <button
                  type="button"
                  onClick={() => resend(r)}
                  aria-label={`Edit and resend the order sent ${when}`}
                  className={`${RESEND_BUTTON_CLASS} mt-2 w-full sm:w-auto`}
                >
                  <Pencil className="h-4 w-4" aria-hidden="true" />
                  Edit and resend
                </button>
              )}
            </li>
          )
        })}
      </ul>
      {rows.length > visible.length && (
        <button type="button" onClick={() => setShowAll(true)} className={`${QUIET_BUTTON_CLASS} mt-1`}>
          {`Show all ${rows.length}`}
        </button>
      )}
    </section>
  )
}
