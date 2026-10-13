// Review a held kitchen order: see it priced by the server, fix the lines, then
// approve it (which places the REAL order) or decline it with a reason.
//
// ── WHAT IS ON SCREEN IS THE SERVER'S ARITHMETIC ────────────────────────────
// Nothing here prices anything. Every figure comes from `previewQrRequest`, which
// runs the same place-order core approval runs, in dry-run, and returns EVERY
// problem at once (stock, minimum, credit). So when Approve is offered it is
// because the server just said it would work -- and when it is not, the reasons
// are on screen instead of arriving one at a time as failed attempts.
//
// ── EDITING ─────────────────────────────────────────────────────────────────
// The approver edits a DRAFT of the lines. The draft is debounced into the
// preview query (so typing "12" does not fire a preview for "1" then "12" against
// a 30/min bucket shared with approve and reject), and `items` is sent to
// `approve` ONLY when the draft differs from what the kitchen asked for: the
// server reads "items present" as "the approver edited this", which is what tells
// the requester "approved with changes" (lib/qr/reviewLines.ts `itemsToSend`).
//
// ── ERRORS ──────────────────────────────────────────────────────────────────
//   QR_REQUEST_CONFLICT   someone decided it first -> toast, close, lists refetch
//   err.orderId set       the order WAS placed but the request could not be
//                         marked approved -> toast, close. Approving again would
//                         place a second order.
//   anything else         a business rule or a transient failure -> inline, and the
//                         mutation's invalidation re-runs the preview so the
//                         reason shows up in the problems list.
//
// ── SHORT LINES ─────────────────────────────────────────────────────────────
// The server counts stock in BASE units ("42 of X available, 48 requested") while
// the stepper counts in the unit the kitchen ordered (4 = 4 cartons of 12), so its
// sentence reads as a contradiction. For INSUFFICIENT_STOCK the callout and the note
// under the line are rewritten in the line's own unit (lib/qr/describeShortage.ts),
// with a one-tap "Set to N" / "Remove line" fix. Approve is untouched by any of this:
// it stays withheld while the server reports a problem. The shortage is worked out
// from the PREVIEW's own lines, so it always describes the figures the server sent --
// and the fix is held while the draft has moved ahead of them.
//
// And a request the caller cannot see at all (a bell entry for another rep's venue,
// FORBIDDEN, or one that no longer exists, NOT_FOUND) is a verdict, not a fault: it
// gets a plain sentence and a Close button -- no Approve, no Reject, no Try again,
// because none of them could ever work.

import { useEffect, useMemo, useState } from 'react'
import { Ban, Check, Minus, Plus, ShoppingBag, Trash2 } from 'lucide-react'
import { Button, Callout, Field, Modal, Textarea } from '@/components/ui'
import { useToastActions } from '@/hooks/useToasts'
import {
  useApproveQrRequest,
  useQrRequestPreview,
  useRejectQrRequest,
} from '@/hooks/queries/useQrOrderRequests'
import { useProducts } from '@/hooks/queries/useProducts'
import { toProductUom } from '@/lib/adapters'
import { describeShortage, type ShortageDescription, type ShortageUom } from '@/lib/qr/describeShortage'
import {
  isQrApiError,
  type QrOrderPreview,
  type QrOrderProblem,
  type QrPricedLine,
} from '@/services/supabase/qrService'
import { formatMoney, formatWhen, itemCountLabel } from '@/lib/qr/qrFormat'
import {
  QR_MAX_LINE_QUANTITY,
  clampQuantity,
  itemsToSend,
  lineKey,
  sameLines,
  toLineInputs,
  withQuantity,
  withoutLine,
} from '@/lib/qr/reviewLines'
import type { QrLineInput } from '@/services/supabase/qrService'
import type { QrOrderRequest, QrOrderRequestItem } from '@/types'

/** Wait this long after the last edit before re-pricing. */
export const PREVIEW_DEBOUNCE_MS = 400

const REJECT_MIN = 3
const REJECT_MAX = 500
const GENERIC_ERROR = 'Something went wrong. Please try again.'

