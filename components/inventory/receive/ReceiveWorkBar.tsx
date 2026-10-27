// The one bar the operator works from (NX-0005): the scan/search field, the
// unit controls, the running totals and Receive — pinned where the eye or the
// thumb is (`StickyScanBar` `adaptive`: top on a desk, bottom on the RS35).
//
// Totals and Receive live HERE rather than in a footer under the lines. A footer
// meant scrolling the whole receipt to submit it, and it was the only place
// that said how much had been staged — so the operator either scrolled or
// guessed.
//
// One box for both jobs, deliberately. Typing drives the substring search and
// its results; a SCAN (camera, wedge gun, or Enter) adds outright. Splitting
// them would make the operator decide which box to aim at before they know what
// the label is. The keyboard reaches the results too: ArrowUp/Down highlight,
// Enter adds the highlighted one, Escape clears.

import React from 'react'
import { Boxes, Layers, PackagePlus, Plus, X } from 'lucide-react'
import type { Product } from '../../../types'
import { ScanField } from '../../ui/ScanField'
import { supplierSkuFor } from '../../../lib/productSuppliers'

export interface ReceiveTotals {
  lines: number
  /** Staged quantity by unit, already formatted: "148 carton · 3 each". */
  units: string
  plates: number
  missingLot: number
  missingExpiry: number
}

export interface ReceiveWorkBarProps {
  searchWrapRef: React.MutableRefObject<HTMLDivElement | null>
  search: string
  onSearch: (value: string) => void
  onFieldScan: (raw: string) => void
  flash: 'ok' | 'reject' | null
  scanNote: string | null
  placeholder: string

  results: Product[]
  supplierId: number | null
  activeIndex: number
  onActiveIndex: (index: number) => void
  onPick: (product: Product) => void

  /** Which catalogue is being searched, and how to widen it. */
  scope: React.ReactNode

  forceNewPallet: boolean
  onToggleNewPallet: () => void
  onMixedPallet: () => void
  onAddBlankLine: () => void

