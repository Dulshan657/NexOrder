// What happens after Apply.
//
// Two things the old flow left the operator to work out alone:
//
//  1. THE STICKERS ARE NOW WRONG. A recode resets `label_printed` — correct, the
//     sticker on the beam names a code that no longer exists — but the operator was
//     told only a count, in a toast, that disappeared. The label job for exactly
//     these bins is one button away instead.
//  2. THE ORIGIN CORNER WAS THE OTHER ONE. That is only obvious once the codes are
//     on screen, which is after Apply. Reverting puts every code back.

import { CheckCircle2, Printer, Undo2, Repeat } from 'lucide-react'

export interface RecodeSuccessPanelProps {
  recoded: number
  levels: number
  labelPrintedReset: number
  block: string
  reverting: boolean
  /** False once the sweep has been reverted, or if the record could not be kept. */
  canRevert: boolean
  onPrintLabels: () => void
  onRevert: () => void
  onSweepAnother: () => void
  onDone: () => void
}

export function RecodeSuccessPanel({
  recoded, levels, labelPrintedReset, block, reverting, canRevert,
  onPrintLabels, onRevert, onSweepAnother, onDone,
}: RecodeSuccessPanelProps) {
  return (
    <div className="flex flex-col gap-3">
      <p className="flex items-start gap-2 text-sm text-stone-800">
        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" strokeWidth={2.5} />
        <span>
          <strong className="font-semibold">{recoded}</strong> bin{recoded === 1 ? '' : 's'} recoded
          as <span className="font-mono">{block}</span>
          {levels > 0 && <> · {levels} rack level{levels === 1 ? '' : 's'} followed</>}
        </span>
      </p>

      {labelPrintedReset > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50/70 p-3">
          <p className="text-[11px] text-amber-900">
            <strong className="font-semibold">{labelPrintedReset} label{labelPrintedReset === 1 ? '' : 's'} are now out of date.</strong>{' '}
            The stickers on those bays name codes that no longer exist.
          </p>
          <button
            type="button"
            onClick={onPrintLabels}
            className="mt-2 flex items-center gap-1.5 rounded-lg bg-stone-900 px-2.5 py-1.5 text-[11px] font-medium text-white btn-press"
          >
            <Printer className="h-3.5 w-3.5" strokeWidth={2} />
            Print the new labels
          </button>
        </div>
      )}

      <div className="flex flex-wrap gap-1.5">
        <button
          type="button"
          onClick={onSweepAnother}
          className="flex items-center gap-1.5 rounded-lg border border-stone-200 bg-white px-2.5 py-1.5 text-xs font-medium text-stone-600 btn-press hover:bg-stone-50"
        >
          <Repeat className="h-3.5 w-3.5" strokeWidth={2} /> Sweep another block
        </button>
        {canRevert && (
          <button
            type="button"
            onClick={onRevert}
            disabled={reverting}
            className="flex items-center gap-1.5 rounded-lg border border-stone-200 bg-white px-2.5 py-1.5 text-xs font-medium text-stone-600 btn-press hover:bg-stone-50 disabled:opacity-40"
          >
            <Undo2 className="h-3.5 w-3.5" strokeWidth={2} />
            {reverting ? 'Reverting…' : 'Revert this sweep'}
          </button>
        )}
        <button
          type="button"
          onClick={onDone}
          className="ml-auto rounded-lg px-2.5 py-1.5 text-xs font-medium text-stone-500 btn-press hover:text-stone-700"
        >
          Done
        </button>
      </div>
    </div>
  )
}
