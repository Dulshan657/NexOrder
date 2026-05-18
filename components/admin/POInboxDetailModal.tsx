// POInboxDetailModal — side-by-side review of one inbound PO.
//
// Left pane:  original document (PDF / image / text), fetched through
//             create-po-document-url (signed URL, 15-min TTL).
// Right pane: editable form bound to the AI-extracted values. Operator
//             can correct the customer, swap products per line, adjust
//             quantities, set delivery date, add notes.
// Footer:     Approve (mode='human') or Reject (requires reason).
//
// Aliases write themselves on Approve via approve-po's diff logic, so
// nothing extra needs to happen here for the learning loop.

import React, { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, CheckCircle2, FileText, Loader2, X } from 'lucide-react'
import {
  useApprovePo,
  usePendingPoDetail,
  useRejectPo,
} from '@/hooks/queries/usePendingPos'
import { useProducts } from '@/hooks/queries/useProducts'
import { getPoDocumentUrl } from '@/services/supabase/poInboxService'
import { confidenceBadgeStyle, statusBadge } from './poInboxFormat'
import type {
  ExtractedPoLine,
  MatchedItem,
  PendingPoDetailRow,
} from '@/services/supabase/poInboxService'
import type { HoReCa, Product } from '../../types'

interface POInboxDetailModalProps {
  pendingPoId: string
  hoReCas: HoReCa[]
  onClose: () => void
  addToast?: (message: string, type: 'success' | 'error' | 'info') => void
}

type DeliveryTimeSlot = 'Morning (8am-12pm)' | 'Afternoon (12pm-4pm)' | 'Evening (4pm-8pm)'

interface EditableLine {
  po_line_index: number
  productId: number | null
  quantity: number
  packSize: number | null
  rawCode: string | null
  rawDescription: string | null
  rawQuantity: number
  rawUom: string | null
}

