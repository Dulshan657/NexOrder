// Shown on the receipt card when putaway could not read a product's home bin
// (NX-0032). The receipt is booked; what is missing is the putaway tasks, and
// none are guessed: stock must go to a product's home bin, and the home could
// not be read. Retry sends the lines receive-stock returned (base units, plate,
// hold flag) to recommend-putaway, which creates the tasks.
//
// Mounted only when there is an error to show: it owns a mutation, and the
// receipt card is otherwise free of one.

import React from 'react'
import { AlertTriangle, RefreshCw } from 'lucide-react'
import type { PutawayLineRecommendation } from '../../../types'
import type { PutawayLineInput } from '../../../services/supabase/putawayService'
import { useRetryReceiptPutaway } from '../../../hooks/queries/usePutawayRecommendation'

interface PutawayRetryNoticeProps {
  /** What receive-stock said, e.g. "Home bin unavailable, try again." */
  message: string
  warehouseId: number
  receiptId: number | null
  /** The lines receive-stock tried. Empty = nothing to retry with. */
  lines: PutawayLineInput[]
  /** The retry made the tasks; these are their suggestions. */
  onPlaced: (recommendations: PutawayLineRecommendation[]) => void
}

export function PutawayRetryNotice({ message, warehouseId, receiptId, lines, onPlaced }: PutawayRetryNoticeProps) {
  const retry = useRetryReceiptPutaway()

  const run = () => {
    retry.mutate(
      { warehouseId, lines, goodsReceiptId: receiptId ?? undefined },
      { onSuccess: (res) => onPlaced(res.mode === 'engine' ? res.recommendations : []) },
    )
  }

  // A failed retry says why in the server's words; until then, what receive-stock said.
  const shown = retry.isError ? retry.error.message : message

  return (
    <div role="alert" className="glass-card rounded-xl border-l-4 border-amber-500 p-4 sm:p-5">
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-stone-900">{shown}</p>
          <p className="text-sm text-stone-600">
            The receipt is saved. Putaway tasks have not been created yet.
          </p>
        </div>
      </div>
      {lines.length > 0 && (
        <div className="mt-4">
          <button
            type="button"
            onClick={run}
            disabled={retry.isPending}
            className="btn-press inline-flex min-h-[44px] items-center gap-1.5 rounded-lg bg-nexgen-blue px-4 text-sm font-semibold text-white disabled:opacity-60"
          >
            <RefreshCw className={`h-4 w-4 ${retry.isPending ? 'animate-spin' : ''}`} aria-hidden="true" />
            {retry.isPending ? 'Retrying…' : 'Retry'}
          </button>
        </div>
      )}
    </div>
  )
}

export default PutawayRetryNotice
