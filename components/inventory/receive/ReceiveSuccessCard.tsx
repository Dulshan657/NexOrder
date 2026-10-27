// What the dock sees the moment a receipt is recorded (NX-0005): what went in,
// the label sheet already rendered and one tap from printing, then putaway.
//
// It replaces the staged lines rather than sitting under them. The old layout
// appended labels and putaway suggestions BELOW the receipt and the recent
// receipts, so the next step was a scroll away from where the operator's eyes
// were — and on the handheld, below a bottom-pinned bar.

import React, { useEffect, useRef, useState } from 'react'
import { ArrowRight, CheckCircle2, ChevronDown, RotateCcw } from 'lucide-react'
import type { PutawayLineRecommendation } from '../../../types'
import { ReceiptPlateLabels } from './ReceiptPlateLabels'
import { PutawayPanel } from '../PutawayPanel'

export interface ReceivedSummary {
  receiptId: number | null
  linesReceived: number
  /** "148 carton · 3 each" — the totals as they were at submit. */
  units: string
  destName: string | undefined
  /** Where the stock landed; drives Go to putaway. */
  warehouseId: number | null
  recommendations: PutawayLineRecommendation[]
}

interface ReceiveSuccessCardProps {
  summary: ReceivedSummary
  productNameById: ReadonlyMap<number, string>
  onOpenPutaway?: (warehouseId: number) => void
  onStartNext: () => void
}

export function ReceiveSuccessCard({
  summary, productNameById, onOpenPutaway, onStartNext,
}: ReceiveSuccessCardProps) {
  const [showSuggestions, setShowSuggestions] = useState(false)
  const rootRef = useRef<HTMLElement | null>(null)

  // Bring the card into view: the receipt it replaces may have been scrolled
  // far down. Optional call — jsdom implements no scrolling at all.
  useEffect(() => {
    rootRef.current?.scrollIntoView?.({ block: 'start', behavior: 'smooth' })
  }, [summary.receiptId])

  const { linesReceived, units, destName, warehouseId, recommendations } = summary

  return (
    <section ref={rootRef} aria-label="Receipt recorded" className="space-y-4">
      <div className="glass-card rounded-xl border-l-4 border-emerald-500 p-4 sm:p-5">
        <div className="flex items-start gap-3">
          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-semibold text-stone-900">
              Received {linesReceived} line{linesReceived === 1 ? '' : 's'}
              {units ? ` · ${units}` : ''}
            </h2>
            <p className="text-sm text-stone-600">Into {destName ?? 'the selected warehouse'}. Label it, then put it away.</p>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {onOpenPutaway && warehouseId != null && (
            <button
              type="button"
              onClick={() => onOpenPutaway(warehouseId)}
              className="btn-press inline-flex min-h-[44px] items-center gap-1.5 rounded-lg bg-nexgen-blue px-4 text-sm font-semibold text-white"
            >
              Go to putaway <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </button>
          )}
          <button
            type="button"
            onClick={onStartNext}
            className="btn-press inline-flex min-h-[44px] items-center gap-1.5 rounded-lg border border-stone-300 bg-white px-4 text-sm font-medium text-stone-700 hover:bg-stone-50"
          >
            <RotateCcw className="h-4 w-4" aria-hidden="true" /> Start next delivery
          </button>
        </div>
      </div>

      {/* Mounted only once a receipt exists: the panel owns a query and a
          mutation, and running both against no receipt is work for nothing. */}
      {summary.receiptId != null && <ReceiptPlateLabels goodsReceiptId={summary.receiptId} autoRender />}

      {warehouseId != null && recommendations.length > 0 && (
        <div className="glass-card rounded-xl">
          <button
            type="button"
            onClick={() => setShowSuggestions((v) => !v)}
            aria-expanded={showSuggestions}
            className="btn-press touch-target-y flex w-full items-center gap-2 px-4 py-3 text-left text-sm font-semibold text-stone-700 hover:bg-stone-50"
          >
            <ChevronDown
              className={`h-4 w-4 text-stone-600 transition-transform ${showSuggestions ? 'rotate-180' : ''}`}
              aria-hidden="true"
            />
            Suggested locations ({recommendations.length})
          </button>
          {showSuggestions && (
            <div className="border-t border-stone-100 p-3">
              <PutawayPanel
                warehouseId={warehouseId}
                recommendations={recommendations}
                productNameById={productNameById as Map<number, string>}
              />
            </div>
          )}
        </div>
      )}
    </section>
  )
}

export default ReceiveSuccessCard