export interface QrRequestReviewModalProps {
  requestId: string
  /** Defaults to true: the common use is `{id && <QrRequestReviewModal requestId={id} onClose=... />}`. */
  open?: boolean
  onClose: () => void
}

// ── pieces ──────────────────────────────────────────────────────────────────

/**
 * A quantity the approver can type into or step. Keeps its own text so clearing
 * the field to type a new number does not snap back to 1 mid-keystroke; the draft
 * only changes when the text is a valid whole number, and the field is restored
 * to the draft's value on blur.
 */
function QuantityStepper(props: {
  name: string
  value: number
  onChange: (next: number) => void
  /** An approval is in flight: the quantities being approved must not move under it. */
  disabled?: boolean
  /** Lets the modal hand focus to the field after a one-tap fix. */
  inputId?: string
}) {
  const { name, value, onChange, disabled = false, inputId } = props
  const atMin = value <= 1
  const atMax = value >= QR_MAX_LINE_QUANTITY
  const [text, setText] = useState(String(value))

  useEffect(() => {
    setText(String(value))
  }, [value])

  const commit = (raw: string) => {
    setText(raw)
    if (!/^\d+$/.test(raw)) return
    const n = Number(raw)
    if (n >= 1) onChange(clampQuantity(n))
  }

  return (
    <div className="inline-flex items-center gap-1">
      <button
        type="button"
        aria-label={`Decrease quantity of ${name}`}
        // aria-disabled, not disabled, at the limit: a button that disables itself while
        // it has focus drops focus to the page, which strands a keyboard user mid-edit.
        aria-disabled={atMin || undefined}
        disabled={disabled}
        onClick={() => {
          if (!atMin) onChange(clampQuantity(value - 1))
        }}
        className={`touch-target inline-flex items-center justify-center rounded-lg border border-stone-300 bg-white text-stone-700 hover:bg-stone-50 disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-nexgen-blue-dark ${atMin ? 'opacity-50 cursor-not-allowed' : ''}`}
      >
        <Minus className="w-4 h-4" aria-hidden="true" />
      </button>
      <input
        id={inputId}
        type="text"
        inputMode="numeric"
        aria-label={`Quantity of ${name}`}
        disabled={disabled}
        value={text}
        onChange={(e) => commit(e.target.value)}
        onBlur={() => setText(String(value))}
        className="touch-target-y w-14 rounded-lg border border-stone-300 bg-white px-1 py-1.5 text-center text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-nexgen-blue-dark focus:border-nexgen-blue"
      />
      <button
        type="button"
        aria-label={`Increase quantity of ${name}`}
        aria-disabled={atMax || undefined}
        disabled={disabled}
        onClick={() => {
          if (!atMax) onChange(clampQuantity(value + 1))
        }}
        className={`touch-target inline-flex items-center justify-center rounded-lg border border-stone-300 bg-white text-stone-700 hover:bg-stone-50 disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-nexgen-blue-dark ${atMax ? 'opacity-50 cursor-not-allowed' : ''}`}
      >
        <Plus className="w-4 h-4" aria-hidden="true" />
      </button>
    </div>
  )
}

const FIX_BUTTON_CLASS =
  'touch-target-y inline-flex shrink-0 items-center justify-center rounded-lg border border-stone-300 bg-white px-3 ' +
  'text-xs font-semibold text-stone-700 hover:bg-stone-50 btn-press ' +
  'disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-nexgen-blue-dark'

/** The one-tap answer to a shortage: lower the line to what fits, or drop it when nothing does. */
function ShortageFix(props: {
  name: string
  /** > 0: set the line to this. 0: remove it. */
  maxQty: number
  disabled: boolean
  onSetTo: (quantity: number) => void
  onRemove: () => void
}) {
  const { name, maxQty, disabled, onSetTo, onRemove } = props
  if (maxQty > 0) {
    return (
      <button
        type="button"
        // The visible words stay inside the name (WCAG 2.5.3); the product is added so a
        // list of several short lines is not a list of identical buttons.
        aria-label={`Set to ${maxQty} for ${name}`}
        disabled={disabled}
        onClick={() => onSetTo(maxQty)}
        className={FIX_BUTTON_CLASS}
      >
        {`Set to ${maxQty}`}
      </button>
    )
  }
  return (
    <button
      type="button"
      aria-label={`Remove line for ${name}`}
      disabled={disabled}
      onClick={onRemove}
      className={FIX_BUTTON_CLASS}
    >
      Remove line
    </button>
  )
}

