// One (location × lot) slot for a product, as a single-render grid row.
//
// This was a `<td colSpan={5}>` wrapping a second 6-column `<table>` inside a
// row of the first one — a table nested in a sideways-scrolling table, which at
// 360px is two scroll axes over the one fact the operator came for. It could
// not be fixed in place: a `<div>` is not a valid child of `<tr>`, so the inner
// grid had to stay inside a `<td>` and inherit the outer table's sizing. Both
// tables went, together, or neither could.
//
// ONE RENDER, TWO LAYOUTS. Every control appears exactly once; only the grid
// template changes. Two parallel trees would mean every later edit to a cell
// has to be made twice, and the second one is the one that gets forgotten.

import React from 'react'
import { MapPin, SlidersHorizontal } from 'lucide-react'
import type { ProductBatchBalance } from '../../services/supabase/inventoryService'
import { locationTitle } from '@/lib/locationDisplay'
import { BatchMicroLabel, OPS_BATCH_ROW_COLUMNS } from './stockRowColumns'

export interface BatchSlotRowProps {
  balance: ProductBatchBalance
  /** Admin/Manager only — Warehouse reads this screen but corrects stock
   *  through Stocktake, which posts a counted variance rather than a delta. */
  canAdjust: boolean
  onAdjust: (balance: ProductBatchBalance) => void
  productName: string
}

export function BatchSlotRow({ balance, canAdjust, onAdjust, productName }: BatchSlotRowProps) {
  const place = locationTitle({ code: balance.locationCode ?? 'MAIN', name: balance.locationName })
  const lot = balance.lotCode ? `lot ${balance.lotCode}` : 'untracked'

  return (
    <div
      className={
        'grid grid-cols-1 gap-y-2 px-3 py-2.5 ' +
        `@min-[660px]:items-center @min-[660px]:gap-x-3 @min-[660px]:gap-y-0 ${OPS_BATCH_ROW_COLUMNS}`
      }
    >
      {/* Identity. `min-w-0` is what lets the truncate inside actually bite. */}
      <div className="min-w-0">
        <span className="flex items-center gap-1 text-sm text-stone-900">
          <MapPin className="w-3.5 h-3.5 shrink-0 text-stone-600" aria-hidden="true" />
          <span className="truncate font-medium">{place}</span>
        </span>
        <span className="mt-0.5 block truncate text-xs text-stone-600">{lot}</span>
      </div>

      {/* Below 660 these wrap into their own grid; at and above it the wrapper
          becomes `contents` and they flatten into cells 2-6 of the row itself.
          Span classes therefore need the container variant to opt back out. */}
      <div className="grid grid-cols-3 gap-x-3 gap-y-2 @min-[660px]:contents">
        <div className="col-span-3 @min-[660px]:col-auto">
          <BatchMicroLabel>Expiry</BatchMicroLabel>
          <span className="block text-sm text-stone-600 tabular-nums">{balance.expiryDate ?? '—'}</span>
        </div>

        <div className="@min-[660px]:text-right">
          <BatchMicroLabel>On hand</BatchMicroLabel>
          <span className="block font-mono text-sm text-stone-700 tabular-nums">{balance.onHand}</span>
        </div>

        <div className="@min-[660px]:text-right">
          <BatchMicroLabel>Allocated</BatchMicroLabel>
          <span className="block font-mono text-sm text-stone-600 tabular-nums">{balance.allocated}</span>
        </div>

        <div className="@min-[660px]:text-right">
          <BatchMicroLabel>Available</BatchMicroLabel>
          <span className="block font-mono text-sm font-semibold text-stone-900 tabular-nums">
            {balance.available}
          </span>
        </div>

        {canAdjust && (
          <div className="col-span-3 @min-[660px]:col-auto @min-[660px]:text-right">
            <button
              type="button"
              onClick={() => onAdjust(balance)}
              // The accessible name has to carry the slot: a screen full of
              // buttons all called "Adjust" tells a screen-reader user which
              // action they are taking but not to what.
              aria-label={`Adjust ${productName} at ${place}, ${lot}`}
              className="touch-target-y inline-flex w-full items-center justify-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-nexgen-blue-dark hover:bg-nexgen-blue/10 btn-press @min-[660px]:w-auto"
            >
              <SlidersHorizontal className="w-3.5 h-3.5" aria-hidden="true" /> Adjust
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

export default BatchSlotRow
