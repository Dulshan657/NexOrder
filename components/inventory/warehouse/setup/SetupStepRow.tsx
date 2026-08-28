// One row of the warehouse setup checklist.
//
// Visual idiom follows components/admin/layout/PublishChecklist.tsx — the other
// derived checklist in this app — so the two read as the same kind of object.
// The differences are the four statuses (a publish gate has three) and the
// action button, which is what makes this a guide rather than a report.

import { CheckCircle2, CircleDashed, Circle, Lock, ArrowRight, Undo2 } from 'lucide-react'
import type { SetupStepState } from '@/lib/warehouseSetup/evaluate'

interface SetupStepRowProps {
  state: SetupStepState
  index: number
  /** Absent when the viewer's role cannot reach the step's target. */
  onNavigate?: () => void
  onAcknowledge?: () => void
  onRevoke?: () => void
  busy?: boolean
  /** Why the action is unavailable to this viewer, if it is. */
  blockedReason?: string
}

export function SetupStepRow({
  state,
  index,
  onNavigate,
  onAcknowledge,
  onRevoke,
  busy,
  blockedReason,
}: SetupStepRowProps) {
  const { step, status, evidence, blockedBy } = state
  const isSignoff = step.kind === 'signoff'

  // The prose is the entire point of M2 — it says WHY this step sits here in
  // the chain. Showing it on every row would drown the list, so it appears on
  // the step you are on and the ones telling you that you cannot start yet.
  const showWhy = status === 'current' || status === 'blocked'

  const icon =
    status === 'done' ? (
      <CheckCircle2 className="mt-px h-4 w-4 shrink-0 text-emerald-500" strokeWidth={2.5} />
    ) : status === 'current' ? (
      <Circle className="mt-px h-4 w-4 shrink-0 text-nexgen-blue" strokeWidth={2.5} />
    ) : status === 'blocked' ? (
      <Lock className="mt-px h-4 w-4 shrink-0 text-stone-300" strokeWidth={2.5} />
    ) : (
      <CircleDashed className="mt-px h-4 w-4 shrink-0 text-stone-300" strokeWidth={2.5} />
    )

  const titleClass =
    status === 'done'
      ? 'text-stone-500'
      : status === 'current'
        ? 'font-semibold text-stone-900'
        : status === 'blocked'
          ? 'text-stone-500'
          : 'text-stone-600'

  return (
    <li
      className={`flex items-start gap-2.5 rounded-lg px-2 py-2 ${
        status === 'current' ? 'bg-blue-50/60 ring-1 ring-inset ring-blue-100' : ''
      }`}
    >
      {icon}

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className="font-mono text-[10px] text-stone-500">{index}</span>
          <span className={`text-xs ${titleClass}`}>{step.title}</span>
          {evidence && (
            <span className="font-mono text-[10px] text-stone-500">· {evidence}</span>
          )}
        </div>

        {showWhy && (
          <p className="mt-1 text-[11px] leading-relaxed text-stone-500">{step.why}</p>
        )}

        {status === 'blocked' && blockedBy.length > 0 && (
          <p className="mt-1 text-[11px] font-medium text-stone-500">
            Waiting on: {blockedBy.join(', ')}
          </p>
        )}

        {(status === 'current' || status === 'todo') && (
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            {step.target && onNavigate && (
              <button
                type="button"
                onClick={onNavigate}
                className="inline-flex items-center gap-1 rounded-md border border-stone-200 bg-white px-2 py-1 text-[11px] font-medium text-stone-700 hover:bg-stone-50 btn-press"
              >
                {step.target.label} <ArrowRight className="h-3 w-3" strokeWidth={2.5} />
              </button>
            )}
            {isSignoff && onAcknowledge && (
              <button
                type="button"
                onClick={onAcknowledge}
                disabled={busy}
                className="inline-flex items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 text-[11px] font-medium text-emerald-700 hover:bg-emerald-100 disabled:opacity-50 btn-press"
              >
                <CheckCircle2 className="h-3 w-3" strokeWidth={2.5} /> Mark as done
              </button>
            )}
            {blockedReason && (
              <span className="text-[11px] text-stone-500">{blockedReason}</span>
            )}
          </div>
        )}

        {/* Undoing a sign-off matters: it is the only way to correct one made in
            error, and without it the honest move would be a database write. */}
        {status === 'done' && isSignoff && onRevoke && (
          <button
            type="button"
            onClick={onRevoke}
            disabled={busy}
            className="mt-1 inline-flex items-center gap-1 text-[11px] font-medium text-stone-500 hover:text-stone-600 hover:underline disabled:opacity-50 btn-press"
          >
            <Undo2 className="h-3 w-3" strokeWidth={2.5} /> Undo sign-off
          </button>
        )}
      </div>
    </li>
  )
}
