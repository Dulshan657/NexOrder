// Key an order in on behalf of a customer.
//
// ── WHY THIS EXISTS BESIDE THE SHOP ────────────────────────────────────────
//
// The Shop is self-service ordering: a catalogue browse, a cart, a pantry and a
// signature at checkout. A distributor whose office staff take orders by phone
// and email needs none of that — so `shop` is its own module and this is what a
// tenant without it uses. Amadiya is the first.
//
// ── WHAT IT IS (NX-0048) ───────────────────────────────────────────────────
//
// Keyboard-first entry (SKU, Enter, quantity, Enter), lines in any of the
// product's units, a stock check that blocks placement, the customer's history
// one click away, and a shared draft saved as the order is typed. Desktop is
// two panes; on a phone the summary becomes a bottom bar and history a sheet.
//
// Prices are shown, never entered — `place-order` prices every line
// server-side and persists its own total. Lines are SENT in their chosen unit
// (`uomId`), which place-order already understands and prices as the Shop does.

import React, { useEffect, useMemo, useRef, useState } from 'react'
import { ClipboardPaste, FileText, History } from 'lucide-react'

import { Button, ConfirmDialog, Field, Input, Modal, Sheet, Textarea } from '../ui'
import { PageFrame } from '../ui/PageFrame'
import { PageHeader } from '../ui/PageHeader'
import { ADMIN_TAB_LABELS } from '../../lib/adminTabUrl'
import HoReCaSearchDropdown from '../HoReCaSearchDropdown'
import OrderLinesGrid, { lineKey } from './newOrder/OrderLinesGrid'
import QuickAddRow from './newOrder/QuickAddRow'
import CsvPastePanel from './newOrder/CsvPastePanel'
import CustomerHistoryPanel from './newOrder/CustomerHistoryPanel'
import DraftsList from './newOrder/DraftsList'
import PlaceOrderBar from './newOrder/PlaceOrderBar'
import SaveStatusBadge from './newOrder/SaveStatusBadge'
import { useNewOrderState } from './newOrder/useNewOrderState'
import { usePlaceOrder } from '../../hooks/queries/useOrders'
import { useDeleteOrderDraft, useOrderDrafts } from '../../hooks/queries/useOrderDrafts'
import { isValidQuantity, overStockByProduct, toPlaceOrderItems, type DraftLine } from '../../lib/newOrder/orderLineModel'
import { priceLines } from '../../lib/newOrder/previewPricing'
import type { OrderDraft } from '../../lib/newOrder/orderDraft'
import { MAX_DRAFT_NOTES } from '../../supabase/functions/_shared/orderDraftPayload'
import type { HoReCa, Order, Product, Promotion, User } from '../../types'

interface NewOrderViewProps {
  products: Product[]
  hoReCas: HoReCa[]
  /** Every order the user can see; the customer's history is drawn from it. */
  orders?: Order[]
  currentUser: User
  /** Live promotions, so the preview prices the way `place-order` will. */
  promotions?: Promotion[]
  addToast?: (message: string, type: 'success' | 'error' | 'info') => void
  /** Jump to Order Import with the new order highlighted. */
  onViewInOrderImport?: (orderId: string) => void
}

function blockedReasonFor(
  hoReCaId: number | null,
  lines: DraftLine[],
  overStockCount: number,
): string | null {
  if (hoReCaId === null) return 'Choose a customer.'
  if (lines.length === 0) return 'Add at least one line.'
  if (lines.some((l) => !isValidQuantity(l.quantity))) return 'Every line needs a whole-number quantity of at least 1.'
  if (overStockCount > 0) return 'Some lines ask for more than is in stock.'
  return null
}