const POInboxDetailModal: React.FC<POInboxDetailModalProps> = ({
  pendingPoId,
  hoReCas,
  onClose,
  addToast,
}) => {
  const detailQuery = usePendingPoDetail(pendingPoId)
  const approveMutation = useApprovePo()
  const rejectMutation = useRejectPo()

  // Edit form state — initialized from the loaded row.
  const [horecaId, setHorecaId] = useState<number | null>(null)
  const [lines, setLines] = useState<EditableLine[]>([])
  const [deliveryDate, setDeliveryDate] = useState<string>('')
  const [deliveryTimeSlot, setDeliveryTimeSlot] = useState<DeliveryTimeSlot | ''>('')
  const [notes, setNotes] = useState<string>('')
  const [rejectionReason, setRejectionReason] = useState<string>('')
  const [showRejectForm, setShowRejectForm] = useState(false)

  const [docUrl, setDocUrl] = useState<string | null>(null)
  const [docError, setDocError] = useState<string | null>(null)

  const productsQuery = useProducts()
  const products: Product[] = productsQuery.data ?? []

  useEffect(() => {
    if (!detailQuery.data) return
    initFormFromRow(detailQuery.data, {
      setHorecaId,
      setLines,
      setDeliveryDate,
      setDeliveryTimeSlot,
      setNotes,
    })
  }, [detailQuery.data])

  // Fetch document signed URL once we know which kind of document to show.
  useEffect(() => {
    if (!detailQuery.data) return
    const format = detailQuery.data.extracted_po.source?.format ?? 'text'
    // Text-body POs have no attachment to render. Skip the signed-URL
    // fetch and let DocumentPane show an explanatory message.
    if (format === 'text' || !detailQuery.data.extracted_po.source?.original_filename) {
      setDocUrl(null)
      setDocError(null)
      return
    }
    let cancelled = false
    getPoDocumentUrl({
      pendingPoId: detailQuery.data.id,
      kind: 'attachment',
      attachmentIndex: 0,
    })
      .then(r => {
        if (!cancelled) setDocUrl(r.signedUrl)
      })
      .catch(err => {
        if (!cancelled) setDocError(err instanceof Error ? err.message : String(err))
      })
    return () => {
      cancelled = true
    }
  }, [detailQuery.data])

  const productById = useMemo(() => {
    const m = new Map<number, Product>()
    for (const p of products) m.set(p.id, p)
    return m
  }, [products])

  const allLinesResolved = lines.every(l => l.productId != null)
  const allQuantitiesPositive = lines.every(l => Number.isFinite(l.quantity) && l.quantity > 0)
  const canApprove =
    horecaId != null
    && lines.length > 0
    && allLinesResolved
    && allQuantitiesPositive
    && !approveMutation.isPending
  const detail = detailQuery.data

  const handleApprove = async () => {
    if (!detail) return
    try {
      const result = await approveMutation.mutateAsync({
        pendingPoId,
        overrides: {
          horecaId: horecaId ?? undefined,
          items: lines.map(l => ({
            po_line_index: l.po_line_index,
            product_id: l.productId as number,
            quantity: l.quantity,
            pack_size: l.packSize ?? null,
          })),
          notes: notes.trim() || null,
          deliveryDate: deliveryDate || null,
          deliveryTimeSlot: deliveryTimeSlot || null,
        },
      })
      const orderRef = result.orderId ?? '(no order id)'
      addToast?.(`PO approved — order ${orderRef} created.`, 'success')
      onClose()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      addToast?.(`Approve failed: ${msg}`, 'error')
    }
  }

  const handleReject = async () => {
    const reason = rejectionReason.trim()
    if (reason.length < 3) {
      addToast?.('Rejection reason must be at least 3 characters.', 'error')
      return
    }
    try {
      await rejectMutation.mutateAsync({ pendingPoId, rejectionReason: reason })
      addToast?.('PO rejected.', 'info')
      onClose()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      addToast?.(`Reject failed: ${msg}`, 'error')
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-stretch justify-center bg-stone-900/60 p-3"
      role="dialog"
      aria-modal="true"
      aria-labelledby={DIALOG_TITLE_ID}
      tabIndex={-1}
      onClick={onClose}
      onKeyDown={e => {
        if (e.key === 'Escape') onClose()
      }}
    >
      <div
        className="relative w-full max-w-6xl bg-white rounded-2xl shadow-2xl overflow-hidden flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        <Header detail={detail} onClose={onClose} />

        {detailQuery.isLoading || !detail ? (
          <div className="flex-1 flex items-center justify-center text-stone-500">
            <Loader2 className="w-5 h-5 mr-2 animate-spin" />
            Loading PO…
          </div>
        ) : (
          <div className="flex-1 grid grid-cols-1 md:grid-cols-2 overflow-hidden">
            <DocumentPane url={docUrl} error={docError} detail={detail} />
            <FormPane
              detail={detail}
              hoReCas={hoReCas}
              products={products}
              productById={productById}
              horecaId={horecaId}
              setHorecaId={setHorecaId}
              lines={lines}
              setLines={setLines}
              deliveryDate={deliveryDate}
              setDeliveryDate={setDeliveryDate}
              deliveryTimeSlot={deliveryTimeSlot}
              setDeliveryTimeSlot={setDeliveryTimeSlot}
              notes={notes}
              setNotes={setNotes}
            />
          </div>
        )}

        <Footer
          detail={detail}
          canApprove={canApprove}
          approving={approveMutation.isPending}
          rejecting={rejectMutation.isPending}
          showRejectForm={showRejectForm}
          rejectionReason={rejectionReason}
          setShowRejectForm={setShowRejectForm}
          setRejectionReason={setRejectionReason}
          onApprove={handleApprove}
          onReject={handleReject}
        />
      </div>
    </div>
  )
}

interface InitArgs {
  setHorecaId: (v: number | null) => void
  setLines: (v: EditableLine[]) => void
  setDeliveryDate: (v: string) => void
  setDeliveryTimeSlot: (v: DeliveryTimeSlot | '') => void
  setNotes: (v: string) => void
}

function initFormFromRow(detail: PendingPoDetailRow, args: InitArgs): void {
  args.setHorecaId(detail.matched_horeca_id)
  args.setLines(buildEditableLines(detail.extracted_po.lines ?? [], detail.matched_items))
  args.setDeliveryDate(detail.extracted_po.requested_date ?? '')
  args.setDeliveryTimeSlot('')
  args.setNotes('')
}

export function buildEditableLines(
  extractedLines: ExtractedPoLine[],
  matched: MatchedItem[],
): EditableLine[] {
  const matchByIndex = new Map<number, MatchedItem>()
  for (const m of matched) matchByIndex.set(m.po_line_index, m)
  return extractedLines.map((line, idx) => {
    const match = matchByIndex.get(idx)
    return {
      po_line_index: idx,
      productId: match?.product_id ?? null,
      quantity: match?.quantity ?? line.quantity,
      packSize: match?.pack_size ?? line.pack_size_raw ?? null,
      rawCode: line.item_code_raw,
      rawDescription: line.description_raw,
      rawQuantity: line.quantity,
      rawUom: line.uom,
    }
  })
}

const DIALOG_TITLE_ID = 'po-inbox-dialog-title'

const Header: React.FC<{ detail: PendingPoDetailRow | undefined; onClose: () => void }> = ({
  detail,
  onClose,
}) => (
  <div className="flex items-center justify-between gap-3 px-4 sm:px-6 py-3 border-b border-stone-200 bg-stone-50">
    <div className="min-w-0">
      <div className="flex items-center gap-2 flex-wrap">
        <h2 id={DIALOG_TITLE_ID} className="font-display font-semibold text-stone-900 truncate">
          {detail?.subject || 'Inbound PO'}
        </h2>
        {detail && (
          <>
            <span
              className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${statusBadge(detail.status).className}`}
            >
              {statusBadge(detail.status).label}
            </span>
            <span
              className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${confidenceBadgeStyle(detail.confidence_overall)}`}
            >
              {(detail.confidence_overall * 100).toFixed(0)}% confidence
            </span>
          </>
        )}
      </div>
      {detail && (
        <p className="text-xs text-stone-500 mt-0.5 truncate">
          From {detail.from_address} · PO {detail.extracted_po.po_number ?? '(no number)'}
        </p>
      )}
    </div>
    <button
      type="button"
      onClick={onClose}
      className="p-1.5 rounded-lg hover:bg-stone-200 text-stone-700"
      aria-label="Close"
    >
      <X className="w-5 h-5" />
    </button>
  </div>
)

