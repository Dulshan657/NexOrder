// Three steps, as a rail rather than three flat buttons.
//
// Same contract as RecodeStepRail: the rail is NOT a gate. Every node stays a
// button and every step stays reachable, because an operator who wants to change
// the selection after reading the rule step should not walk backwards to do it.
// What the rail adds is which questions are SETTLED — the thing three identical
// text buttons could not say.

import { Fragment } from 'react'
import { Check } from 'lucide-react'
import type { SlotStep } from './useSlotSelection'

const STEPS: ReadonlyArray<{ n: 1 | 2 | 3; label: string }> = [
  { n: 1, label: 'Select' },
  { n: 2, label: 'Name' },
  { n: 3, label: 'Rule' },
]

export interface SlotSatisfaction {
  1: boolean
  2: boolean
  3: boolean
}

export interface SlotStepRailProps {
  step: SlotStep
  satisfaction: SlotSatisfaction
  onGotoStep: (step: SlotStep) => void
}

export function SlotStepRail({ step, satisfaction, onGotoStep }: SlotStepRailProps) {
  return (
    <nav aria-label="Slotting block steps" className="shrink-0 border-b border-stone-200/80 px-4 pb-3 pt-2.5">
      <ol className="flex items-start">
        {STEPS.map((s, i) => {
          const current = step === s.n
          const settled = satisfaction[s.n]
          return (
            // Fragment takes the key: `key` cannot be passed to a typed local
            // component in this repo — with no @types/react there is no global JSX
            // namespace, so it is checked against the component's own props.
            <Fragment key={s.n}>
              <li className="flex min-w-0 flex-col items-center gap-1">
                <button
                  type="button"
                  onClick={() => onGotoStep(s.n)}
                  aria-current={current ? 'step' : undefined}
                  className={
                    'flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-semibold btn-press transition-colors ' +
                    (current
                      ? 'bg-nexgen-blue text-white'
                      : settled
                        ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200'
                        : 'bg-stone-100 text-stone-600 hover:bg-stone-200')
                  }
                >
                  {settled && !current ? <Check className="h-3 w-3" strokeWidth={2.5} /> : s.n}
                </button>
                <span
                  className={
                    'text-[11px] font-medium ' + (current ? 'text-stone-700' : 'text-stone-500')
                  }
                >
                  {s.label}
                </span>
              </li>
              {i < STEPS.length - 1 && (
                <li aria-hidden="true" className="mt-3 h-px flex-1 bg-stone-200">
                  <div
                    className="h-full bg-emerald-300 transition-[width] duration-300"
                    style={{ width: settled ? '100%' : '0%' }}
                  />
                </li>
              )}
            </Fragment>
          )
        })}
      </ol>
    </nav>
  )
}

export default SlotStepRail
