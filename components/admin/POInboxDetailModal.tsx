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
import {
  AlertTriangle,
  CheckCircle2,
  FileText,
  Loader2,
  MapPin,
  Plus,
  Trash2,
  X,
} from 'lucide-react'
import {
  useApprovePo,
  usePendingPoDetail,
  useRejectPo,
} from '@/hooks/queries/usePendingPos'
import { useProducts } from '@/hooks/queries/useProducts'
import { useHorecaAddresses } from '@/hooks/queries/useHorecaAddresses'
import { getPoDocumentUrl } from '@/services/supabase/poInboxService'
import type { ApproveDeliveryAddress } from '@/services/supabase/poInboxService'
import { confidenceBadgeStyle, statusBadge } from './poInboxFormat'
import ProductSearchDropdown from './ProductSearchDropdown'
import type {
  ExtractedPoLine,
  MatchedItem,
  PendingPoDetailRow,
} from '@/services/supabase/poInboxService'
import type { HorecaAddressRow } from '@/services/supabase/horecaAddressService'
import type { HoReCa, Product } from '../../types'

interface POInboxDetailModalProps {
  pendingPoId: string
  hoReCas: HoReCa[]
  onClose: () => void
  addToast?: (message: string, type: 'success' | 'error' | 'info') => void
}

type DeliveryTimeSlot = 'Morning (8am-12pm)' | 'Afternoon (12pm-4pm)' | 'Evening (4pm-8pm)'

interface EditableLine {
  /** Index in the original extracted_po.lines array. null for operator-added lines. */
  po_line_index: number | null
  productId: number | null
  quantity: number
  packSize: number | null
  rawCode: string | null
  rawDescription: string | null
  rawQuantity: number
  rawUom: string | null
  /** Per-line confidence from extract-po's matched_items (only set for AI lines). */
  confidence: number | null
}

interface NewAddressForm {
  street: string
  city: string
  postcode: string
  country: string
  recipient_name: string
}

