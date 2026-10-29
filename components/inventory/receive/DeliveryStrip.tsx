// Who supplied this delivery, and where it is going — as one compact strip.
//
// NX-0005: this used to be a five-column card plus a "Received by" box, which
// put ~400px of answered questions between the operator and the scan field on
// a handheld and a full card's height on a desk. It is now one row on a desk,
// and once a supplier is chosen it collapses to a one-line summary at EVERY
// width (it collapsed only below `xl` before).
//
// "Received by" is gone as a field: it was never editable — the server stamps
// the actor — so it is stated in the summary instead.
//
// Every control stays MOUNTED whatever the disclosure says, toggled by `hidden`
// rather than a conditional render. Two reasons, both load-bearing:
//   - `SupplierCombobox` owns its own open/query state, and submit reads React
//     state rather than the DOM, so unmounting would lose typing for no gain;
//   - `receiveStockSupplierFilter.test.tsx` reaches these controls through
//     `getByLabelText('Supplier')`, and jsdom applies no Tailwind, so a class
//     toggle is invisible to it where a conditional render would not be.
//
// The quarantine flag is in the summary and not only in the fields, because it
// writes onto EVERY line: a flag that changes what is received, concealed in a
// collapsed section, would be a worse defect than the space this saves.

import React, { useEffect, useId, useMemo, useRef, useState } from 'react'
import { Check, ChevronDown, Plus, Truck } from 'lucide-react'
import { Tooltip } from '../../ui/Tooltip'

export interface SupplierOption {
  id: number
  name: string
}

interface SupplierComboboxProps {
  inputId: string
  suppliers: SupplierOption[]
  /** Currently selected supplier id (existing pick), or null for free-text/none. */
  valueId: number | null
  /** Text shown in the field — an existing name or a free-text name. */
  valueName: string
  onPickExisting: (supplier: SupplierOption) => void
  /** User committed a name not in the list (create-on-the-fly). */
  onPickNew: (name: string) => void
  onChangeText: (name: string) => void
  /** The list opened or closed — the host lifts its stacking for it. */
  onOpenChange?: (open: boolean) => void
}

/**
 * Searchable supplier picker that also lets the operator type a supplier that
 * isn't in the list yet ("Create …"). A delivery always comes from one supplier,
 * so this is the required header field for a goods receipt.
 */
function SupplierCombobox({
  inputId, suppliers, valueId, valueName, onPickExisting, onPickNew, onChangeText, onOpenChange,
}: SupplierComboboxProps) {
  const [open, setOpen] = useState(false)
  const boxRef = useRef<HTMLDivElement>(null)

  useEffect(() => { onOpenChange?.(open) }, [open])

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [])

  const query = valueName.trim().toLowerCase()
  const matches = useMemo(() => {
    if (!query) return suppliers.slice(0, 8)
    return suppliers.filter((s) => s.name.toLowerCase().includes(query)).slice(0, 8)
  }, [suppliers, query])

  const exactExists = useMemo(
    () => suppliers.some((s) => s.name.trim().toLowerCase() === query),
    [suppliers, query],
  )
  const showCreate = query.length > 0 && !exactExists

  return (
    <div className="relative" ref={boxRef}>
      <div className="relative">
        <Truck className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-500" aria-hidden="true" />
        <input
          id={inputId}
          type="text"
          value={valueName}
          onChange={(e) => { onChangeText(e.target.value); setOpen(true) }}
          onFocus={() => setOpen(true)}
          placeholder="Search or type a supplier…"
          aria-label="Supplier"
          className="w-full min-h-[44px] pl-10 pr-9 py-2.5 bg-white border border-stone-300 rounded-lg text-sm text-stone-900 placeholder:text-stone-500 focus:outline-none focus:ring-2 focus:ring-nexgen-blue-dark focus:border-nexgen-blue"
        />
        {valueId != null ? (
          <Check className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-emerald-600" aria-hidden="true" />
        ) : (
          <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-500" aria-hidden="true" />
        )}
      </div>
      {open && (matches.length > 0 || showCreate) && (
        <div className="absolute z-20 mt-1 w-full bg-white border border-stone-200 rounded-lg shadow-card overflow-hidden">
          {matches.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => { onPickExisting(s); setOpen(false) }}
              className="flex items-center justify-between w-full px-4 py-2.5 text-left hover:bg-stone-50 btn-press"
            >
              <span className="text-sm text-stone-800">{s.name}</span>
              {valueId === s.id && <Check className="w-4 h-4 text-emerald-600" aria-hidden="true" />}
            </button>
          ))}
          {showCreate && (
            <button
              type="button"
              onClick={() => { onPickNew(valueName.trim()); setOpen(false) }}
              className="flex items-center gap-2 w-full px-4 py-2.5 text-left border-t border-stone-100 hover:bg-stone-50 btn-press"
            >
              <Plus className="w-4 h-4 text-nexgen-blue" aria-hidden="true" />
              <span className="text-sm text-stone-700">
                Create “<span className="font-medium">{valueName.trim()}</span>”
              </span>
            </button>
          )}
        </div>
      )}
    </div>
  )
}