  totals: ReceiveTotals
  canSubmit: boolean
  isPending: boolean
  validCount: number
  /** Why Receive is disabled, when it is and the reason is not obvious. */
  blockedReason: string | null
  onSubmit: () => void
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

export function ReceiveWorkBar(props: ReceiveWorkBarProps) {
  const {
    searchWrapRef, search, onSearch, onFieldScan, flash, scanNote, placeholder,
    results, supplierId, activeIndex, onActiveIndex, onPick, scope,
    forceNewPallet, onToggleNewPallet, onMixedPallet, onAddBlankLine,
    totals, canSubmit, isPending, validCount, blockedReason, onSubmit,
  } = props

  // Capture phase, on the wrapper: ScanField exposes no key handler, and its own
  // onKeyDown commits on Enter. When a result is highlighted, Enter means "that
  // one", so the event is stopped here before the field treats it as a scan.
  const onKeyDownCapture = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown' && results.length > 0) {
      e.preventDefault()
      onActiveIndex(Math.min(activeIndex + 1, results.length - 1))
    } else if (e.key === 'ArrowUp' && results.length > 0) {
      e.preventDefault()
      onActiveIndex(Math.max(activeIndex - 1, -1))
    } else if (e.key === 'Enter' && activeIndex >= 0 && results[activeIndex]) {
      e.preventDefault()
      e.stopPropagation()
      onPick(results[activeIndex])
    } else if (e.key === 'Escape' && search) {
      e.preventDefault()
      onSearch('')
    }
  }

  const missing = [
    totals.missingExpiry > 0 ? `${totals.missingExpiry} missing expiry` : null,
    totals.missingLot > 0 ? `${totals.missingLot} missing lot` : null,
  ].filter(Boolean)

  return (
    <div className="space-y-2">
      {/* ONE render of everything, wrapped by flex rather than duplicated per
          layout: two Receive buttons in the DOM — one merely hidden — is two
          buttons to a screen reader and to every test. Below `lg` the totals
          row takes the full width and so wraps under the field; on a desk it
          sits to the right of the field, or wraps right-aligned when the
          sidebar leaves too little room. */}
      <div className="flex flex-wrap items-start gap-2">
        {/* `onKeyDownCapture` on a plain div: it only listens for keys that
            bubble out of the search field inside it, and adds no interaction
            of its own. */}
        {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions */}
        <div className="relative min-w-0 flex-1 basis-48 lg:max-w-xl" ref={searchWrapRef} onKeyDownCapture={onKeyDownCapture}>
          <ScanField
            ariaLabel="Search products"
            value={search}
            onChange={onSearch}
            onScan={onFieldScan}
            flash={flash}
            error={scanNote ?? undefined}
            placeholder={placeholder}
            cameraTitle="Scan a carton"
          />
          {/* 22px = half of ScanField's 44px input. NOT `top-1/2`: this wrapper
              also holds the error line, so a percentage drifts downward the
              moment a refusal appears. */}
          {search && (
            <button
              type="button"
              onClick={() => onSearch('')}
              aria-label="Clear search"
              className="absolute right-14 top-[22px] -translate-y-1/2 text-stone-500 hover:text-stone-700"
            >
              <X className="w-4 h-4" aria-hidden="true" />
            </button>
          )}
          {results.length > 0 && (
            // Opens UPWARD while the bar is a bottom dock — downward it ran off
            // the foot of the screen — and downward once the bar is at the top.
            <div className="absolute z-20 bottom-full mb-1 w-full bg-white border border-stone-200 rounded-lg shadow-card overflow-hidden lg:bottom-auto lg:top-full lg:mb-0 lg:mt-1">
              {results.map((p, i) => {
                const theirSku = supplierSkuFor(p, supplierId)
                const active = i === activeIndex
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => onPick(p)}
                    aria-current={active ? 'true' : undefined}
                    className={`flex items-center justify-between gap-3 w-full px-4 py-2.5 min-h-[44px] text-left btn-press ${
                      active ? 'bg-nexgen-blue/10' : 'hover:bg-stone-50'
                    }`}
                  >
                    <span className="text-sm text-stone-800 truncate">{p.name}</span>
                    <span className="text-xs text-stone-600 font-mono shrink-0">
                      {theirSku ? `${theirSku} · ` : ''}{p.sku}
                    </span>
                  </button>
                )
              })}
            </div>
          )}
        </div>

        {/* Unit controls. Icon-only below `lg` so the field keeps its width on a
            360px screen; labelled from `lg`, where there is room. */}
        <button
          type="button"
          onClick={onToggleNewPallet}
          aria-pressed={forceNewPallet}
          aria-label="New pallet"
          title="The next product scanned starts its own pallet"
          className={`btn-press flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center gap-1.5 rounded-lg border px-2.5 text-sm font-medium lg:px-3 ${
            forceNewPallet
              ? 'border-nexgen-blue bg-nexgen-blue text-white'
              : 'border-stone-300 bg-white text-stone-700 hover:bg-stone-50'
          }`}
        >
          <Layers className="h-4 w-4" aria-hidden="true" />
          <span className="hidden lg:inline">New pallet</span>
        </button>
        <button
          type="button"
          onClick={onMixedPallet}
          aria-label="Mixed pallet"
          title="Start a pallet carrying several products"
          className="btn-press flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center gap-1.5 rounded-lg border border-stone-300 bg-white px-2.5 text-sm font-medium text-stone-700 hover:bg-stone-50 lg:px-3"
        >
          <Boxes className="h-4 w-4" aria-hidden="true" />
          <span className="hidden lg:inline">Mixed pallet</span>
        </button>

        <div className="flex w-full items-center gap-2 lg:ml-auto lg:w-auto lg:gap-3">
          <TotalsText totals={totals} missing={missing as string[]} />
          <ReceiveButton
            canSubmit={canSubmit} isPending={isPending} validCount={validCount} onSubmit={onSubmit}
          />
        </div>
      </div>

      {forceNewPallet && (
        <p className="text-xs font-medium text-nexgen-blue">
          Next product scanned starts a new pallet.
        </p>
      )}

      {scope}

      <div className="flex flex-wrap items-center gap-3">
        {blockedReason && <span className="text-xs text-amber-700">{blockedReason}</span>}
        <button
          type="button"
          onClick={onAddBlankLine}
          className="inline-flex items-center gap-1 text-xs text-stone-600 hover:text-stone-900"
        >
          <Plus className="h-3.5 w-3.5" aria-hidden="true" /> Add a line by hand
        </button>
      </div>
    </div>
  )
}

function TotalsText({ totals, missing }: { totals: ReceiveTotals; missing: string[] }) {
  return (
    <p
      data-testid="receive-totals"
      aria-live="polite"
      className="min-w-0 flex-1 truncate text-xs text-stone-600 tabular-nums lg:flex-none"
    >
      {totals.lines === 0 ? (
        'Nothing staged yet'
      ) : (
        <>
          <span className="font-semibold text-stone-800">{plural(totals.lines, 'line')}</span>
          {totals.units ? ` · ${totals.units}` : ''}
          {` · ${plural(totals.plates, 'plate')}`}
          {missing.length > 0 && <span className="text-red-700">{` · ${missing.join(' · ')}`}</span>}
        </>
      )}
    </p>
  )
}

function ReceiveButton({
  canSubmit, isPending, validCount, onSubmit,
}: { canSubmit: boolean; isPending: boolean; validCount: number; onSubmit: () => void }) {
  return (
    <button
      type="button"
      onClick={onSubmit}
      disabled={!canSubmit}
      className="btn-press inline-flex min-h-[44px] shrink-0 items-center gap-2 rounded-lg bg-nexgen-blue px-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
    >
      <PackagePlus className="h-4 w-4" aria-hidden="true" />
      {isPending ? 'Receiving…' : `Receive ${plural(validCount, 'line')}`}
    </button>
  )
}

export default ReceiveWorkBar