function pricedLineFor(
  priced: ReadonlyArray<QrPricedLine>,
  line: QrLineInput,
  index: number,
): QrPricedLine | undefined {
  const byIndex = priced[index]
  if (byIndex && byIndex.productId === line.productId) return byIndex
  return priced.find((p) => lineKey(p) === lineKey(line))
}

function nameOf(items: ReadonlyArray<QrOrderRequestItem>, line: QrLineInput, priced?: QrPricedLine): string {
  if (priced?.productName) return priced.productName
  const stored = items.find((i) => lineKey(i) === lineKey(line))
  return stored?.productName ?? `Product #${line.productId}`
}

function skuOf(items: ReadonlyArray<QrOrderRequestItem>, line: QrLineInput, priced?: QrPricedLine): string {
  if (priced?.productSku) return priced.productSku
  return items.find((i) => lineKey(i) === lineKey(line))?.productSku ?? ''
}

function DeliveryDetails({ request }: { request: QrOrderRequest }) {
  const parts: string[] = []
  if (request.deliveryDate) parts.push(request.deliveryDate)
  if (request.deliveryTimeSlot) parts.push(request.deliveryTimeSlot)
  const address = request.deliveryAddress
  const addressLine = address
    ? [address.street, address.city, address.postcode].filter(Boolean).join(', ')
    : ''
  if (parts.length === 0 && !addressLine && !request.notes) return null
  return (
    <dl className="rounded-lg border border-stone-200 bg-stone-50/70 p-3 text-xs space-y-1">
      {parts.length > 0 && (
        <div className="flex gap-2">
          <dt className="w-16 shrink-0 font-semibold text-stone-600">Delivery</dt>
          <dd className="text-stone-700">{parts.join(' · ')}</dd>
        </div>
      )}
      {addressLine && (
        <div className="flex gap-2">
          <dt className="w-16 shrink-0 font-semibold text-stone-600">Address</dt>
          <dd className="text-stone-700">{addressLine}</dd>
        </div>
      )}
      {request.notes && (
        <div className="flex gap-2">
          <dt className="w-16 shrink-0 font-semibold text-stone-600">Notes</dt>
          <dd className="text-stone-700 whitespace-pre-wrap break-words">{request.notes}</dd>
        </div>
      )}
    </dl>
  )
}

function Totals({ preview, stale }: { preview: QrOrderPreview; stale: boolean }) {
  return (
    <div className="space-y-1.5" aria-busy={stale || undefined}>
      <dl className={`rounded-lg border border-stone-200 p-3 text-sm space-y-1 ${stale ? 'opacity-60' : ''}`}>
        <div className="flex justify-between">
          <dt className="text-stone-600">Subtotal</dt>
          <dd className="tabular-nums text-stone-800">{formatMoney(preview.subtotal)}</dd>
        </div>
        {preview.cartDiscount > 0 && (
          <div className="flex justify-between">
            <dt className="text-stone-600">Discount</dt>
            <dd className="tabular-nums text-emerald-700">-{formatMoney(preview.cartDiscount)}</dd>
          </div>
        )}
        <div className="flex justify-between border-t border-stone-100 pt-1 font-semibold">
          <dt className="text-stone-900">Total</dt>
          <dd className="tabular-nums text-stone-900">{formatMoney(preview.total)}</dd>
        </div>
      </dl>
      {preview.creditLimit > 0 && (
        <p className="text-xs text-stone-600">
          Credit limit {formatMoney(preview.creditLimit)} · outstanding {formatMoney(preview.outstanding)}
        </p>
      )}
    </div>
  )
}

// ── the modal ───────────────────────────────────────────────────────────────