export interface DeliveryStripProps {
  /** A restored draft (A13) already has its supplier chosen — start collapsed. */
  initiallyCommitted?: boolean
  suppliers: SupplierOption[]
  supplierId: number | null
  supplierName: string
  onSupplierText: (name: string) => void
  /** An existing or a new supplier was committed — the strip may collapse. */
  onSupplierPicked: (supplier: { id: number | null; name: string }) => void
  reference: string
  onReference: (value: string) => void
  receivedDate: string
  maxDate: string
  onReceivedDate: (value: string) => void
  quarantineAll: boolean
  onQuarantineAll: (value: boolean) => void
  /** Locked users receive at their home site only; no picker. */
  isLocked: boolean
  warehouses: readonly { id: number; name: string }[]
  destinationId: number | null
  onDestination: (id: number | null) => void
  /** Where the stock will land, as a name, for the summary. */
  destName: string | undefined
  userName: string
}

const FIELD =
  'w-full min-h-[44px] px-3 py-2.5 bg-white border border-stone-300 rounded-lg text-sm text-stone-900 ' +
  'placeholder:text-stone-500 focus:outline-none focus:ring-2 focus:ring-nexgen-blue-dark focus:border-nexgen-blue'
const LABEL = 'block text-xs font-semibold text-stone-600 mb-1.5'

