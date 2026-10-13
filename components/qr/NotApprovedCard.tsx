// Order home: "an approver said no to this, and here is why".
//
// When an approver rejects a held kitchen order the request leaves the pending
// banner and, never having become an order, appears in no history either -- so the
// cook's only trace was a bell entry that opened a page with nothing on it. This
// is the lasting trace: one card per rejected request of THEIRS, with the reason
// the approver was required to give, until it is dealt with.
//
//   Edit and resend   loads the lines into the cart (the owner supplies how) and,
//                     if that worked, puts the card away
//   Dismiss           puts it away without resending
//
// A card also expires a week after the decision. Dismissals are remembered per
// login in localStorage (lib/qr/dismissedRequests.ts) and survive it being blocked.
// Order history keeps the full record, so nothing is lost by dismissing here.
//
// Renders nothing when there is nothing to show, so it can sit under the pending
// banner without leaving a gap. Kitchen staff only: the owner mounts it for them.

import { AlertCircle, Pencil } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { useDecidedQrRequests } from '@/hooks/queries/useQrOrderRequests'
import { useDismissedQrRequests } from '@/hooks/useDismissedQrRequests'
import { notApprovedForHome } from '@/lib/qr/decidedRequests'
import { formatWhen, requestItemsSummary } from '@/lib/qr/qrFormat'
import { requestStatusLabel } from '@/lib/qr/requestStatusLabel'
import type { QrOrderRequest } from '@/types'
import { QUIET_BUTTON_CLASS, RESEND_BUTTON_CLASS } from './decidedRequestStyles'

export interface NotApprovedCardProps {
  horecaId: number
  /** Load this request's lines into the cart. Returns whether it did (see useResendQrRequest). */
  onResend: (request: QrOrderRequest) => boolean
}

export default function NotApprovedCard({ horecaId, onResend }: NotApprovedCardProps) {
  const { user } = useAuth()
  const userId = user?.id ?? null
  const { data: decided = [] } = useDecidedQrRequests(horecaId)
  const { dismissed, dismiss } = useDismissedQrRequests(userId)

  const cards = notApprovedForHome(decided, { userId, dismissed, now: Date.now() })
  if (cards.length === 0) return null

  const resend = (request: QrOrderRequest) => {
    if (onResend(request)) dismiss(request.id)
  }

  return (
    <section aria-label="Orders not approved">
      <ul className="space-y-2">
        {cards.map((r) => {
          const when = formatWhen(r.createdAt)
          const reason = r.decisionReason?.trim()
          return (
            <li key={r.id} className="rounded-xl border border-red-200 bg-red-50 p-3">
              <p className="flex items-start gap-1.5 text-sm font-semibold text-red-800">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                <span className="min-w-0 break-words">{`${requestStatusLabel('rejected', 'requester').label} · sent ${when}`}</span>
              </p>
              {reason && <p className="mt-1 break-words text-sm text-stone-800">{`Reason: ${reason}`}</p>}
              <p className="mt-1 break-words text-sm text-stone-700">{requestItemsSummary(r.items)}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => resend(r)}
                  aria-label={`Edit and resend the order sent ${when}`}
                  className={RESEND_BUTTON_CLASS}
                >
                  <Pencil className="h-4 w-4" aria-hidden="true" />
                  Edit and resend
                </button>
                <button
                  type="button"
                  onClick={() => dismiss(r.id)}
                  aria-label={`Dismiss the not approved order sent ${when}`}
                  className={QUIET_BUTTON_CLASS}
                >
                  Dismiss
                </button>
              </div>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
