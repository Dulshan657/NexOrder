// Key an order in on behalf of a customer.
//
// ── WHY THIS EXISTS BESIDE THE SHOP ────────────────────────────────────────
//
// The Shop is self-service ordering: a catalogue browse, a cart, promotions, a
// pantry and a signature at checkout. A distributor whose office staff take
// orders by phone and email needs none of that and should not have to meet it
// — so `shop` is its own module (see config/environments.mjs) and this is what
// a tenant without it uses. Amadiya is the first.
//
// It is deliberately the smallest thing that produces a real order: a customer,
// some lines, a delivery date, a note. No cart state, no promotion resolution,
// no bundles, no UOM picker. Prices are shown, never entered — `place-order`
// prices every line server-side and persists its own total, so anything typed
// here would be a number the operator trusts and the order does not carry.

import React, { useMemo, useState } from 'react'
import { FilePlus, Loader2, ShoppingCart } from 'lucide-react'

import { Button, Field, Input, Textarea } from '../ui'
import HoReCaSearchDropdown from '../HoReCaSearchDropdown'
import OrderLinesGrid from './newOrder/OrderLinesGrid'
import CsvPastePanel from './newOrder/CsvPastePanel'
import { usePlaceOrder } from '../../hooks/queries/useOrders'
import type { ParsedOrderLine } from '../../lib/newOrder/resolveOrderLines'
import type { HoReCa, Product, User } from '../../types'

interface NewOrderViewProps {
  products: Product[]
  hoReCas: HoReCa[]
  currentUser: User
  addToast?: (message: string, type: 'success' | 'error' | 'info') => void
  /** Jump to Order Import with the new order highlighted. */
  onViewInOrderImport?: (orderId: string) => void
}

const NewOrderView: React.FC<NewOrderViewProps> = ({
  products,
  hoReCas,
  currentUser,
  addToast,
  onViewInOrderImport,
}) => {
  const [hoReCaId, setHoReCaId] = useState<number | null>(null)
  const [lines, setLines] = useState<ParsedOrderLine[]>([])
  const [deliveryDate, setDeliveryDate] = useState('')
  const [notes, setNotes] = useState('')
  const [submitError, setSubmitError] = useState<string | null>(null)

  const placeOrder = usePlaceOrder()

  const customer = useMemo(
    () => hoReCas.find((h) => h.id === hoReCaId) ?? null,
    [hoReCas, hoReCaId],
  )
  const orderable = useMemo(() => products.filter((p) => p.isActive !== false), [products])

  const addLines = (incoming: ParsedOrderLine[]) => {
    setLines((current) => {
      // Merge rather than append: the same product arriving twice is one line
      // of the total, exactly as `resolveOrderLines` treats a repeated SKU.
      const next = current.map((l) => ({ ...l }))
      for (const line of incoming) {
        const existing = next.find((l) => l.productId === line.productId)
        if (existing) existing.quantity += line.quantity
        else next.push({ ...line })
      }
      return next
    })
  }

  const addProduct = (productId: number) => {
    const product = products.find((p) => p.id === productId)
    if (!product) return
    addLines([{ productId, sku: product.sku, name: product.name, quantity: 1 }])
  }

  const setQuantity = (productId: number, quantity: number) => {
    // A cleared box is mid-edit, not zero. Hold the row and let the submit
    // guard below refuse it while it is still not a quantity.
    setLines((current) =>
      current.map((l) => (l.productId === productId ? { ...l, quantity } : l)),
    )
  }

  const removeLine = (productId: number) => {
    setLines((current) => current.filter((l) => l.productId !== productId))
  }

  const invalidQuantity = lines.some((l) => !Number.isInteger(l.quantity) || l.quantity < 1)
  const canSubmit = hoReCaId !== null && lines.length > 0 && !invalidQuantity && !placeOrder.isPending

  const reset = () => {
    setHoReCaId(null)
    setLines([])
    setDeliveryDate('')
    setNotes('')
    setSubmitError(null)
  }

  const submit = async () => {
    if (!canSubmit || hoReCaId === null) return
    setSubmitError(null)
    try {
      const result = await placeOrder.mutateAsync({
        hoReCaId,
        items: lines.map((l) => ({ productId: l.productId, quantity: l.quantity })),
        notes: notes.trim() === '' ? null : notes.trim(),
        deliveryDate: deliveryDate === '' ? null : deliveryDate,
      })
      addToast?.(`Order placed for ${customer?.name ?? 'customer'}.`, 'success')
      reset()
      onViewInOrderImport?.(result.orderId)
    } catch (error: unknown) {
      // Shown in place as well as toasted: a rate limit or a stock refusal is
      // something the operator has to act on, and a toast is gone in seconds.
      const message = error instanceof Error ? error.message : 'The order could not be placed.'
      setSubmitError(message)
      addToast?.(message, 'error')
    }
  }

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <header className="flex items-center gap-3">
        <div className="p-2 rounded-lg bg-nexgen-blue/10 text-nexgen-blue">
          <FilePlus className="w-5 h-5" />
        </div>
        <div>
          <h1 className="text-xl font-semibold text-stone-900">New Order</h1>
          <p className="text-sm text-stone-500">
            Key an order in for a customer. It goes to the warehouse to be picked.
          </p>
        </div>
      </header>

      <section className="glass-panel rounded-xl p-5 space-y-4">
        <Field label="Customer">
          <HoReCaSearchDropdown
            hoReCas={hoReCas}
            selectedHoReCaId={hoReCaId}
            onSelectHoReCa={setHoReCaId}
            currentUser={currentUser}
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Delivery date" helper="Leave blank if it has not been agreed yet.">
            <Input
              type="date"
              value={deliveryDate}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setDeliveryDate(e.target.value)}
            />
          </Field>
        </div>
        <Field label="Notes" helper="Printed on the pick slip.">
          <Textarea
            value={notes}
            rows={2}
            onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setNotes(e.target.value)}
            placeholder="Delivery instructions, purchase order reference, anything the picker needs."
          />
        </Field>
      </section>

      <section className="space-y-4">
        <OrderLinesGrid
          lines={lines}
          products={orderable}
          customer={customer}
          onChangeQuantity={setQuantity}
          onRemove={removeLine}
          onAddProduct={addProduct}
        />
        <CsvPastePanel products={orderable} onAdd={addLines} />
      </section>

      {submitError && (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {submitError}
        </p>
      )}

      <div className="flex items-center justify-end gap-3 pb-8">
        <Button type="button" variant="ghost" onClick={reset} disabled={placeOrder.isPending}>
          Clear
        </Button>
        <Button type="button" onClick={submit} disabled={!canSubmit}>
          {placeOrder.isPending ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" /> Placing…
            </>
          ) : (
            <>
              <ShoppingCart className="w-4 h-4 mr-2" /> Place order
            </>
          )}
        </Button>
      </div>
    </div>
  )
}

export default NewOrderView