interface DocumentPaneProps {
  url: string | null
  error: string | null
  detail: PendingPoDetailRow
}

const DocumentPane: React.FC<DocumentPaneProps> = ({ url, error, detail }) => {
  const format = detail.extracted_po.source?.format ?? 'text'
  const isTextBody = format === 'text' || !detail.extracted_po.source?.original_filename

  return (
    <div className="bg-stone-100 border-b md:border-b-0 md:border-r border-stone-200 flex flex-col">
      <div className="px-3 py-2 text-xs text-stone-500 border-b border-stone-200 bg-white flex items-center gap-2">
        <FileText className="w-3 h-3" />
        Original ({format.toUpperCase()})
      </div>
      <div className="flex-1 overflow-auto">
        {isTextBody ? (
          <div className="p-6 text-sm text-stone-600">
            This PO was extracted from the email body — there is no attachment to display.
            The fields on the right reflect what the AI parsed from the body text.
          </div>
        ) : error ? (
          <div className="p-6 text-sm text-rose-700 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4" /> {error}
          </div>
        ) : !url ? (
          <div className="p-6 flex items-center justify-center text-stone-500">
            <Loader2 className="w-4 h-4 mr-2 animate-spin" /> Loading document…
          </div>
        ) : format === 'pdf' ? (
          // sandbox="allow-same-origin" is the minimum required for the
          // browser's built-in PDF viewer to render. Scripts, forms,
          // popups, and top-navigation are all blocked. The signed URL
          // points at content that originated from an inbound email,
          // which we MUST treat as attacker-controlled.
          <iframe
            src={url}
            title="PO document"
            sandbox="allow-same-origin"
            referrerPolicy="no-referrer"
            className="w-full h-full min-h-[60vh] bg-white"
          />
        ) : format === 'image' ? (
          <img
            src={url}
            alt="PO document"
            referrerPolicy="no-referrer"
            className="w-full h-auto bg-white"
          />
        ) : (
          // DOCX / other — no scripts at all.
          <iframe
            src={url}
            title="PO document"
            sandbox=""
            referrerPolicy="no-referrer"
            className="w-full h-full min-h-[60vh] bg-white"
          />
        )}
      </div>
    </div>
  )
}

