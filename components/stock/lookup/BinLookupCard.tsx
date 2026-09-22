// What's in this bin.
//
// Read-only. Correcting a count is Stocktake's job and this screen does not
// duplicate it — it hands the location over instead, which is the whole reason
// "Count this bin" carries a `locationId` rather than opening anything here.
//
// ── THE CAP IS NOT COSMETIC ─────────────────────────────────────────────────
//
// `getLocationCountSheet` is unscoped and unpaginated, and a BULK warehouse's
// stock sits on the warehouse ROOT — every unplaced SKU on the site, in one
// list. Stocktake gets away with that because counting a root is a deliberate,
// rare act; a scan is neither, and an operator who scans a site root on a
// handheld would otherwise pull hundreds of rows into a 360px screen. So the
// list caps and says so, the way `CountLocationFinder` does.

import React, { useMemo, useState } from 'react'
import { ClipboardList, MapPin, Search } from 'lucide-react'
import { Callout } from '@/components/ui'
import { useLocationCountSheet } from '@/hooks/queries/useCountBin'
import { locationTitle } from '@/lib/locationDisplay'
import type { ScanLocation } from '@/lib/scan/resolveScan'
import { LookupHeader } from './LookupHeader'

const MAX_LISTED = 50

export interface BinLookupCardProps {
  location: ScanLocation
  /** False when the bin sits outside the operator's active site. The contents
   *  are still shown — read-only means read-anywhere — but the screen says so,
   *  because "no stock here" and "not your site" look identical otherwise. */
  inScope: boolean
  /** Name of the site the operator is scoped to, for that message. */
  scopeLabel: string | null
  /** Absent where the view is mounted without a router to hand off to — the
   *  button is then not rendered at all, rather than shown and dead. */
  onCountBin?: (locationId: number) => void
}

