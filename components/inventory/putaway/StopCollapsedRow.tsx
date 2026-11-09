// A Walk stop that is not open: one tappable row. Presentational.

import React from 'react'
import { ArrowRight } from 'lucide-react'

interface StopCollapsedRowProps {
  sequence: number | null
  binCode: string
  name: string
  qtyPrimary: string
  huCode: string | null
  legDistanceM: number | null
  reachable: boolean
  disabled: boolean
  /** The line waits for someone's yes to its overflow bin (NX-0033). */
  awaitingConfirm: boolean
  onOpen: () => void
}

export const StopCollapsedRow: React.FC<StopCollapsedRowProps> = ({
  sequence, binCode, name, qtyPrimary, huCode, legDistanceM, reachable, disabled, awaitingConfirm, onOpen,
}) => (
  <button
    onClick={onOpen}
    disabled={disabled}
    className="touch-target-y flex items-center gap-3 w-full px-4 py-3 text-left hover:bg-stone-50/70 btn-press disabled:opacity-50 disabled:cursor-not-allowed"
  >
    <span className="w-8 h-8 shrink-0 rounded-full bg-stone-100 text-stone-600 text-xs font-mono font-semibold flex items-center justify-center tabular-nums">
      {sequence ?? '·'}
    </span>
    <span className="min-w-0 flex-1">
      {/* The DESTINATION leads, because the only question a collapsed row has
          to answer is "where am I taking this". The old row led with the
          product name and rendered the code at 10px on a 60%-opacity emerald
          — roughly 1.9:1 — which is the one string on the row that gets
          matched against a printed sticker. */}
      <span className="block font-mono text-sm font-semibold text-emerald-700 truncate">{binCode}</span>
      <span className="block text-xs text-stone-600 truncate">{name}</span>
      {/* A loose line whose home was full waits for someone to confirm its
          bin (NX-0033). Said on the row, so the walker knows before opening
          it that scanning this bin is a decision and not just a delivery. */}
      {awaitingConfirm && (
        <span className="mt-1 inline-block rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800">
          Home full — confirm
        </span>
      )}
    </span>
    <span className="shrink-0 text-right max-w-[38%] sm:max-w-none">
      <span className="block text-xs font-medium text-stone-700 tabular-nums">{qtyPrimary}</span>
      {huCode && <span className="block font-mono text-xs text-stone-600 truncate">{huCode}</span>}
      <span className="block text-xs text-stone-600 tabular-nums">
        {reachable
          ? legDistanceM != null ? `${Math.round(legDistanceM)}m` : ''
          : 'off the map'}
      </span>
    </span>
    <ArrowRight className="w-4 h-4 text-stone-400 shrink-0" aria-hidden="true" />
  </button>
)