export default function QrRequestReviewModal({ requestId, open = true, onClose }: QrRequestReviewModalProps) {
  const { addToast } = useToastActions()
  const approve = useApproveQrRequest()
  const reject = useRejectQrRequest()

  const [draft, setDraft] = useState<QrLineInput[] | null>(null)
  const [committed, setCommitted] = useState<QrLineInput[] | null>(null)
  const [rejecting, setRejecting] = useState(false)
  const [reason, setReason] = useState('')
  const [actionError, setActionError] = useState<string | null>(null)

  // The lines as the kitchen asked for them. Learned from the first preview, and
  // stable after: the stored items of a pending request never change.
  const [original, setOriginal] = useState<QrLineInput[] | null>(null)

  // Only an edited list is sent to the preview; an unedited one is "as requested".
  const previewItems = original && committed && !sameLines(original, committed) ? committed : undefined
  const emptyDraft = draft !== null && draft.length === 0

  const {
    data,
    error: loadError,
    isLoading,
    isFetching,
    refetch,
  } = useQrRequestPreview(requestId, previewItems, { enabled: open && !emptyDraft })

  // keepPreviousData holds the old request's answer across a change of id; never show it.
  const current = data && data.request.id === requestId ? data : null
  // The last request we read. A failed RE-pricing (a blip while the approver edits) leaves
  // `current` empty, and without this the whole editor -- and the draft behind it --
  // would vanish behind an error. The request itself has not changed.
  const [heldRequest, setHeldRequest] = useState<QrOrderRequest | null>(null)
  useEffect(() => {
    if (current) setHeldRequest(current.request)
  }, [current])
  const request = current?.request ?? (heldRequest && heldRequest.id === requestId ? heldRequest : null)
  const preview = current?.preview ?? null
  // The server answered "not yours" / "not there". Retrying cannot change that.
  const unavailable =
    !request && !isLoading && isQrApiError(loadError) && (loadError.code === 'FORBIDDEN' || loadError.code === 'NOT_FOUND')

  // Reset everything when the modal is pointed at a different request.
  useEffect(() => {
    setDraft(null)
    setCommitted(null)
    setOriginal(null)
    setRejecting(false)
    setReason('')
    setActionError(null)
  }, [requestId])

  useEffect(() => {
    if (!request || original) return
    const lines = toLineInputs(request.items)
    setOriginal(lines)
    setDraft(lines)
    setCommitted(lines)
  }, [request, original])

  // Debounce the draft into the query so a burst of edits is one preview.
  useEffect(() => {
    if (draft === null || committed === null || sameLines(draft, committed)) return
    const timer = setTimeout(() => setCommitted(draft), PREVIEW_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [draft, committed])

  const edited = Boolean(original && draft && !sameLines(original, draft))
  const settled = Boolean(draft && committed && sameLines(draft, committed)) && !isFetching
  const reasonTrimmed = reason.trim()
  const reasonOk = reasonTrimmed.length >= REJECT_MIN && reasonTrimmed.length <= REJECT_MAX
  // Nothing is left to discard once the request is decided.
  const decided = Boolean(current && !current.preview)
  const dirty = (edited || (rejecting && reasonTrimmed.length > 0)) && !decided
  const busy = approve.isPending || reject.isPending

  const problems = emptyDraft ? [] : (preview?.problems ?? [])

  // Each product's UOMs, for the name a line is counted in ("boxes"). Absent until the
  // catalogue has loaded, in which case the line's own pack size still gives the factor.
  const { data: productRows } = useProducts()
  const uomsByProduct = useMemo(() => {
    const out = new Map<number, ShortageUom[]>()
    for (const row of productRows ?? []) {
      if (row.product_uoms?.length) out.set(row.id, row.product_uoms.map(toProductUom))
    }
    return out
  }, [productRows])

  // Worked out from the preview's own priced lines, so it always describes the figures
  // the server sent (the draft may be a keystroke ahead of them).
  const shortages = useMemo(() => {
    const out = new Map<number, ShortageDescription>()
    if (!preview) return out
    for (const s of preview.stock) {
      if (!s.short) continue
      out.set(
        s.productId,
        describeShortage({
          productName: s.productName,
          available: s.available,
          requested: s.requested,
          lines: preview.lines.filter((l) => l.productId === s.productId),
          uoms: uomsByProduct.get(s.productId),
        }),
      )
    }
    return out
  }, [preview, uomsByProduct])
  const problemText = (p: QrOrderProblem): string =>
    p.code === 'INSUFFICIENT_STOCK' && p.productId != null
      ? (shortages.get(p.productId)?.headline ?? p.message)
      : p.message
  // Approve is offered only on figures that describe what is on screen: the server
  // said the CURRENT draft would place, and no newer preview is still in flight.
  const canApprove = Boolean(preview && preview.ok) && !emptyDraft && settled

  const handleFailure = (err: unknown) => {
    if (isQrApiError(err)) {
      // Someone decided it first, or it was placed but not marked: nothing left to do here.
      if (err.code === 'QR_REQUEST_CONFLICT' || err.orderId) {
        addToast(err.message, 'error')
        onClose()
        return
      }
      setActionError(err.message)
      return
    }
    setActionError(GENERIC_ERROR)
  }

  // The "Set to N" button disables itself the moment the draft moves ahead of the preview,
  // which would drop keyboard focus onto the page. The line's own field takes it instead.
  const setQuantityTo = (index: number, quantity: number) => {
    setDraft((d) => withQuantity(d ?? [], index, quantity))
    setTimeout(() => document.getElementById(`qr-qty-${index}`)?.focus(), 0)
  }

  const removeLine = (index: number) => {
    const remaining = lines.length - 1
    setDraft((d) => withoutLine(d ?? [], index))
    // The button that had focus is about to unmount. Hand focus to the line that takes
    // its place (or the heading when none is left) so a keyboard user is not dropped
    // onto the page behind the dialog.
    setTimeout(() => {
      const target =
        remaining > 0
          ? document.getElementById(`qr-remove-line-${Math.min(index, remaining - 1)}`)
          : document.getElementById('qr-items-heading')
      target?.focus()
    }, 0)
  }

  const onApprove = async () => {
    if (!original || !draft || busy) return
    setActionError(null)
    const items = itemsToSend(original, draft)
    try {
      const result = await approve.mutateAsync({ requestId, ...(items ? { items } : {}) })
      addToast(`Order ${result.orderId} placed`, 'success')
      onClose()
    } catch (err) {
      handleFailure(err)
    }
  }

  const onReject = async () => {
    if (!reasonOk || busy) return
    setActionError(null)
    try {
      await reject.mutateAsync({ requestId, reason: reasonTrimmed })
      addToast('Order request declined', 'success')
      onClose()
    } catch (err) {
      handleFailure(err)
    }
  }

  const items = request?.items ?? []
  const lines = draft ?? []
  const venue = preview?.hoReCa?.name ?? ''
  const requestedAt = request ? formatWhen(request.createdAt) : ''

  const description = useMemo(() => {
    if (!request) return undefined
    return [venue, request.staffName, requestedAt].filter(Boolean).join(' · ')
  }, [request, venue, requestedAt])

  // ── footer ────────────────────────────────────────────────────────────────
  const footer = ({ requestClose }: { requestClose: () => void }) => {
    if (decided || unavailable) {
      return <Button variant="secondary" onClick={requestClose}>Close</Button>
    }
    if (rejecting) {
      return (
        <div className="flex w-full flex-wrap justify-end gap-2">
          <Button variant="secondary" disabled={busy} onClick={() => { setRejecting(false); setActionError(null) }}>
            Back
          </Button>
          <Button variant="danger" loading={reject.isPending} disabled={!reasonOk} onClick={onReject}>
            Decline order
          </Button>
        </div>
      )
    }
    return (
      <div className="flex w-full flex-wrap justify-end gap-2">
        <Button variant="secondary" disabled={busy} onClick={requestClose}>Close</Button>
        <Button
          variant="secondary"
          icon={<Ban className="w-4 h-4" aria-hidden="true" />}
          disabled={busy || !request}
          onClick={() => { setRejecting(true); setActionError(null) }}
        >
          Reject
        </Button>
        <Button
          icon={<Check className="w-4 h-4" aria-hidden="true" />}
          loading={approve.isPending}
          disabled={!canApprove || busy}
          onClick={onApprove}
        >
          {edited ? 'Approve with changes' : 'Approve order'}
        </Button>
      </div>
    )
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="xl"
      title="Review order request"
      description={description}
      icon={<ShoppingBag className="w-4 h-4 text-nexgen-blue" aria-hidden="true" />}
      dirty={dirty}
      discardConfirm={{
        title: 'Discard your changes?',
        message: rejecting && !edited
          ? 'The reason you typed will be lost.'
          : 'Your edits to this order will be lost. The staff member’s original request stays as it was.',
      }}
      footer={footer}
    >
      <div className="space-y-4">
        {isLoading && (
          <p role="status" className="py-8 text-center text-sm text-stone-600">Loading order...</p>
        )}

        {unavailable && (
          <Callout tone="neutral" title="This order is not available to you">
            {isQrApiError(loadError) && loadError.code === 'NOT_FOUND'
              ? 'It no longer exists.'
              : 'It belongs to a venue you do not answer for.'}
          </Callout>
        )}

        {!isLoading && loadError && !request && !unavailable && (
          <Callout
            tone="danger"
            title="Could not load this order"
            action={<Button size="sm" variant="secondary" onClick={() => refetch()}>Try again</Button>}
          >
            {loadError.message}
          </Callout>
        )}

        {request && (
          <>
            {loadError && (
              <Callout
                tone="danger"
                title="Could not price the order"
                action={<Button size="sm" variant="secondary" onClick={() => refetch()}>Try again</Button>}
              >
                {loadError.message} Your changes are kept.
              </Callout>
            )}

            {decided && (
              <Callout tone={request.status === 'approved' ? 'success' : 'neutral'} title={decidedTitle(request)}>
                {decidedDetail(request)}
              </Callout>
            )}

            {!decided && request.status === 'approving' && (
              <Callout tone="warning" title="Someone is approving this order right now">
                If this does not clear in a couple of minutes, try again.
              </Callout>
            )}

            {!decided && request.lastError && (
              <Callout tone="warning" title="The last approval attempt failed">
                {request.lastError}
              </Callout>
            )}

            {!decided && problems.length > 0 && (
              <Callout tone="danger" title="This order cannot be approved yet">
                <ul className="list-disc pl-4 space-y-0.5">
                  {problems.map((p, i) => (
                    <li key={`${p.code}-${p.productId ?? 'order'}-${i}`}>{problemText(p)}</li>
                  ))}
                </ul>
                <p className="mt-1">Lower a quantity or remove the line, or reject the request.</p>
              </Callout>
            )}

            {actionError && (
              <div role="alert">
                <Callout tone="danger" title="Could not complete that">
                  {actionError}
                </Callout>
              </div>
            )}

            <section aria-label="Order lines">
              <div className="mb-2 flex items-baseline justify-between">
                <h3 id="qr-items-heading" tabIndex={-1} className="text-sm font-semibold text-stone-900 focus:outline-none">
                  Items
                </h3>
                <span className="text-xs text-stone-600">
                  {decided ? itemCountLabel(items.length) : itemCountLabel(lines.length)}
                </span>
              </div>

              {decided ? (
                <ul className="divide-y divide-stone-100 rounded-lg border border-stone-200">
                  {items.map((item, i) => (
                    <li key={`${lineKey(item)}-${i}`} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                      <span className="min-w-0 truncate text-stone-800">{item.productName ?? `Product #${item.productId}`}</span>
                      <span className="shrink-0 tabular-nums text-stone-700">x {item.quantity}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <ul className="divide-y divide-stone-100 rounded-lg border border-stone-200">
                  {lines.map((line, i) => {
                    const priced = pricedLineFor(preview?.lines ?? [], line, i)
                    const name = nameOf(items, line, priced)
                    const sku = skuOf(items, line, priced)
                    const stock = preview?.stock.find((s) => s.productId === line.productId)
                    const gone = problems.some((p) => p.code === 'PRODUCT_NOT_FOUND' && p.productId === line.productId)
                    const shortage = stock?.short ? shortages.get(line.productId) : undefined
                    // Two lines of one product: lowering one cannot say what the other should be.
                    const sole = lines.filter((l) => l.productId === line.productId).length === 1
                    return (
                      <li key={`${lineKey(line)}-${i}`} className="px-3 py-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-stone-900 break-words">{name}</p>
                            <p className="text-xs text-stone-600">
                              {[sku, priced ? `${formatMoney(priced.unitPrice)} each` : ''].filter(Boolean).join(' · ')}
                            </p>
                          </div>
                          <button
                            type="button"
                            id={`qr-remove-line-${i}`}
                            aria-label={`Remove ${name}`}
                            disabled={busy}
                            onClick={() => removeLine(i)}
                            className="touch-target inline-flex shrink-0 items-center justify-center rounded-lg text-stone-600 hover:bg-stone-100 hover:text-red-700 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-nexgen-blue-dark"
                          >
                            <Trash2 className="w-4 h-4" aria-hidden="true" />
                          </button>
                        </div>
                        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                          <QuantityStepper
                            name={name}
                            inputId={`qr-qty-${i}`}
                            value={line.quantity}
                            disabled={busy}
                            onChange={(n) => setDraft((d) => withQuantity(d ?? [], i, n))}
                          />
                          <span className={`text-sm font-semibold tabular-nums text-stone-900 ${settled ? '' : 'opacity-60'}`}>
                            {priced ? formatMoney(priced.lineTotal) : ''}
                          </span>
                        </div>
                        {gone && <p className="mt-1 text-xs font-medium text-red-700">No longer available</p>}
                        {!gone && shortage && (
                          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
                            <p className="text-xs font-medium text-amber-800">{shortage.lineNote}</p>
                            {sole && shortage.maxQty !== null && (
                              <ShortageFix
                                name={name}
                                maxQty={shortage.maxQty}
                                // Held while busy (like the stepper) and until the preview has caught
                                // up with the draft: its figures describe the lines BEFORE the edit.
                                disabled={busy || !settled}
                                onSetTo={(n) => setQuantityTo(i, n)}
                                onRemove={() => removeLine(i)}
                              />
                            )}
                          </div>
                        )}
                      </li>
                    )
                  })}
                </ul>
              )}

              {emptyDraft && (
                <p className="mt-2 text-xs text-stone-600">
                  Every line has been removed. Reject the request instead, or close this and reopen it to start again.
                </p>
              )}
            </section>

            {!decided && preview && !emptyDraft && <Totals preview={preview} stale={!settled} />}
            {!decided && !preview && !emptyDraft && !isLoading && !loadError && (
              <p role="status" className="text-xs text-stone-600">Pricing the order...</p>
            )}
            {decided && (
              <p className="text-xs text-stone-600">Estimated total at request: {formatMoney(request.quotedTotal)}</p>
            )}

            <DeliveryDetails request={request} />

            {rejecting && !decided && (
              <Field
                label={`Reason (shown to ${request.staffName || 'the requester'})`}
                htmlFor="qr-reject-reason"
                helper={`${reasonTrimmed.length}/${REJECT_MAX} - at least ${REJECT_MIN} characters`}
              >
                <Textarea
                  id="qr-reject-reason"
                  rows={3}
                  maxLength={REJECT_MAX}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="e.g. Please order this again after Friday's delivery"
                />
              </Field>
            )}
          </>
        )}
      </div>
    </Modal>
  )
}

function decidedTitle(request: QrOrderRequest): string {
  switch (request.status) {
    case 'approved':
      return request.approvedOrderId ? `Approved - order ${request.approvedOrderId}` : 'Approved'
    case 'rejected':
      return 'Declined'
    case 'cancelled':
      return 'Cancelled by staff'
    default:
      return 'Already handled'
  }
}

function decidedDetail(request: QrOrderRequest): string {
  if (request.status === 'rejected') {
    return request.decisionReason ? `Reason: ${request.decisionReason}` : 'No reason was given.'
  }
  if (request.status === 'approved' && request.editedByApprover) return 'Approved with changes.'
  return 'Nothing more to do.'
}
