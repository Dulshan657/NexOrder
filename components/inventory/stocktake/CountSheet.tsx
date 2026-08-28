// The count sheet for one location.
//
// Blank means UNCOUNTED and never becomes zero — a write-off has to be typed.
// That rule lives in lib/binCount's `parseCountedQty`; this component only has
// to avoid inventing a default, which is why the inputs start empty and stay
// empty until someone types.
//
// Posting is not all-or-nothing. A line whose shortfall runs deeper than its
// unreserved stock comes back refused while every other line lands, so this
// keeps refused lines on the sheet with the server's explanation attached and
// clears only what actually posted.

import React, { useMemo, useState } from 'react'
import { ClipboardCheck, Loader2, MapPin, RotateCcw } from 'lucide-react'
import { ConfirmDialog } from '@/components/ui'
import type { InventoryLocation, Product } from '@/types'
import {
  postableLines,
  sheetSummary,
  systemQtyOf,
  type CountLineResult,
  type CountSheetLine,
} from '@/lib/binCount'
import { useCountBin, useLocationCountSheet } from '@/hooks/queries/useCountBin'
import { extractFunctionErrorMessage } from '@/lib/functionError'
import { useToasts } from '@/hooks/useToasts'
import { CountLineRow } from './CountLineRow'
import { FoundItemPicker } from './FoundItemPicker'
import { locationOneLine, locationSubtitle, locationTitle } from '@/lib/locationDisplay'

interface CountSheetProps {
  location: InventoryLocation
  products: Product[]
  canWork: boolean
  onDone: () => void
}