export default function NewOrderView({
  products,
  hoReCas,
  orders = [],
  currentUser,
  promotions = [],
  addToast,
  onViewInOrderImport,
}: NewOrderViewProps) {
  const order = useNewOrderState({ onNotice: (message) => addToast?.(message, 'info') })
  const placeOrder = usePlaceOrder()
  const { data: drafts = [], refetch: refetchDrafts } = useOrderDrafts()
  const deleteDraft = useDeleteOrderDraft()

  const [submitError, setSubmitError] = useState<string | null>(null)
  const [pasteOpen, setPasteOpen] = useState(false)
  const [draftsOpen, setDraftsOpen] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [confirmClear, setConfirmClear] = useState(false)
  // A draft waiting to be opened over an order whose last edit could not be saved.
  const [pendingOpen, setPendingOpen] = useState<OrderDraft | null>(null)

  const quickAddRef = useRef<HTMLInputElement | null>(null)
  const qtyInputs = useRef(new Map<string, HTMLInputElement>())
  const [focusKey, setFocusKey] = useState<string | null>(null)

  const orderable = useMemo(() => products.filter((p) => p.isActive !== false), [products])
  const customer = useMemo(() => hoReCas.find((h) => h.id === order.hoReCaId) ?? null, [hoReCas, order.hoReCaId])
  const overStock = useMemo(() => overStockByProduct(order.lines, products), [order.lines, products])
  const { total } = priceLines(order.lines, products, customer, currentUser, promotions)
  const blockedReason = blockedReasonFor(order.hoReCaId, order.lines, overStock.size)

  // Move focus into the line just added, once it has rendered.
  useEffect(() => {
    if (focusKey === null) return
    const el = qtyInputs.current.get(focusKey)
    if (el) {
      el.focus()
      el.select()
    }
    setFocusKey(null)
  }, [focusKey, order.lines])

  const addLines = (lines: DraftLine[], skipped = 0) => {
    setSubmitError(null)
    if (lines.length > 0) order.addLines(lines)
    if (skipped > 0) {
      addToast?.(`${skipped} line${skipped === 1 ? ' was' : 's were'} skipped — no longer orderable.`, 'info')
    }
  }

  const addProduct = (productId: number) => {
    const line: DraftLine = { productId, uomId: null, quantity: 1 }
    addLines([line])
    setFocusKey(lineKey(line))
  }

  const showDraft = (draft: OrderDraft) => {
    order.loadDraft(draft)
    setSubmitError(null)
    setPendingOpen(null)
    setDraftsOpen(false)
  }

  // Save what is on screen first; only an edit that could not be saved needs asking about.
  const openDraft = async (draft: OrderDraft) => {
    const { saved } = await order.flush()
    if (saved) showDraft(draft)
    else setPendingOpen(draft)
  }

  const openDraftsList = () => {
    setDraftsOpen(true)
    void refetchDrafts()
  }

  const removeDraft = async (draft: OrderDraft) => {
    try {
      await deleteDraft.mutateAsync(draft.id)
      addToast?.('Draft deleted.', 'success')
    } catch (error: unknown) {
      addToast?.(error instanceof Error ? error.message : 'The draft could not be deleted.', 'error')
    }
  }

  const clear = async () => {
    setConfirmClear(false)
    const id = order.draftId
    order.reset()
    setSubmitError(null)
    if (id) await removeDraft({ id } as OrderDraft)
  }

  const submit = async () => {
    if (blockedReason !== null || order.hoReCaId === null || placeOrder.isPending) return
    setSubmitError(null)
    try {
      // Save any pending edit first, so the draft this order is spending is known
      // — otherwise a first save still in flight would survive as a copy of a
      // placed order in everyone's Drafts list.
      const { draftId } = await order.flush()
      const result = await placeOrder.mutateAsync({
        hoReCaId: order.hoReCaId,
        items: toPlaceOrderItems(order.lines),
        notes: order.notes.trim() === '' ? null : order.notes.trim(),
        deliveryDate: order.deliveryDate === '' ? null : order.deliveryDate,
        draftId,
      })
      addToast?.(`Order placed for ${customer?.name ?? 'customer'}.`, 'success')
      order.reset()
      onViewInOrderImport?.(result.orderId)
    } catch (error: unknown) {
      // Shown in place as well as toasted: a stock or credit refusal is
      // something the operator has to act on, and a toast is gone in seconds.
      const message = error instanceof Error ? error.message : 'The order could not be placed.'
      setSubmitError(message)
      addToast?.(message, 'error')
    }
  }

  const history = (
    <CustomerHistoryPanel
      orders={orders}
      hoReCaId={order.hoReCaId}
      products={orderable}
      onAddLines={(lines, skipped) => {
        addLines(lines, skipped)
        setHistoryOpen(false)
      }}
    />
  )

  const placeBar = (compact: boolean) => (
    <PlaceOrderBar
      total={total}
      lineCount={order.lines.length}
      blockedReason={blockedReason}
      placing={placeOrder.isPending}
      onPlace={submit}
      compact={compact}
    />
  )

  return (
    <PageFrame>
      <PageHeader
        title={ADMIN_TAB_LABELS['New Order']}
        description="Key an order in for a customer and send it to the warehouse to pick."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <SaveStatusBadge status={order.saveStatus} error={order.saveError} />
            <Button type="button" variant="secondary" size="sm" onClick={openDraftsList}>
              <FileText className="w-4 h-4 mr-1.5" aria-hidden="true" /> Drafts ({drafts.length})
            </Button>
            <Button type="button" variant="secondary" size="sm" onClick={() => setPasteOpen(true)}>
              <ClipboardPaste className="w-4 h-4 mr-1.5" aria-hidden="true" /> Import from paste
            </Button>
          </div>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem] xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="min-w-0 space-y-4">
          {/* relative z-20: glass-panel's backdrop blur makes this section a stacking
              context, so without a z-index the customer dropdown opens UNDER the
              quick-add bar and lines that follow it. */}
          <section aria-label="Customer and delivery" className="glass-panel relative z-20 rounded-xl p-4 sm:p-5">
            <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_12rem]">
              <Field label="Customer">
                <HoReCaSearchDropdown
                  hoReCas={hoReCas}
                  selectedHoReCaId={order.hoReCaId}
                  onSelectHoReCa={order.setCustomer}
                  currentUser={currentUser}
                />
              </Field>
              <Field label="Delivery date">
                <Input
                  type="date"
                  value={order.deliveryDate}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => order.setDeliveryDate(e.target.value)}
                />
              </Field>
            </div>
            <div className="mt-4">
              <Field label="Notes" helper="Printed on the pick slip.">
                <Textarea
                  value={order.notes}
                  rows={2}
                  maxLength={MAX_DRAFT_NOTES}
                  onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => order.setNotes(e.target.value)}
                  placeholder="Delivery instructions, purchase order reference, anything the picker needs."
                />
              </Field>
            </div>
          </section>

          <section aria-label="Order lines" className="space-y-3">
            <QuickAddRow products={orderable} onAdd={addProduct} inputRef={quickAddRef} />
            <OrderLinesGrid
              lines={order.lines}
              products={products}
              customer={customer}
              currentUser={currentUser}
              promotions={promotions}
              overStock={overStock}
              onChangeQuantity={(i, q) => {
                setSubmitError(null)
                order.setQuantity(i, q)
              }}
              onChangeUnit={order.setUnit}
              onRemove={order.removeLine}
              registerQuantityInput={(key, el) => {
                if (el) qtyInputs.current.set(key, el)
                else qtyInputs.current.delete(key)
              }}
              onQuantityEnter={() => quickAddRef.current?.focus()}
            />
          </section>

          {submitError && (
            <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
              {submitError}
            </p>
          )}

          {/* Below lg the Nex Assistant button floats over the bottom-right corner,
              right above the bottom bar; the extra padding lets Clear scroll clear of it. */}
          <div className="flex justify-end pb-28 lg:pb-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => (order.draftId ? setConfirmClear(true) : clear())}
              disabled={placeOrder.isPending}
            >
              Clear
            </Button>
          </div>
        </div>

        <aside aria-label="Order summary" className="hidden lg:block">
          <div className="sticky top-4 space-y-4">
            <div className="glass-panel rounded-xl p-5">{placeBar(false)}</div>
            <div className="glass-panel rounded-xl p-5">{history}</div>
          </div>
        </aside>
      </div>

      {/* Mobile: the summary is a bar pinned to the bottom of the scroller. */}
      <div className="lg:hidden sticky bottom-0 z-20 -mx-4 mt-4 border-t border-stone-200 bg-white/95 px-4 py-3 backdrop-blur">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setHistoryOpen(true)}
            aria-label="Customer history"
            className="touch-target shrink-0 rounded-lg border border-stone-200 p-2 text-stone-700 hover:bg-stone-100 btn-press"
          >
            <History className="w-5 h-5" />
          </button>
          <div className="min-w-0 flex-1">{placeBar(true)}</div>
        </div>
      </div>

      <Sheet open={historyOpen} onClose={() => setHistoryOpen(false)} title="Customer history" mobile="bottom">
        {history}
      </Sheet>

      <Modal
        open={pasteOpen}
        onClose={() => setPasteOpen(false)}
        title="Import from paste"
        icon={<ClipboardPaste className="w-5 h-5" />}
        size="lg"
      >
        <CsvPastePanel
          products={orderable}
          onAdd={(parsed, remaining) => {
            addLines(parsed.map((l) => ({ productId: l.productId, uomId: null, quantity: l.quantity })))
            if (remaining === 0) setPasteOpen(false)
          }}
        />
      </Modal>

      <DraftsList
        open={draftsOpen}
        onClose={() => setDraftsOpen(false)}
        drafts={drafts}
        hoReCas={hoReCas}
        currentDraftId={order.draftId}
        onOpen={openDraft}
        onDelete={removeDraft}
      />

      <ConfirmDialog
        open={pendingOpen !== null}
        title="Discard unsaved changes?"
        message={`The order on screen has changes that could not be saved${order.saveError ? ` (${order.saveError})` : ''}. Opening another draft discards them.`}
        confirmLabel="Discard and open"
        tone="danger"
        onConfirm={() => pendingOpen && showDraft(pendingOpen)}
        onCancel={() => setPendingOpen(null)}
      />

      <ConfirmDialog
        open={confirmClear}
        title="Discard this draft?"
        message="The order on screen is cleared and its saved draft is deleted for everyone."
        confirmLabel="Discard"
        tone="danger"
        onConfirm={clear}
        onCancel={() => setConfirmClear(false)}
      />
    </PageFrame>
  )
}