const EMPTY_ADDRESS_FORM: NewAddressForm = {
  street: '',
  city: '',
  postcode: '',
  country: '',
  recipient_name: '',
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

  // Delivery address state. addressMode='saved' uses selectedAddressId
  // (from horeca_addresses); addressMode='new' uses newAddress; on Approve
  // we shape an ApproveDeliveryAddress out of whichever is active.
  const [addressMode, setAddressMode] = useState<'saved' | 'new'>('saved')
  const [selectedAddressId, setSelectedAddressId] = useState<string | null>(null)
  const [newAddress, setNewAddress] = useState<NewAddressForm>(EMPTY_ADDRESS_FORM)
  const [saveToBook, setSaveToBook] = useState<boolean>(true)

  const [docUrl, setDocUrl] = useState<string | null>(null)
  const [docError, setDocError] = useState<string | null>(null)
  const [bodyText, setBodyText] = useState<string | null>(null)
  const [bodyHtml, setBodyHtml] = useState<string | null>(null)
  const [bodyLoading, setBodyLoading] = useState(false)

  const productsQuery = useProducts()
  const products: Product[] = productsQuery.data ?? []

  // Address book for the currently-selected HoReCa. Refetches when the
  // operator switches HoReCa via the customer picker.
  const addressesQuery = useHorecaAddresses(horecaId)
  const addresses: HorecaAddressRow[] = addressesQuery.data ?? []

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

  // Seed the address picker when the HoReCa's saved addresses load.
  // Default to the HoReCa's is_default=true row when present; otherwise
  // the first listed address. Operator can switch via the picker. We do
  // NOT clobber a selection the user has explicitly made — keyed on the
  // current selection being empty.
  useEffect(() => {
    if (addressMode !== 'saved') return
    if (selectedAddressId !== null) return
    if (addresses.length === 0) return
    const def = addresses.find(a => a.is_default) ?? addresses[0]
    setSelectedAddressId(def.id)
  }, [addresses, addressMode, selectedAddressId])

  // Switching HoReCa wipes the picked address — addresses belong to one
  // HoReCa, so a stale selection from the previous customer is wrong.
  useEffect(() => {
    setSelectedAddressId(null)
    setAddressMode('saved')
    setNewAddress(EMPTY_ADDRESS_FORM)
    setSaveToBook(true)
  }, [horecaId])

  // Fetch document signed URL once we know which kind of document to show.
  // Text-body POs: fetch original.json (the parsed envelope) and surface
  //   bodyText / bodyHtml so the operator can read the source email.
  // Attachment POs: fetch the binary attachment as a signed URL for an
  //   iframe / img preview.
  useEffect(() => {
    if (!detailQuery.data) return
    const format = detailQuery.data.extracted_po.source?.format ?? 'text'
    const isTextBody = format === 'text' || !detailQuery.data.extracted_po.source?.original_filename
    let cancelled = false

    if (isTextBody) {
      setBodyLoading(true)
      setDocError(null)
      setBodyText(null)
      setBodyHtml(null)
      getPoDocumentUrl({ pendingPoId: detailQuery.data.id, kind: 'original' })
        .then(async r => {
          const resp = await fetch(r.signedUrl)
          if (!resp.ok) throw new Error(`fetch envelope: ${resp.status}`)
          // original.json is the parsed envelope: { bodyText, bodyHtml, ... }
          const envelope = (await resp.json()) as {
            bodyText?: string | null
            bodyHtml?: string | null
          }
          if (cancelled) return
          setBodyText(envelope.bodyText ?? null)
          setBodyHtml(envelope.bodyHtml ?? null)
        })
        .catch(err => {
          if (!cancelled) setDocError(err instanceof Error ? err.message : String(err))
        })
        .finally(() => {
          if (!cancelled) setBodyLoading(false)
        })
      return () => {
        cancelled = true
      }
    }

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
  const addressOk =
    addressMode === 'saved'
      ? selectedAddressId != null
      : newAddress.street.trim().length > 0
  const canApprove =
    horecaId != null
    && lines.length > 0
    && allLinesResolved
    && allQuantitiesPositive
    && addressOk
    && !approveMutation.isPending
  const detail = detailQuery.data

  const handleApprove = async () => {
    if (!detail) return
    // Build the delivery-address override. Saved-mode passes the picked
    // address row's id; new-mode passes the form fields plus the
    // save-to-book preference.
    let deliveryAddress: ApproveDeliveryAddress | null = null
    if (addressMode === 'saved' && selectedAddressId) {
      deliveryAddress = { source_address_id: selectedAddressId }
    } else if (addressMode === 'new') {
      const street = newAddress.street.trim()
      if (street) {
        deliveryAddress = {
          street,
          city: newAddress.city.trim() || null,
          postcode: newAddress.postcode.trim() || null,
          country: newAddress.country.trim() || null,
          recipient_name: newAddress.recipient_name.trim() || null,
          save_to_horeca_address_book: saveToBook,
        }
      }
    }

    try {
      const result = await approveMutation.mutateAsync({
        pendingPoId,
        overrides: {
          horecaId: horecaId ?? undefined,
          lines: lines.map(l => ({
            po_line_index: l.po_line_index,
            product_id: l.productId as number,
            quantity: l.quantity,
            pack_size: l.packSize ?? null,
          })),
          notes: notes.trim() || null,
          deliveryDate: deliveryDate || null,
          deliveryTimeSlot: deliveryTimeSlot || null,
          deliveryAddress,
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

  const addLine = () => {
    setLines([
      ...lines,
      {
        po_line_index: null,
        productId: null,
        quantity: 1,
        packSize: null,
        rawCode: null,
        rawDescription: null,
        rawQuantity: 1,
        rawUom: null,
        confidence: null,
      },
    ])
  }

  const removeLine = (idx: number) => {
    setLines(lines.filter((_, i) => i !== idx))
  }

  const useExtractedAddress = () => {
    const shipTo = detail?.extracted_po.ship_to
    if (!shipTo) return
    setAddressMode('new')
    setNewAddress({
      street: shipTo.street ?? '',
      city: shipTo.city ?? '',
      postcode: '',
      country: '',
      recipient_name: shipTo.name ?? '',
    })
    setSaveToBook(true)
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
            <DocumentPane
              url={docUrl}
              error={docError}
              detail={detail}
              bodyText={bodyText}
              bodyHtml={bodyHtml}
              bodyLoading={bodyLoading}
            />
            <FormPane
              detail={detail}
              hoReCas={hoReCas}
              products={products}
              productById={productById}
              horecaId={horecaId}
              setHorecaId={setHorecaId}
              lines={lines}
              setLines={setLines}
              onAddLine={addLine}
              onRemoveLine={removeLine}
              deliveryDate={deliveryDate}
              setDeliveryDate={setDeliveryDate}
              deliveryTimeSlot={deliveryTimeSlot}
              setDeliveryTimeSlot={setDeliveryTimeSlot}
              notes={notes}
              setNotes={setNotes}
              addresses={addresses}
              addressesLoading={addressesQuery.isLoading}
              addressMode={addressMode}
              setAddressMode={setAddressMode}
              selectedAddressId={selectedAddressId}
              setSelectedAddressId={setSelectedAddressId}
              newAddress={newAddress}
              setNewAddress={setNewAddress}
              saveToBook={saveToBook}
              setSaveToBook={setSaveToBook}
              useExtractedAddress={useExtractedAddress}
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
      confidence: typeof match?.confidence === 'number' ? match.confidence : null,
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
  bodyText: string | null
  bodyHtml: string | null
  bodyLoading: boolean
}

const DocumentPane: React.FC<DocumentPaneProps> = ({
  url,
  error,
  detail,
  bodyText,
  bodyHtml,
  bodyLoading,
}) => {
  const format = detail.extracted_po.source?.format ?? 'text'
  const isTextBody = format === 'text' || !detail.extracted_po.source?.original_filename
  const hasAnyBody = (bodyText && bodyText.trim().length > 0) || (bodyHtml && bodyHtml.trim().length > 0)

  return (
    <div className="bg-stone-100 border-b md:border-b-0 md:border-r border-stone-200 flex flex-col">
      <div className="px-3 py-2 text-xs text-stone-500 border-b border-stone-200 bg-white flex items-center gap-2">
        <FileText className="w-3 h-3" />
        Original ({isTextBody ? 'EMAIL BODY' : format.toUpperCase()})
      </div>
      <div className="flex-1 overflow-auto">
        {isTextBody ? (
          bodyLoading ? (
            <div className="p-6 flex items-center justify-center text-stone-500">
              <Loader2 className="w-4 h-4 mr-2 animate-spin" /> Loading email…
            </div>
          ) : error ? (
            <div className="p-6 text-sm text-rose-700 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4" /> {error}
            </div>
          ) : !hasAnyBody ? (
            <div className="p-6 text-sm text-stone-600">
              This PO was extracted from the email body, but no body text or HTML was found
              in the archived envelope. The fields on the right reflect what the AI parsed.
            </div>
          ) : bodyText && bodyText.trim().length > 0 ? (
            <pre className="p-6 text-sm text-stone-800 whitespace-pre-wrap break-words font-sans">
              {bodyText}
            </pre>
          ) : (
            // HTML-only emails: render inside a fully-locked iframe via
            // srcDoc — content originated from an inbound email and MUST
            // be treated as attacker-controlled. sandbox="" disables
            // scripts, forms, popups, same-origin, and top-navigation.
            <iframe
              srcDoc={bodyHtml ?? ''}
              title="PO email body"
              sandbox=""
              referrerPolicy="no-referrer"
              className="w-full h-full min-h-[60vh] bg-white"
            />
          )
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
  onAddLine: () => void
  onRemoveLine: (idx: number) => void
  deliveryDate: string
  setDeliveryDate: (v: string) => void
  deliveryTimeSlot: DeliveryTimeSlot | ''
  setDeliveryTimeSlot: (v: DeliveryTimeSlot | '') => void
  notes: string
  setNotes: (v: string) => void
  addresses: HorecaAddressRow[]
  addressesLoading: boolean
  addressMode: 'saved' | 'new'
  setAddressMode: (v: 'saved' | 'new') => void
  selectedAddressId: string | null
  setSelectedAddressId: (v: string | null) => void
  newAddress: NewAddressForm
  setNewAddress: (v: NewAddressForm) => void
  saveToBook: boolean
  setSaveToBook: (v: boolean) => void
  useExtractedAddress: () => void
}

const FormPane: React.FC<FormPaneProps> = props => {
  const updateLine = (idx: number, patch: Partial<EditableLine>): void => {
    const next = props.lines.map((l, i) => (i === idx ? { ...l, ...patch } : l))
    props.setLines(next)
  }

  const readOnly = props.detail.status !== 'needs_review'

  // Per-field confidence from extract-po (Record<string, unknown> on the
  // row — narrow with a helper before reading).
  const perField: Record<string, unknown> =
    (props.detail.confidence_fields as { per_field?: Record<string, unknown> })?.per_field ?? {}
  const customerMatch =
    (props.detail.confidence_fields as { customer_match?: string })?.customer_match ?? null

  const extractedPo = props.detail.extracted_po

  return (
    <div className="flex flex-col overflow-auto">
      <div className="p-4 sm:p-5 space-y-4">
        {/* PO header chips — surface fields buried in the JSONB */}
        <POHeaderChips
          poNumber={extractedPo.po_number}
          orderDate={extractedPo.order_date}
          requestedDate={extractedPo.requested_date}
        />

        {/* Customer */}
        <div>
          <div className="flex items-baseline justify-between mb-1">
            <label className="block text-xs font-medium text-stone-600">Customer</label>
            <ConfidenceDot value={readConfidence(perField, 'customer_name_raw')} />
          </div>
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
          <CustomerMatchHint
            matchSource={customerMatch}
            extractedName={extractedPo.customer_name_raw}
            picked={props.horecaId != null}
          />
        </div>

        {/* Delivery date + slot */}
        <div className="grid grid-cols-2 gap-3">
          <label className="text-xs">
            <span className="block text-stone-600 mb-0.5 flex items-center gap-1.5">
              Delivery date
              <ConfidenceDot value={readConfidence(perField, 'requested_date')} />
            </span>
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

        {/* Delivery address — book + new-address form */}
        <DeliveryAddressBlock {...props} readOnly={readOnly} perField={perField} />

        {/* Line items — picker, qty, pack, confidence, delete */}
        <fieldset>
          <legend className="text-xs font-medium text-stone-600 mb-1 flex items-center gap-2">
            <span>Line items</span>
            <span className="text-stone-400 font-normal">({props.lines.length})</span>
          </legend>
          <ul className="space-y-2">
            {props.lines.map((line, idx) => (
              <li
                key={`${idx}-${line.po_line_index ?? 'new'}`}
                className="rounded-lg border border-stone-200 bg-stone-50 p-3 space-y-2"
              >
                <div className="flex items-center justify-between gap-2 text-[11px]">
                  <div className="text-stone-500 truncate min-w-0">
                    {line.po_line_index === null ? (
                      <span className="text-stone-400 italic">(operator-added line)</span>
                    ) : (
                      <>
                        <span className="font-mono">{line.rawCode ?? '(no code)'}</span> ·{' '}
                        {line.rawDescription ?? '(no description)'}
                      </>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    <LineConfidenceBadge value={line.confidence} />
                    {!readOnly && (
                      <button
                        type="button"
                        onClick={() => props.onRemoveLine(idx)}
                        className="p-1 rounded text-stone-400 hover:text-rose-600 hover:bg-rose-50"
                        aria-label="Remove line"
                        title="Remove line"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  <div className="col-span-2 sm:col-span-2 text-xs">
                    <span className="block text-stone-600 mb-0.5">Product</span>
                    <ProductSearchDropdown
                      products={props.products}
                      selectedProductId={line.productId}
                      onSelect={pid => updateLine(idx, { productId: pid })}
                      disabled={readOnly}
                    />
                  </div>
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
          {!readOnly && (
            <button
              type="button"
              onClick={props.onAddLine}
              className="mt-2 w-full flex items-center justify-center gap-1.5 rounded-lg border border-dashed border-stone-300 bg-white px-3 py-2 text-xs text-stone-600 hover:border-nexgen-blue hover:text-nexgen-blue transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              Add line
            </button>
          )}
        </fieldset>

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

function readConfidence(perField: Record<string, unknown>, key: string): number | null {
  const v = perField[key]
  if (typeof v === 'number' && Number.isFinite(v)) return v
  return null
}

// ---------------------------------------------------------------------------
// Supporting subcomponents for the rebuilt right pane
// ---------------------------------------------------------------------------

const POHeaderChips: React.FC<{
  poNumber: string | null
  orderDate: string | null
  requestedDate: string | null
}> = ({ poNumber, orderDate, requestedDate }) => {
  const Chip: React.FC<{ label: string; value: string | null }> = ({ label, value }) => (
    <div className="flex flex-col rounded-lg border border-stone-200 bg-stone-50 px-2.5 py-1.5">
      <span className="text-[10px] uppercase tracking-wide text-stone-500">{label}</span>
      <span className="text-xs font-medium text-stone-800 truncate">
        {value && value.trim().length > 0 ? value : <span className="text-stone-400 italic">—</span>}
      </span>
    </div>
  )
  return (
    <div className="grid grid-cols-3 gap-2">
      <Chip label="PO #" value={poNumber} />
      <Chip label="Order date" value={orderDate} />
      <Chip label="Requested" value={requestedDate} />
    </div>
  )
}

/** Subtle confidence dot rendered next to a label. Hovering shows the
 *  full score so the operator can decide how much to trust the AI on
 *  this field. */
const ConfidenceDot: React.FC<{ value: number | null }> = ({ value }) => {
  if (value == null) return null
  const tone =
    value < 0.5 ? 'bg-rose-400' : value < 0.85 ? 'bg-amber-400' : 'bg-emerald-400'
  return (
    <span
      className={`inline-block w-2 h-2 rounded-full ${tone}`}
      title={`AI confidence ${(value * 100).toFixed(0)}%`}
      aria-label={`AI confidence ${(value * 100).toFixed(0)}%`}
    />
  )
}

const LineConfidenceBadge: React.FC<{ value: number | null }> = ({ value }) => {
  if (value == null) return null
  const pct = Math.round(value * 100)
  const cls =
    value < 0.5
      ? 'bg-rose-50 border-rose-200 text-rose-700'
      : value < 0.85
        ? 'bg-amber-50 border-amber-200 text-amber-700'
        : 'bg-emerald-50 border-emerald-200 text-emerald-700'
  return (
    <span
      className={`inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${cls}`}
      title={`Per-line AI confidence`}
    >
      {pct}%
    </span>
  )
}

const CustomerMatchHint: React.FC<{
  matchSource: string | null
  extractedName: string | null
  picked: boolean
}> = ({ matchSource, extractedName, picked }) => {
  let label = ''
  if (matchSource === 'sender_email_alias') label = 'Auto-matched via sender_email alias'
  else if (matchSource === 'sender_domain_alias') label = 'Auto-matched via sender_domain alias'
  else if (matchSource === 'po_text_alias') label = 'Auto-matched via PO-text alias'
  else if (matchSource === 'horeca_contact_email') label = "Auto-matched via HoReCa's contact_email"
  else if (matchSource === 'ai_fuzzy_match') label = 'Auto-matched via AI fuzzy name'

  return (
    <div className="mt-1 space-y-0.5">
      {label && (
        <p className="text-[11px] text-emerald-700">
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-500 mr-1.5 align-middle" />
          {label}
        </p>
      )}
      {!picked && matchSource == null && (
        <p className="text-[11px] text-amber-700">
          <AlertTriangle className="inline-block w-3 h-3 mr-1 align-middle" />
          No HoReCa matched this sender — pick one above, or{' '}
          <a
            href="/admin?tab=horeca"
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-amber-900"
          >
            create a new HoReCa →
          </a>
        </p>
      )}
      {extractedName && (
        <p className="text-[11px] text-stone-500">
          Extracted as: <em>{extractedName}</em>
        </p>
      )}
    </div>
  )
}

/** The delivery-address block. Two modes: pick from the HoReCa's saved
 *  address book, or enter a new address. New addresses default to
 *  is_default=false and are appended to the book unless the operator
 *  unticks "Save to address book". Either way, the HoReCa's existing
 *  default is never modified. */
const DeliveryAddressBlock: React.FC<FormPaneProps & { readOnly: boolean; perField: Record<string, unknown> }> = (
  props,
) => {
  const {
    addresses,
    addressesLoading,
    addressMode,
    setAddressMode,
    selectedAddressId,
    setSelectedAddressId,
    newAddress,
    setNewAddress,
    saveToBook,
    setSaveToBook,
    horecaId,
    useExtractedAddress,
    detail,
    readOnly,
    perField,
  } = props

  const extractedShipTo = detail.extracted_po.ship_to
  const extractedLine = extractedShipTo
    ? [extractedShipTo.name, extractedShipTo.street, extractedShipTo.city]
        .filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
        .join(', ')
    : null

  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between">
        <span className="text-xs font-medium text-stone-600 inline-flex items-center gap-1.5">
          <MapPin className="w-3 h-3" /> Delivery address
          <ConfidenceDot value={readConfidence(perField, 'ship_to')} />
        </span>
        {!readOnly && (
          <div className="flex gap-1 text-[11px]">
            <button
              type="button"
              onClick={() => setAddressMode('saved')}
              className={`px-2 py-0.5 rounded ${
                addressMode === 'saved'
                  ? 'bg-nexgen-blue/10 text-nexgen-blue font-medium'
                  : 'text-stone-500 hover:bg-stone-100'
              }`}
            >
              Saved
            </button>
            <button
              type="button"
              onClick={() => setAddressMode('new')}
              className={`px-2 py-0.5 rounded ${
                addressMode === 'new'
                  ? 'bg-nexgen-blue/10 text-nexgen-blue font-medium'
                  : 'text-stone-500 hover:bg-stone-100'
              }`}
            >
              New
            </button>
          </div>
        )}
      </div>

      {horecaId == null ? (
        <p className="text-[11px] text-stone-500 italic px-2.5 py-2 rounded border border-dashed border-stone-200">
          Pick a customer above to choose a delivery address.
        </p>
      ) : addressMode === 'saved' ? (
        addressesLoading ? (
          <p className="text-[11px] text-stone-500 px-2.5 py-2">
            <Loader2 className="inline-block w-3 h-3 mr-1 animate-spin align-middle" />
            Loading saved addresses…
          </p>
        ) : addresses.length === 0 ? (
          <div className="rounded border border-stone-200 bg-stone-50 px-2.5 py-2 text-xs text-stone-600">
            No saved addresses for this HoReCa. Switch to <em>New</em> to enter one.
          </div>
        ) : (
          <div className="space-y-1.5">
            <select
              value={selectedAddressId ?? ''}
              onChange={e => setSelectedAddressId(e.target.value || null)}
              disabled={readOnly}
              className="w-full rounded border border-stone-300 bg-white px-2 py-1.5 text-sm disabled:bg-stone-100"
            >
              <option value="">— pick a saved address —</option>
              {addresses.map(a => (
                <option key={a.id} value={a.id}>
                  {a.is_default ? '★ ' : ''}
                  {a.label ? `${a.label} — ` : ''}
                  {[a.street, a.city, a.postcode].filter(Boolean).join(', ')}
                </option>
              ))}
            </select>
            {selectedAddressId && (
              <AddressPreview address={addresses.find(a => a.id === selectedAddressId) ?? null} />
            )}
          </div>
        )
      ) : (
        <div className="rounded border border-stone-200 bg-stone-50 p-2.5 space-y-2">
          <input
            type="text"
            placeholder="Street *"
            value={newAddress.street}
            onChange={e => setNewAddress({ ...newAddress, street: e.target.value })}
            disabled={readOnly}
            className="w-full rounded border border-stone-300 bg-white px-2 py-1.5 text-sm disabled:bg-stone-100"
          />
          <div className="grid grid-cols-2 gap-2">
            <input
              type="text"
              placeholder="City"
              value={newAddress.city}
              onChange={e => setNewAddress({ ...newAddress, city: e.target.value })}
              disabled={readOnly}
              className="w-full rounded border border-stone-300 bg-white px-2 py-1.5 text-sm disabled:bg-stone-100"
            />
            <input
              type="text"
              placeholder="Postcode"
              value={newAddress.postcode}
              onChange={e => setNewAddress({ ...newAddress, postcode: e.target.value })}
              disabled={readOnly}
              className="w-full rounded border border-stone-300 bg-white px-2 py-1.5 text-sm disabled:bg-stone-100"
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <input
              type="text"
              placeholder="Country"
              value={newAddress.country}
              onChange={e => setNewAddress({ ...newAddress, country: e.target.value })}
              disabled={readOnly}
              className="w-full rounded border border-stone-300 bg-white px-2 py-1.5 text-sm disabled:bg-stone-100"
            />
            <input
              type="text"
              placeholder="Recipient name"
              value={newAddress.recipient_name}
              onChange={e => setNewAddress({ ...newAddress, recipient_name: e.target.value })}
              disabled={readOnly}
              className="w-full rounded border border-stone-300 bg-white px-2 py-1.5 text-sm disabled:bg-stone-100"
            />
          </div>
          <label className="flex items-center gap-2 text-[11px] text-stone-600 cursor-pointer">
            <input
              type="checkbox"
              checked={saveToBook}
              onChange={e => setSaveToBook(e.target.checked)}
              disabled={readOnly}
              className="rounded border-stone-300"
            />
            Save to this HoReCa's address book (won't change their default)
          </label>
        </div>
      )}

      {extractedLine && !readOnly && (
        <button
          type="button"
          onClick={useExtractedAddress}
          className="text-[11px] text-stone-500 hover:text-nexgen-blue text-left"
          title="Click to fill the New-address form with what the email said"
        >
          Email said: <em>"{extractedLine}"</em>
          <span className="ml-1 underline">use this →</span>
        </button>
      )}
    </div>
  )
}

const AddressPreview: React.FC<{ address: HorecaAddressRow | null }> = ({ address }) => {
  if (!address) return null
  const parts = [
    address.recipient_name,
    address.street,
    [address.city, address.postcode].filter(Boolean).join(' '),
    address.country,
  ].filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
  return (
    <div className="rounded border border-stone-200 bg-white px-2.5 py-2 text-xs text-stone-800">
      <address className="not-italic leading-snug">
        {parts.map((line, i) => (
          <div key={i}>{line}</div>
        ))}
      </address>
    </div>
  )
}

interface ShipToSummaryProps {
  detail: PendingPoDetailRow
}

// Read-only display of the ship-to block the AI parsed from the email.
// The actual delivery address used on the created order is owned by the
// matched HoReCa record — this surface lets the operator sanity-check
// that the email's address matches the HoReCa they selected.
const ShipToSummary: React.FC<ShipToSummaryProps> = ({ detail }) => {
  const shipTo = detail.extracted_po.ship_to ?? null
  const lines = shipTo
    ? [shipTo.name, shipTo.street, shipTo.city].filter(
        (v): v is string => typeof v === 'string' && v.trim().length > 0,
      )
    : []
  return (
    <div className="text-xs">
      <span className="block text-stone-600 mb-0.5">Delivery address (from email)</span>
      <div className="rounded border border-stone-200 bg-stone-50 px-2.5 py-2 text-stone-800">
        {lines.length === 0 ? (
          <span className="text-stone-500 italic">Not provided in the email body.</span>
        ) : (
          <address className="not-italic leading-snug">
            {lines.map((line, i) => (
              <div key={i}>{line}</div>
            ))}
          </address>
        )}
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