interface FormPaneProps {
  detail: PendingPoDetailRow
  hoReCas: HoReCa[]
  products: Product[]
  productById: Map<number, Product>
  horecaId: number | null
  setHorecaId: (v: number | null) => void
  lines: EditableLine[]
  setLines: (v: EditableLine[]) => void
  deliveryDate: string
  setDeliveryDate: (v: string) => void
  deliveryTimeSlot: DeliveryTimeSlot | ''
  setDeliveryTimeSlot: (v: DeliveryTimeSlot | '') => void
  notes: string
  setNotes: (v: string) => void
}

const FormPane: React.FC<FormPaneProps> = props => {
  const updateLine = (idx: number, patch: Partial<EditableLine>): void => {
    const next = props.lines.map((l, i) => (i === idx ? { ...l, ...patch } : l))
    props.setLines(next)
  }

  const readOnly = props.detail.status !== 'needs_review'

  return (
    <div className="flex flex-col overflow-auto">
      <div className="p-4 sm:p-5 space-y-4">
        <div>
          <label className="block text-xs font-medium text-stone-600 mb-1">Customer</label>
          <select
            value={props.horecaId ?? ''}
            onChange={e => props.setHorecaId(e.target.value ? Number(e.target.value) : null)}
            disabled={readOnly}
            className="w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm disabled:bg-stone-100"
          >
            <option value="">— pick customer —</option>
            {props.hoReCas.map(h => (
              <option key={h.id} value={h.id}>
                {h.name}
              </option>
            ))}
          </select>
          {props.detail.extracted_po.customer_name_raw && (
            <p className="mt-1 text-xs text-stone-500">
              Extracted as: <em>{props.detail.extracted_po.customer_name_raw}</em>
            </p>
          )}
        </div>

        <fieldset>
          <legend className="text-xs font-medium text-stone-600 mb-1">Line items</legend>
          <ul className="space-y-2">
            {props.lines.map((line, idx) => (
              <li
                key={line.po_line_index}
                className="rounded-lg border border-stone-200 bg-stone-50 p-3 space-y-2"
              >
                <div className="text-[11px] text-stone-500">
                  <span className="font-mono">{line.rawCode ?? '(no code)'}</span> ·{' '}
                  {line.rawDescription ?? '(no description)'}
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  <label className="col-span-2 sm:col-span-2 text-xs">
                    <span className="block text-stone-600 mb-0.5">Product</span>
                    <select
                      value={line.productId ?? ''}
                      onChange={e =>
                        updateLine(idx, { productId: e.target.value ? Number(e.target.value) : null })
                      }
                      disabled={readOnly}
                      className="w-full rounded border border-stone-300 bg-white px-2 py-1.5 text-sm disabled:bg-stone-100"
                    >
                      <option value="">— pick product —</option>
                      {props.products.map(p => (
                        <option key={p.id} value={p.id}>
                          {p.sku} · {p.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="text-xs">
                    <span className="block text-stone-600 mb-0.5">Qty</span>
                    <input
                      type="number"
                      min={1}
                      value={line.quantity}
                      onChange={e => {
                        const raw = Number(e.target.value)
                        // Clamp to at least 1 — a 0-qty line would create
                        // a useless order row and fails the canApprove guard.
                        const next = Number.isFinite(raw) && raw >= 1 ? Math.floor(raw) : 1
                        updateLine(idx, { quantity: next })
                      }}
                      disabled={readOnly}
                      className="w-full rounded border border-stone-300 bg-white px-2 py-1.5 text-sm disabled:bg-stone-100"
                    />
                  </label>
                  <label className="text-xs">
                    <span className="block text-stone-600 mb-0.5">Pack size</span>
                    <input
                      type="number"
                      min={1}
                      value={line.packSize ?? ''}
                      onChange={e =>
                        updateLine(idx, {
                          packSize: e.target.value ? Number(e.target.value) : null,
                        })
                      }
                      disabled={readOnly}
                      placeholder={line.productId ? String(props.productById.get(line.productId)?.cartonSize ?? '') : '—'}
                      className="w-full rounded border border-stone-300 bg-white px-2 py-1.5 text-sm disabled:bg-stone-100"
                    />
                  </label>
                </div>
              </li>
            ))}
          </ul>
        </fieldset>

        <div className="grid grid-cols-2 gap-3">
          <label className="text-xs">
            <span className="block text-stone-600 mb-0.5">Delivery date</span>
            <input
              type="date"
              value={props.deliveryDate}
              onChange={e => props.setDeliveryDate(e.target.value)}
              disabled={readOnly}
              className="w-full rounded border border-stone-300 bg-white px-2 py-1.5 text-sm disabled:bg-stone-100"
            />
          </label>
          <label className="text-xs">
            <span className="block text-stone-600 mb-0.5">Time slot</span>
            <select
              value={props.deliveryTimeSlot}
              onChange={e => props.setDeliveryTimeSlot(e.target.value as DeliveryTimeSlot | '')}
              disabled={readOnly}
              className="w-full rounded border border-stone-300 bg-white px-2 py-1.5 text-sm disabled:bg-stone-100"
            >
              <option value="">—</option>
              <option value="Morning (8am-12pm)">Morning (8am-12pm)</option>
              <option value="Afternoon (12pm-4pm)">Afternoon (12pm-4pm)</option>
              <option value="Evening (4pm-8pm)">Evening (4pm-8pm)</option>
            </select>
          </label>
        </div>

        <label className="block text-xs">
          <span className="block text-stone-600 mb-0.5">Notes (admin-internal)</span>
          <textarea
            value={props.notes}
            onChange={e => props.setNotes(e.target.value)}
            disabled={readOnly}
            rows={2}
            className="w-full rounded border border-stone-300 bg-white px-2 py-1.5 text-sm disabled:bg-stone-100"
          />
        </label>
      </div>
    </div>
  )
}

interface FooterProps {
  detail: PendingPoDetailRow | undefined
  canApprove: boolean
  approving: boolean
  rejecting: boolean
  showRejectForm: boolean
  rejectionReason: string
  setShowRejectForm: (v: boolean) => void
  setRejectionReason: (v: string) => void
  onApprove: () => void
  onReject: () => void
}

const Footer: React.FC<FooterProps> = props => {
  if (!props.detail) return null
  const isResolved = props.detail.status !== 'needs_review'

  if (isResolved) {
    return (
      <div className="px-4 sm:px-6 py-3 border-t border-stone-200 bg-stone-50 text-xs text-stone-500 flex items-center gap-2">
        {props.detail.status === 'rejected' ? (
          <span>
            Rejected{props.detail.reviewed_at ? ` ${new Date(props.detail.reviewed_at).toLocaleString()}` : ''}
            {props.detail.rejection_reason ? ` — ${props.detail.rejection_reason}` : ''}
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 text-emerald-700">
            <CheckCircle2 className="w-3 h-3" /> Order {props.detail.approved_order_id ?? '(unknown)'} created
          </span>
        )}
      </div>
    )
  }

  return (
    <div className="px-4 sm:px-6 py-3 border-t border-stone-200 bg-stone-50 space-y-2">
      {props.showRejectForm && (
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={props.rejectionReason}
            onChange={e => props.setRejectionReason(e.target.value)}
            placeholder="Reason for rejection (≥3 chars)"
            className="flex-1 rounded border border-stone-300 bg-white px-2 py-1.5 text-sm"
            maxLength={500}
          />
          <button
            type="button"
            onClick={props.onReject}
            disabled={props.rejecting || props.rejectionReason.trim().length < 3}
            className="rounded-lg bg-rose-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-rose-500 disabled:opacity-60 btn-press"
          >
            {props.rejecting ? 'Rejecting…' : 'Confirm reject'}
          </button>
        </div>
      )}
      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={() => props.setShowRejectForm(!props.showRejectForm)}
          className="rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-sm font-medium text-rose-700 hover:bg-rose-50 btn-press"
        >
          Reject
        </button>
        <button
          type="button"
          onClick={props.onApprove}
          disabled={!props.canApprove}
          className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-60 btn-press"
          title={
            props.canApprove
              ? 'Create a real order from this PO'
              : 'Pick a customer and a product for every line first'
          }
        >
          {props.approving ? 'Approving…' : 'Approve & create order'}
        </button>
      </div>
    </div>
  )
}

export default POInboxDetailModal
