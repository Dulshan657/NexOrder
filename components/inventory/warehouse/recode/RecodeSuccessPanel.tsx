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
//
// The four actions used to be four identical grey outlines, which buried the one the
// amber card had just told the operator to press. They are ranked now: Print is
// primary and lives inside the card that argues for it, Revert is a ghost because it
// is the rare correction rather than the expected next step.

import { CheckCircle2, Printer, Undo2, Repeat } from 'lucide-react'
import { Button, Callout } from '@/components/ui'

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
    <div className="flex flex-col gap-4">
      {/* --po-i staggers this against the two blocks below it, reusing the PO Inbox
          cascade rather than minting a third entrance keyframe. */}
      <div
        className="po-row-in flex flex-col items-center py-2 text-center"
        style={{ '--po-i': 0 } as any}
      >
        <span className="po-pop-in flex h-11 w-11 items-center justify-center rounded-full bg-emerald-50 ring-1 ring-emerald-200">
          <CheckCircle2 className="h-6 w-6 text-emerald-600" strokeWidth={2} aria-hidden="true" />
        </span>
        <p className="mt-2.5 font-display text-2xl font-semibold leading-none tabular-nums text-stone-900">
          {recoded}
        </p>
        <p className="mt-1 text-xs leading-relaxed text-stone-500">
          bin{recoded === 1 ? '' : 's'} recoded as{' '}
          <span className="rounded bg-stone-100 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-stone-700">
            {block}
          </span>
          {levels > 0 && <> · {levels} rack level{levels === 1 ? '' : 's'} followed</>}
        </p>
      </div>

      {labelPrintedReset > 0 && (
        <div className="po-row-in" style={{ '--po-i': 1 } as any}>
          <Callout
            tone="warning"
            title={`${labelPrintedReset} label${labelPrintedReset === 1 ? '' : 's'} are now out of date`}
            action={
              <Button size="sm" onClick={onPrintLabels} icon={<Printer className="h-3.5 w-3.5" strokeWidth={2} />}>
                Print the new labels
              </Button>
            }
          >
            The stickers on those bays name codes that no longer exist.
          </Callout>
        </div>
      )}

      <div className="po-row-in flex flex-wrap items-center gap-2" style={{ '--po-i': 2 } as any}>
        <Button
          variant="secondary"
          size="sm"
          onClick={onSweepAnother}
          icon={<Repeat className="h-3.5 w-3.5" strokeWidth={2} />}
        >
          Sweep another block
        </Button>
        {canRevert && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onRevert}
            disabled={reverting}
            icon={<Undo2 className="h-3.5 w-3.5" strokeWidth={2} />}
            className="text-stone-500"
          >
            {reverting ? 'Reverting…' : 'Revert this sweep'}
          </Button>
        )}
        <Button variant="ghost" size="sm" onClick={onDone} className="ml-auto">
          Done
        </Button>
      </div>
    </div>
  )
}
