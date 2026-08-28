// One SKU on a count sheet: what the system holds, what the operator counted,
// and what that difference will do.
//
// Sized for a phone in an aisle — a card, not a table row — because this is the
// screen someone uses standing in front of racking. The count box is the only
// thing on the card that can be typed into, and it is deliberately large.

import React from 'react'
import { AlertTriangle, Info } from 'lucide-react'
import {
  describeLineResult,
  describeSlots,
  distinctLotsOf,
  entryStatus,
  parseCountedQty,
  predictedRefusal,
  systemQtyOf,
  type CountLineResult,
  type CountSheetLine,
} from '@/lib/binCount'

interface CountLineRowProps {
  line: CountSheetLine
  value: string
  onChange: (value: string) => void
  disabled?: boolean
  /** The server's answer for this line, once a count has been posted. */
  result?: CountLineResult
}

const STATUS_STYLE: Record<string, string> = {
  match: 'bg-stone-100 text-stone-600',
  surplus: 'bg-emerald-50 text-emerald-700 border border-emerald-200',
  shortfall: 'bg-amber-50 text-amber-700 border border-amber-200',
  invalid: 'bg-red-50 text-red-700 border border-red-200',
}

export const CountLineRow: React.FC<CountLineRowProps> = ({
  line,
  value,
  onChange,
  disabled,
  result,
}) => {
  const systemQty = systemQtyOf(line.slots)
  const status = entryStatus(line, value)
  // The REQUESTED variance, not the plannable one. Reading it off the plan
  // meant a line the planner refused had no delta at all and the chip rendered
  // the string "null" — the operator still needs to see what they counted.
  const counted = parseCountedQty(value)
  const delta = typeof counted === 'number' ? counted - systemQty : null
  const refusal = predictedRefusal(line, value)
  // A posted line's own message wins over the live prediction — the server has
  // spoken, and its numbers are the current ones.
  const serverNote = result ? describeLineResult(result, distinctLotsOf(line)) : null

  const chip =
    status === 'blank' ? null
      : status === 'invalid' ? 'whole numbers only'
        : status === 'match' ? 'matches'
          : `${delta != null && delta > 0 ? '+' : ''}${delta}`

  return (
    <li
      className={`rounded-xl border px-3 py-2.5 ${
        result && !result.ok ? 'border-red-200 bg-red-50/40' : 'border-stone-200 bg-white'
      }`}
    >
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="font-mono text-xs font-semibold text-stone-900">{line.sku}</p>
          <p className="truncate text-sm text-stone-700">{line.name}</p>
          <p className="mt-0.5 text-[11px] text-stone-500">{describeSlots(line.slots)}</p>
        </div>

        <div className="shrink-0 text-right">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-stone-500">System</p>
          <p className="font-mono text-lg tabular-nums text-stone-900">{systemQty}</p>
        </div>

        <div className="shrink-0">
          <label className="block text-[10px] font-semibold uppercase tracking-wide text-stone-500" htmlFor={`count-${line.productId}`}>
            Counted
          </label>
          <input
            id={`count-${line.productId}`}
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            autoComplete="off"
            value={value}
            disabled={disabled}
            onChange={(e) => onChange(e.target.value)}
            placeholder="—"
            aria-label={`Counted quantity for ${line.sku}`}
            className="mt-0.5 w-20 rounded-lg border border-stone-300 px-2 py-2 text-right font-mono text-lg tabular-nums focus:border-nexgen-blue focus:outline-none focus:ring-2 focus:ring-nexgen-blue/30 disabled:bg-stone-50"
          />
        </div>
      </div>

      {chip && (
        <span className={`mt-2 inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums ${STATUS_STYLE[status] ?? ''}`}>
          {chip}
        </span>
      )}

      {/* The surplus-attribution note is information, not a problem — it says
          where the extra units were booked, which the operator cannot otherwise
          tell. The refusal is a problem and reads as one. */}
      {serverNote && (
        <p className={`mt-2 flex items-start gap-1.5 text-[11px] ${result?.ok ? 'text-stone-500' : 'text-red-700'}`}>
          {result?.ok
            ? <Info className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            : <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" strokeWidth={2.5} aria-hidden="true" />}
          <span>{serverNote}</span>
        </p>
      )}

      {!serverNote && refusal && (
        <p className="mt-2 flex items-start gap-1.5 text-[11px] text-amber-700">
          <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" strokeWidth={2.5} aria-hidden="true" />
          <span>{refusal}</span>
        </p>
      )}
    </li>
  )
}