export function BinLookupCard({ location, inScope, scopeLabel, onCountBin }: BinLookupCardProps) {
  const { data: lines, isLoading, isError } = useLocationCountSheet(location.id)
  const [filter, setFilter] = useState('')

  const filtered = useMemo(() => {
    const all = lines ?? []
    const q = filter.trim().toLowerCase()
    if (!q) return all
    return all.filter((l) => l.name.toLowerCase().includes(q) || l.sku.toLowerCase().includes(q))
  }, [lines, filter])

  const shown = filtered.slice(0, MAX_LISTED)
  const overCap = filtered.length > MAX_LISTED
  const total = lines?.length ?? 0

  return (
    <div className="space-y-4">
      {/* Code is the hero because it is what is printed on the sticker. The
          composed name (mig 00094) rides underneath — and `locationSubtitle` is
          deliberately NOT used here: it returns the CODE, which is already the
          hero, so passing it would render the same string twice. */}
      <LookupHeader
        kind="Location"
        code={location.code}
        name={locationTitle(location) === location.code ? null : locationTitle(location)}
        icon={<MapPin className="h-5 w-5" aria-hidden="true" />}
      />

      {!location.isActive && (
        <Callout tone="warning" dense title="Retired from the layout">
          This location is no longer active. Anything still here needs moving.
        </Callout>
      )}

      {!inScope && (
        <Callout tone="info" dense title="Another site">
          {scopeLabel
            ? `This bin is not in ${scopeLabel}, the site you are working in.`
            : 'This bin is not in the site you are working in.'}
        </Callout>
      )}

      {onCountBin && (
        <button
          type="button"
          onClick={() => onCountBin(location.id)}
          className="touch-target-y flex w-full items-center justify-center gap-2 rounded-xl bg-nexgen-blue-dark px-4 py-2.5 text-sm font-semibold text-white btn-press"
        >
          <ClipboardList className="h-4 w-4" aria-hidden="true" /> Count this bin
        </button>
      )}

      {isLoading ? (
        <div className="glass-card rounded-xl divide-y divide-stone-100">
          {[0, 1, 2].map((i) => <div key={i} className="h-16 animate-pulse bg-stone-100/60" />)}
        </div>
      ) : isError ? (
        <div className="glass-card rounded-xl p-8 text-center">
          <p className="text-sm text-red-600">Couldn't load what's here.</p>
          <p className="mt-1 text-xs text-stone-600">Check your connection and try again.</p>
        </div>
      ) : total === 0 ? (
        <div className="glass-card rounded-xl p-10 text-center">
          <MapPin className="mx-auto mb-3 h-9 w-9 text-stone-300" aria-hidden="true" />
          <p className="text-sm text-stone-700">Nothing here</p>
          <p className="mt-1 text-xs text-stone-600">
            The ledger holds no stock at this location.
          </p>
        </div>
      ) : (
        <>
          {/* The filter appears only once the list is long enough to need it —
              44px of permanent chrome for a three-line bin would be a worse
              trade than typing on the rare full one. */}
          {total > MAX_LISTED && (
            <div className="relative">
              {/* `aria-label` rather than an `sr-only` <label htmlFor>: the
                  jsx-a11y rule does not follow htmlFor to an id, and carrying
                  both would mean a label element that nothing ever announces,
                  since aria-label wins. One accessible name, stated once. */}
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-600" aria-hidden="true" />
              <input
                aria-label="Filter the products in this location"
                type="text"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="Narrow by name or SKU"
                className="touch-target-y w-full rounded-lg border border-stone-300 bg-white py-2 pl-9 pr-3 text-sm text-stone-900 placeholder:text-stone-500 focus:border-nexgen-blue focus:outline-none focus:ring-2 focus:ring-nexgen-blue-dark"
              />
            </div>
          )}

          <p className="text-xs text-stone-600">
            {overCap
              ? `Showing ${MAX_LISTED} of ${filtered.length} products — narrow the list to see the rest.`
              : filter.trim() && filtered.length !== total
                ? `${filtered.length} of ${total} products match.`
                : `${total} ${total === 1 ? 'product' : 'products'} here.`}
          </p>

          {filtered.length === 0 ? (
            <div className="glass-card rounded-xl p-8 text-center">
              <p className="text-sm text-stone-700">Nothing matches that</p>
              <p className="mt-1 text-xs text-stone-600">{total} products are in this location.</p>
            </div>
          ) : (
            <ul className="glass-card divide-y divide-stone-100 overflow-hidden rounded-xl">
              {shown.map((line) => {
                const onHand = line.slots.reduce((sum, s) => sum + s.onHand, 0)
                return (
                  <li key={line.productId} className="px-4 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-stone-900">{line.name}</p>
                        <p className="truncate font-mono text-xs text-stone-600">{line.sku}</p>
                      </div>
                      <p className="shrink-0 font-mono text-base font-semibold tabular-nums text-stone-900">
                        {onHand}
                      </p>
                    </div>

                    <ul className="mt-2 space-y-1">
                      {line.slots.map((slot, i) => (
                        <li
                          key={`${slot.batchId ?? 'nb'}-${slot.huId ?? 'loose'}-${i}`}
                          className="flex items-center justify-between gap-3 rounded-md bg-stone-50 px-2.5 py-1.5 text-xs"
                        >
                          <span className="min-w-0 truncate text-stone-600">
                            {slot.huCode
                              ? <span className="font-mono text-stone-700">{slot.huCode}</span>
                              : 'loose'}
                            {' · '}
                            {slot.lotCode ? `lot ${slot.lotCode}` : 'untracked'}
                            {slot.expiryDate ? ` · exp ${slot.expiryDate}` : ''}
                          </span>
                          <span className="shrink-0 font-mono tabular-nums text-stone-900">
                            {slot.onHand}
                            {slot.allocated > 0 && (
                              <span className="ml-1 text-stone-600">({slot.allocated} alloc)</span>
                            )}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </li>
                )
              })}
            </ul>
          )}
        </>
      )}
    </div>
  )
}

export default BinLookupCard