export const CountSheet: React.FC<CountSheetProps> = ({ location, products, canWork, onDone }) => {
  const { data: systemLines, isLoading, isError, error } = useLocationCountSheet(location.id)
  const post = useCountBin()
  const { addToast } = useToasts()

  const [counts, setCounts] = useState<Record<number, string>>({})
  const [found, setFound] = useState<CountSheetLine[]>([])
  const [results, setResults] = useState<Record<number, CountLineResult>>({})
  const [confirming, setConfirming] = useState(false)
  const [note, setNote] = useState('')
  const [postError, setPostError] = useState<string | null>(null)

  // Found lines first: they are the ones the operator just added and is looking
  // for confirmation of. Everything else keeps the query's SKU ordering.
  const lines = useMemo<CountSheetLine[]>(
    () => [...found, ...(systemLines ?? [])],
    [found, systemLines],
  )
  const productIds = useMemo(() => new Set(lines.map((l) => l.productId)), [lines])

  const summary = useMemo(() => sheetSummary(lines, counts), [lines, counts])
  const toPost = useMemo(() => postableLines(lines, counts), [lines, counts])

  const addFound = (product: Product) => {
    setFound((prev) => [
      {
        productId: product.id,
        sku: product.sku,
        name: product.name,
        barcode: product.barcode ?? null,
        slots: [],
        isFound: true,
      },
      ...prev,
    ])
  }

  const resetSheet = () => {
    setCounts({})
    setFound([])
    setResults({})
    setPostError(null)
    setNote('')
  }

  const handlePost = async () => {
    setConfirming(false)
    setPostError(null)
    try {
      const outcome = await post.mutateAsync({
        locationId: location.id,
        lines: toPost,
        ...(note.trim() ? { note: note.trim() } : {}),
      })

      const byProduct: Record<number, CountLineResult> = {}
      for (const r of outcome.results) byProduct[r.productId] = r
      setResults(byProduct)

      // Clear only what landed. A refused line keeps its typed number so the
      // operator can fix the blocker and post again without re-counting.
      setCounts((prev) => {
        const next = { ...prev }
        for (const r of outcome.results) {
          if (r.ok) delete next[r.productId]
        }
        return next
      })
      // A found line that posted is now a real balance row and will come back
      // from the refetched sheet — leaving it here would duplicate it.
      setFound((prev) => prev.filter((l) => !(byProduct[l.productId]?.ok)))

      if (outcome.refused > 0) {
        addToast(
          `${outcome.posted} line${outcome.posted === 1 ? '' : 's'} posted · ${outcome.refused} could not be`,
          outcome.posted > 0 ? 'info' : 'error',
        )
      } else {
        addToast(`${locationOneLine(location)} counted — ${outcome.posted} variance${outcome.posted === 1 ? '' : 's'} posted`, 'success')
      }
    } catch (err) {
      setPostError(await extractFunctionErrorMessage(err, 'Count could not be posted'))
    }
  }

  const blockedNote = summary.blocked > 0
    ? ` ${summary.blocked} of them will be refused — stock reserved for open orders.`
    : ''

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <MapPin className="h-4 w-4 text-nexgen-blue" aria-hidden="true" />
          <div>
            {/* Name over code (mig 00094). The code stays because a counter
                standing at the rack matches it against the sticker. */}
            <p className="text-sm font-semibold text-stone-900">{locationTitle(location)}</p>
            <p className="text-xs text-stone-500">
              {locationSubtitle(location) && (
                <span className="font-mono text-stone-500">{locationSubtitle(location)} · </span>
              )}
              {location.kind === 'WAREHOUSE' ? 'bulk / floor stock at the site root' : location.kind}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onDone}
          className="rounded-lg border border-stone-200 px-3 py-1.5 text-sm text-stone-600 btn-press hover:bg-stone-50"
        >
          Count somewhere else
        </button>
      </div>

      {isLoading && (
        <p className="flex items-center gap-2 py-8 text-sm text-stone-500">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Loading what the system holds here…
        </p>
      )}

      {isError && (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          Could not load this location: {error instanceof Error ? error.message : 'unknown error'}
        </p>
      )}

      {!isLoading && !isError && (
        <>
          <p className="text-xs text-stone-500">
            Type what you counted. <strong>Leaving a line blank leaves it untouched</strong> — to write stock
            off, type <strong>0</strong>.
          </p>

          {lines.length === 0 && found.length === 0 && (
            <p className="rounded-xl border border-dashed border-stone-300 px-3 py-6 text-center text-sm text-stone-500">
              The system holds no stock here. Anything you find can still be added below.
            </p>
          )}

          <ul className="space-y-2">
            {lines.map((line) => (
              <CountLineRow
                key={line.productId}
                line={line}
                value={counts[line.productId] ?? ''}
                disabled={!canWork || post.isPending}
                onChange={(v) => setCounts((prev) => ({ ...prev, [line.productId]: v }))}
                result={results[line.productId]}
              />
            ))}
          </ul>

          <FoundItemPicker
            products={products}
            excludeProductIds={productIds}
            onAdd={addFound}
            disabled={!canWork || post.isPending}
          />

          <div className="rounded-xl border border-stone-200 bg-stone-50 p-3">
            <label className="block text-xs font-semibold text-stone-600" htmlFor="count-note">
              Note (optional)
            </label>
            <input
              id="count-note"
              type="text"
              value={note}
              maxLength={300}
              disabled={!canWork || post.isPending}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. Quarterly count, aisle 3"
              className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 text-sm focus:border-nexgen-blue focus:outline-none focus:ring-2 focus:ring-nexgen-blue/30"
            />
            <p className="mt-1 text-[11px] text-stone-500">
              Recorded on every movement this count creates, alongside the location and date.
            </p>
          </div>

          {postError && (
            <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{postError}</p>
          )}

          {/* `flex-wrap` + `ml-auto` on the button group, NOT `justify-between`:
              `justify-content` applies per flex LINE, so once the buttons wrap
              to a second row `justify-between` drops them hard-left. At 360px
              the summary and the two buttons share 328px and the Post label
              wraps inside its own button. Same shape as ReplenSetupView's
              sticky bar.

              `backdrop-blur-XS` (4px), NOT `-sm`. Tailwind v4 renumbered the
              blur scale: `blur-sm` is 8px here and bare `blur` is its compat
              alias for the same 8px, so swapping one for the other is a no-op —
              verified against the deployed build, where both computed to
              `blur(8px)`. `-xs` is the only class that actually halves it. Every
              other piece of scroll chrome in the app is still at 8px for exactly
              this reason; blur radius is what a low-end SoC pays for on every
              scroll frame, and over `bg-white/95` the difference is invisible.
              `transform-gpu` is belt-and-braces: backdrop-filter already forces
              its own compositing layer. */}
          <div className="sticky bottom-0 -mx-4 flex flex-wrap items-center gap-3 border-t border-stone-200 bg-white/95 px-4 py-3 backdrop-blur-xs transform-gpu sm:mx-0 sm:rounded-xl sm:border">
            <div className="text-xs text-stone-500">
              <span className="font-semibold text-stone-800">{summary.variances}</span> variance
              {summary.variances === 1 ? '' : 's'}
              {summary.variances > 0 && (
                <> · net <span className="font-mono tabular-nums">{summary.netUnits > 0 ? '+' : ''}{summary.netUnits}</span></>
              )}
              {/* Without this a sheet whose only variance is blocked reads
                  "1 variance · net 0", which looks like an arithmetic bug
                  rather than the reservation it actually is. */}
              {summary.blocked > 0 && (
                <> · <span className="font-semibold text-red-600">{summary.blocked} blocked by reservations</span></>
              )}
              {summary.blank > 0 && <> · {summary.blank} not counted</>}
            </div>
            <div className="ml-auto flex flex-wrap items-center gap-2">
              {(summary.variances > 0 || Object.keys(results).length > 0) && (
                <button
                  type="button"
                  onClick={resetSheet}
                  disabled={post.isPending}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-stone-200 px-3 py-2 text-sm text-stone-600 btn-press hover:bg-stone-50 disabled:opacity-50"
                >
                  <RotateCcw className="h-4 w-4" aria-hidden="true" /> Clear
                </button>
              )}
              <button
                type="button"
                onClick={() => setConfirming(true)}
                disabled={!canWork || toPost.length === 0 || summary.invalid > 0 || post.isPending}
                className="inline-flex items-center gap-1.5 rounded-lg bg-nexgen-blue px-4 py-2 text-sm font-semibold text-white btn-press hover:bg-nexgen-blue/90 disabled:opacity-50"
              >
                {post.isPending
                  ? <><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Posting…</>
                  : <><ClipboardCheck className="h-4 w-4" aria-hidden="true" /> Post {toPost.length} variance{toPost.length === 1 ? '' : 's'}</>}
              </button>
            </div>
          </div>

          {!canWork && (
            <p className="text-xs text-amber-600">
              This is not your home warehouse, so counts here are read-only for your account.
            </p>
          )}
        </>
      )}

      <ConfirmDialog
        open={confirming}
        tone="danger"
        title={`Post ${toPost.length} variance${toPost.length === 1 ? '' : 's'} at ${location.code}?`}
        message={
          <>
            <p>
              This moves stock. {summary.shortfall} line{summary.shortfall === 1 ? '' : 's'} will be reduced and{' '}
              {summary.surplus} increased, a net of{' '}
              <strong className="font-mono">{summary.netUnits > 0 ? '+' : ''}{summary.netUnits}</strong> units.
              {blockedNote}
            </p>
            <ul className="mt-3 max-h-56 space-y-1 overflow-y-auto text-xs">
              {lines
                .filter((l) => toPost.some((p) => p.productId === l.productId))
                .map((l) => {
                  const counted = toPost.find((p) => p.productId === l.productId)!.countedQty
                  const sys = systemQtyOf(l.slots)
                  const delta = counted - sys
                  return (
                    <li key={l.productId} className="flex items-center justify-between gap-3">
                      <span className="truncate font-mono text-stone-600">{l.sku}</span>
                      <span className="shrink-0 tabular-nums text-stone-500">
                        {sys} → {counted}{' '}
                        <span className={delta > 0 ? 'text-emerald-600' : 'text-amber-600'}>
                          ({delta > 0 ? '+' : ''}{delta})
                        </span>
                      </span>
                    </li>
                  )
                })}
            </ul>
            <p className="mt-3 text-stone-500">
              Lines you left blank are not touched. Every movement is recorded in the inventory ledger as a
              stocktake variance.
            </p>
          </>
        }
        confirmLabel={post.isPending ? 'Posting…' : 'Post count'}
        busy={post.isPending}
        onConfirm={handlePost}
        onCancel={() => setConfirming(false)}
      />
    </div>
  )
}

export default CountSheet
