// Held kitchen orders, from either side of the counter.
//
//   mode="requester"   QR Staff. Their venue's orders that are waiting on someone:
//                      "Waiting for approval - sent 10:42 - $48.20 est. - 3 items",
//                      with Cancel on the ones THEY sent (never a colleague's).
//   mode="approver"    Customer logins, assigned reps, Admin, Manager. One row per
//                      held order: venue, who sent it, when, how big, and a Review
//                      button that opens the priced review modal.
//
// Renders nothing while there is nothing pending, so it can be mounted at the top
// of any page without leaving a heading over an empty box.
//
// `horecaId` scopes the list. Omit it as an approver to see every venue RLS lets
// you see (Admin/Manager all, a rep their assigned venues).
//
// The list refreshes itself: the realtime channel (hooks/useRealtimeSubscriptions)
// invalidates `qr-order-requests` when any client changes one, and every mutation
// here invalidates it too.

import { Fragment, Suspense, useState } from 'react'
import { Clock } from 'lucide-react'
import { Button } from '@/components/ui'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { useAuth } from '@/hooks/useAuth'
import { useToastActions } from '@/hooks/useToasts'
import { useHoReCas } from '@/hooks/queries/useHoReCas'
import { useCancelQrRequest, usePendingQrRequests } from '@/hooks/queries/useQrOrderRequests'
import { isQrApiError } from '@/services/supabase/qrService'
import { lazyWithRetry } from '@/lib/lazyWithRetry'
import { MODULE_SHOP } from '@/lib/modules'
import { formatWhen, requestEstimateSummary } from '@/lib/qr/qrFormat'
import type { QrOrderRequest } from '@/types'

// Gated at the declaration, not the JSX: a disabled module must not ship the chunk.
const QrRequestReviewModal = MODULE_SHOP ? lazyWithRetry(() => import('./QrRequestReviewModal')) : null

/** How many rows show before "Show all". Keeps a page-top panel from swallowing the page. */
const VISIBLE_ROWS = 5

export interface PendingQrRequestsProps {
  horecaId?: number
  mode: 'requester' | 'approver'
  /** One-line rows in a single banner, for tight spots (kitchen home, rep dashboard). */
  compact?: boolean
}

/** A row's two halves: who/when, and how big. Compact shows them as two lines, never one truncated one. */
interface RowText {
  head: string
  summary: string
}

export default function PendingQrRequests({ horecaId, mode, compact = false }: PendingQrRequestsProps) {
  const { user } = useAuth()
  const { addToast } = useToastActions()
  const { data: requests = [] } = usePendingQrRequests(horecaId)
  // Venue names are only shown to approvers (a kitchen sees its own venue only).
  const { data: venues } = useHoReCas({ enabled: mode === 'approver' })
  const cancel = useCancelQrRequest()

  const [reviewId, setReviewId] = useState<string | null>(null)
  const [showAll, setShowAll] = useState(false)
  const [cancellingId, setCancellingId] = useState<string | null>(null)

  const venueName = (id: number): string =>
    ((venues ?? []) as Array<{ id: number; name: string }>).find((v) => v.id === id)?.name ?? `Venue #${id}`

  const visible = showAll ? requests : requests.slice(0, VISIBLE_ROWS)
  const hidden = requests.length - visible.length
  const myId = user?.id ?? null

  const onCancel = async (r: QrOrderRequest) => {
    setCancellingId(r.id)
    try {
      await cancel.mutateAsync(r.id)
      addToast('Order request cancelled', 'success')
    } catch (err) {
      // A conflict means an approver got there first; the hook already refreshed the list.
      addToast(isQrApiError(err) ? err.message : 'Could not cancel the request. Please try again.', 'error')
    } finally {
      setCancellingId(null)
    }
  }

  const rowText = (r: QrOrderRequest): RowText => {
    const when = formatWhen(r.createdAt)
    if (mode === 'requester') {
      const mine = myId !== null && r.requestedBy === myId
      const who = mine ? '' : `${r.staffName || 'Staff'} · `
      // The banner's own heading already says "Waiting for approval"; repeating it
      // on a compact row only pushes the amount off the end of a 360px line.
      return { head: compact ? `${who}sent ${when}` : `Waiting for approval · ${who}sent ${when}`, summary: requestEstimateSummary(r) }
    }
    return { head: `${r.staffName || 'Staff'} · ${when}`, summary: requestEstimateSummary(r) }
  }

  const rows = visible.map((r) => {
    const mine = myId !== null && r.requestedBy === myId
    const label = mode === 'approver' ? venueName(r.horecaId) : null
    const text = rowText(r)
    return (
      <li
        key={r.id}
        className={`flex items-center justify-between gap-3 ${compact ? 'py-1.5' : 'py-3'}`}
      >
        <div className="min-w-0">
          {label && <p className="truncate text-sm font-semibold text-stone-900">{label}</p>}
          {compact ? (
            // Two lines that WRAP, never one that truncates: the amount is the part
            // an approver or a cook is looking for, and it sits at the end.
            <p className="break-words text-xs text-stone-700">
              <span className="block">{text.head}</span>
              <span className="block">{text.summary}</span>
            </p>
          ) : (
            <p className="text-xs text-stone-700 sm:text-sm">{`${text.head} · ${text.summary}`}</p>
          )}
          {mode === 'approver' && r.lastError && !compact && (
            <p className="mt-0.5 text-xs font-medium text-amber-800">Last approval attempt failed: {r.lastError}</p>
          )}
        </div>
        {mode === 'approver' ? (
          <Button size="sm" onClick={() => setReviewId(r.id)} aria-label={`Review order from ${label} sent ${formatWhen(r.createdAt)}`}>
            Review
          </Button>
        ) : (
          mine && (
            <Button
              size="sm"
              variant="secondary"
              loading={cancellingId === r.id}
              disabled={cancellingId !== null}
              onClick={() => onCancel(r)}
              aria-label={`Cancel your order request sent ${formatWhen(r.createdAt)}`}
            >
              Cancel
            </Button>
          )
        )}
      </li>
    )
  })

  const title = mode === 'approver' ? `Awaiting approval (${requests.length})` : 'Waiting for approval'

  // Nothing pending renders no panel -- but the review modal is NOT part of the panel.
  // Approving claims the request (status 'approving'), which takes it out of the pending
  // list; with one request that empties the list, and a modal tied to it would unmount
  // in the middle of its own approval and lose its draft and any error to show.
  const panel =
    requests.length === 0 ? null : (
      <section
        aria-label={title}
        className={`rounded-xl border border-amber-200 bg-amber-50/70 ${compact ? 'px-3 py-1.5' : 'px-4 py-3'}`}
      >
        <h2 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-amber-800">
          <Clock className="w-3.5 h-3.5" aria-hidden="true" />
          {title}
        </h2>
        <ul className="divide-y divide-amber-200/70">{rows}</ul>
        {hidden > 0 && (
          <button
            type="button"
            onClick={() => setShowAll(true)}
            className="touch-target-y mt-1 text-xs font-medium text-amber-900 underline hover:no-underline"
          >
            Show all {requests.length}
          </button>
        )}
      </section>
    )

  return (
    <>
      {panel}

      {reviewId && QrRequestReviewModal && (
        <ErrorBoundary label="Order review">
          <Suspense fallback={null}>
            {/* keyed by request, so a different request never inherits another's draft */}
            <Fragment key={reviewId}>
              <QrRequestReviewModal requestId={reviewId} onClose={() => setReviewId(null)} />
            </Fragment>
          </Suspense>
        </ErrorBoundary>
      )}
    </>
  )
}
