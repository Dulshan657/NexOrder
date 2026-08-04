// One line in the putaway queue: what it is, how much, where it came from, and
// where the engine wants it. Replaces a row that said only "Product #42".

import React from 'react'
import { AlertTriangle, Check, Footprints, HelpCircle, MapPin, Package, RefreshCw } from 'lucide-react'
import type { PendingPutawayRow } from '@/services/supabase/putawayQueueService'
import { formatRelative } from '@/components/admin/emailAccountFormat'
import { PutawayExplanationCard } from '../PutawayExplanationCard'
import { describeQuantity } from './putawayFormat'
import { LocationLabel } from '@/components/inventory/LocationLabel'
import type { DisplayLocation } from '@/lib/locationDisplay'

interface PutawayRowProps {
  row: PendingPutawayRow
  /** Destination, name-first with the code beneath (mig 00094). */
  bin: DisplayLocation | null
  /** Names for the scoring card's candidate list. */
  binById?: ReadonlyMap<number, DisplayLocation>
  expanded: boolean
  busy: boolean
  onToggleExplanation: () => void
  /** Send it to the Walk run. Decides the bin; moves no stock (mig 00080). */
  onAssign: () => void
  /** One-step: decide AND move, without a walk. For desk and bulk work. */
  onPlaceNow: () => void
  onChooseBin: () => void
  onRerun: () => void
}

// React.FC deliberately: this repo has no @types/react, so a plainly-typed
// function component's JSX attributes are exactly its props — and `key`, which
// the queue must pass when it maps rows, would be rejected. React.FC resolves to
// `any` here and lets the special prop through.
export const PutawayRow: React.FC<PutawayRowProps> = ({
  row,
  bin,
  binById,
  expanded,
  busy,
  onToggleExplanation,
  onAssign,
  onPlaceNow,
  onChooseBin,
  onRerun,
}) => {
  const { product, receipt } = row
  const name = product?.name ?? `Product #${row.productId}`
  const qty = describeQuantity(row.quantity, product)

  const receiptBits = [receipt?.supplierName, receipt?.reference].filter(Boolean) as string[]

  // When the engine found no bin at all, name WHY rather than leaving a bare
  // "No eligible bin" — the label comes straight from the engine's hard-filter
  // reason, never invented client-side copy. The code is lower-snake, matching
  // what scoring.ts actually emits (`level_role_mismatch`).
  const mismatch = !row.recommendedLocationId
    ? row.explanation?.hardFilters?.find((h) => h.code === 'level_role_mismatch')
    : undefined

  return (
    <div className="px-4 py-3">
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        {/* Identity */}
        <div className="flex items-start gap-3 flex-1 min-w-0">
          {product?.imageUrl ? (
            <img
              src={product.imageUrl}
              alt=""
              className="w-10 h-10 rounded-lg object-cover bg-stone-100 shrink-0"
            />
          ) : (
            <div className="w-10 h-10 rounded-lg bg-stone-100 flex items-center justify-center shrink-0">
              <Package className="w-4 h-4 text-stone-400" />
            </div>
          )}

          <div className="min-w-0 flex-1">
            <p className="text-sm text-stone-800 truncate">{name}</p>
            <p className="text-xs text-stone-400 flex flex-wrap items-center gap-x-1.5">
              {product?.sku && <span className="font-mono">{product.sku}</span>}
              <span className="text-stone-700 tabular-nums">{qty.primary}</span>
              {qty.secondary && <span className="text-stone-400">· {qty.secondary}</span>}
            </p>
            <p className="text-[11px] text-stone-400 mt-0.5 truncate">
              {receiptBits.length > 0 ? receiptBits.join(' · ') : 'Not from a delivery'}
              <span className="text-stone-300"> · waiting {formatRelative(row.createdAt)}</span>
            </p>
          </div>
        </div>

        {/* Destination + actions */}
        <div className="flex items-center justify-between sm:justify-end gap-2 shrink-0">
          <p className="text-xs max-w-[16rem] sm:max-w-[20rem]">
            {bin ? (
              <LocationLabel
                location={bin}
                titleClassName="text-xs font-medium text-emerald-600"
                codeClassName="font-mono text-[10px] text-emerald-600/60"
              />
            ) : mismatch ? (
              <span className="inline-flex items-start gap-1 text-amber-600">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" aria-hidden="true" />
                <span className="truncate">{mismatch.label}</span>
              </span>
            ) : (
              <span className="text-amber-600">No eligible bin</span>
            )}
          </p>

          <div className="flex items-center gap-1.5">
            <button
              onClick={onToggleExplanation}
              className="p-1.5 rounded-lg hover:bg-stone-100 btn-press"
              aria-label={`Why this bin for ${name}?`}
            >
              <HelpCircle className="w-4 h-4 text-stone-400" />
            </button>
            <button
              onClick={onRerun}
              disabled={busy}
              className="p-1.5 rounded-lg hover:bg-stone-100 btn-press disabled:opacity-40"
              aria-label={`Re-run the recommendation for ${name}`}
              title="Ask the engine again"
            >
              <RefreshCw className="w-4 h-4 text-stone-400" />
            </button>
            <button
              onClick={onChooseBin}
              disabled={busy}
              className={`inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-lg btn-press disabled:opacity-40 ${
                mismatch
                  ? 'border border-amber-300 bg-amber-50 text-amber-700'
                  : 'border border-stone-200 text-stone-600'
              }`}
            >
              <MapPin className="w-3.5 h-3.5" /> Choose bin
            </button>
            {/* "Place now" is the pre-00080 one-step path, kept for desk and
                bulk work — notably the CSV opening-stock import, where nobody
                is going to walk hundreds of imaginary pallets. Deliberately the
                quieter of the two: the walk is the honest default. */}
            <button
              onClick={onPlaceNow}
              disabled={!row.recommendedLocationId || busy}
              title="Move the stock straight into the bin, without a walk"
              className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-lg border border-stone-200 text-stone-600 btn-press disabled:opacity-40"
            >
              <Check className="w-3.5 h-3.5" /> Place now
            </button>
            <button
              onClick={onAssign}
              disabled={!row.recommendedLocationId || busy}
              title="Send it to the walk — the stock stays on the dock until someone carries it"
              className="inline-flex items-center gap-1 text-xs px-2.5 py-1 bg-emerald-600 text-white rounded-lg btn-press disabled:opacity-40"
            >
              <Footprints className="w-3.5 h-3.5" /> Assign
            </button>
          </div>
        </div>
      </div>

      {expanded && (
        <div className="mt-3 pl-1">
          <PutawayExplanationCard explanation={row.explanation} binById={binById} />
        </div>
      )}
    </div>
  )
}