export function DeliveryStrip(props: DeliveryStripProps) {
  const {
    initiallyCommitted = false, suppliers, supplierId, supplierName, onSupplierText, onSupplierPicked,
    reference, onReference, receivedDate, maxDate, onReceivedDate,
    quarantineAll, onQuarantineAll, isLocked, warehouses, destinationId,
    onDestination, destName, userName,
  } = props

  const [open, setOpen] = useState(false)
  // Collapse only on a COMMITTED pick (an existing supplier, or "Create …").
  // Keyed on the text alone it collapsed on the first keystroke and hid the
  // very input being typed into.
  const [committed, setCommitted] = useState(initiallyCommitted)
  // `.glass-card` carries backdrop-blur, which makes this card a stacking
  // context: the supplier list's own z-index counts only INSIDE it, so the
  // sticky scan bar (z-10) and the lines below painted over the list. The card
  // is lifted while the list is open, and only then — lifted permanently it
  // would cover the pinned bar whenever it scrolls up underneath it.
  const [listOpen, setListOpen] = useState(false)
  const fieldsId = useId()
  const supplierInputId = useId()
  const referenceId = useId()
  const dateId = useId()
  const destinationIdAttr = useId()

  const hasSupplier = supplierName.trim() !== ''
  const isCommitted = committed && hasSupplier
  const collapsed = !open && isCommitted
  // A picker only where there is a choice; otherwise the site is in the summary.
  const showDestination = !isLocked && warehouses.length > 1

  const summary = [
    supplierName.trim() || 'No supplier yet',
    reference.trim() || null,
    destName ?? 'Default site',
    receivedDate,
    `by ${userName}`,
  ].filter(Boolean).join(' · ')

  const pick = (supplier: { id: number | null; name: string }) => {
    onSupplierPicked(supplier)
    setCommitted(true)
    setOpen(false)
  }

  return (
    <section
      aria-label="Delivery details"
      className={`glass-card rounded-xl p-3 sm:p-4 ${listOpen ? 'relative z-30' : ''}`}
    >
      {isCommitted && (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={!collapsed}
          aria-controls={fieldsId}
          data-testid="receipt-header-toggle"
          className={`touch-target-y flex w-full items-center gap-2 rounded-lg text-left btn-press hover:bg-stone-50 ${
            collapsed ? '' : 'mb-2'
          }`}
        >
          <ChevronDown
            className={`w-4 h-4 shrink-0 text-stone-600 transition-transform ${collapsed ? '' : 'rotate-180'}`}
            aria-hidden="true"
          />
          <span className="min-w-0 flex-1 truncate text-sm text-stone-700">
            {collapsed ? summary : <span className="font-semibold">Delivery details</span>}
          </span>
          {quarantineAll && (
            <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">
              Quarantine
            </span>
          )}
        </button>
      )}

      <div
        id={fieldsId}
        className={`${collapsed ? 'hidden' : 'grid'} grid-cols-1 gap-3 sm:grid-cols-2 lg:items-end ${
          showDestination
            ? 'lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_auto_auto]'
            : 'lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_auto_auto]'
        }`}
      >
        <div className="sm:col-span-2 lg:col-span-1">
          <label htmlFor={supplierInputId} className={LABEL}>
            Supplier <span className="text-red-600">*</span>
          </label>
          <SupplierCombobox
            inputId={supplierInputId}
            suppliers={suppliers}
            valueId={supplierId}
            valueName={supplierName}
            onChangeText={(name) => { setCommitted(false); onSupplierText(name) }}
            onOpenChange={setListOpen}
            onPickExisting={(s) => pick({ id: s.id, name: s.name })}
            onPickNew={(name) => pick({ id: null, name })}
          />
          {supplierId == null && hasSupplier && (
            <p className="text-xs text-stone-600 mt-1">New supplier — will be added to your supplier list.</p>
          )}
        </div>

        <div>
          <label htmlFor={referenceId} className={LABEL}>Reference</label>
          <input
            id={referenceId}
            aria-label="Reference"
            type="text"
            value={reference}
            onChange={(e) => onReference(e.target.value)}
            placeholder="Invoice / docket / PO no."
            className={FIELD}
          />
        </div>

        {showDestination && (
          <div>
            <label htmlFor={destinationIdAttr} className={LABEL}>Destination</label>
            <select
              id={destinationIdAttr}
              value={destinationId ?? ''}
              onChange={(e) => onDestination(e.target.value === '' ? null : Number(e.target.value))}
              aria-label="Destination warehouse"
              className={FIELD}
            >
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>{w.name}</option>
              ))}
            </select>
          </div>
        )}

        <div>
          <label htmlFor={dateId} className={LABEL}>Received</label>
          <input
            id={dateId}
            aria-label="Received date"
            type="date"
            value={receivedDate}
            max={maxDate}
            onChange={(e) => onReceivedDate(e.target.value)}
            className={FIELD}
          />
        </div>

        {/* Quarantine (mig 00101). A bulk control only: it writes the flag onto
            every line, so what is ticked in the lines IS what is sent. */}
        <div className="flex items-center gap-1.5">
          <label className="flex min-h-[44px] flex-1 cursor-pointer items-center gap-2 rounded-lg border border-stone-300 px-3 text-sm text-stone-700">
            <input
              type="checkbox"
              aria-label="Quarantine this delivery"
              checked={quarantineAll}
              onChange={(e) => onQuarantineAll(e.target.checked)}
              className="h-4 w-4"
            />
            <span className="font-semibold">Quarantine this delivery</span>
          </label>
          <Tooltip
            align="right"
            label="What does Quarantine do?"
            text="Goes to a quarantine bay. It cannot be sold until you release it by moving it out."
          />
        </div>
      </div>

      {!collapsed && isLocked && (
        <p className="text-xs text-stone-600 mt-2">Receiving at {destName ?? 'your site'} — you can only receive at your site.</p>
      )}
    </section>
  )
}

export default DeliveryStrip
