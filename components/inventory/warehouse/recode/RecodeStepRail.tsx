// The four steps, as a rail rather than four flat buttons.
//
// The rail is NOT a gate: every node stays a button and every step stays reachable,
// which is deliberate — an operator who wants to change the numbering after seeing
// the review should not have to walk backwards through two steps to do it. What the
// rail adds is the thing four identical text buttons could not say: which questions
// are settled. See `stepSatisfaction` for why that is the only honest meaning of
// "done" in a flow with no gating.
//
// A step that is both current AND settled draws as CURRENT. Where you are is the
// more useful fact, and the connector to its right already fills to show the rest.

import { Fragment } from 'react'
import { Check } from 'lucide-react'
import type { RecodeStep } from './useRecodeSelection'
import type { StepSatisfaction } from './recodePlanView'

const STEPS: ReadonlyArray<{ n: 1 | 2 | 3 | 4; label: string }> = [
  { n: 1, label: 'Select' },
  { n: 2, label: 'Block' },
  { n: 3, label: 'Numbering' },
  { n: 4, label: 'Review' },
]

export interface RecodeStepRailProps {
  step: RecodeStep
  satisfaction: StepSatisfaction
  onGotoStep: (step: RecodeStep) => void
}

export function RecodeStepRail({ step, satisfaction, onGotoStep }: RecodeStepRailProps) {
  return (
    <nav aria-label="Recode steps" className="shrink-0 border-b border-stone-200/80 px-4 pb-3 pt-2.5">
      <ol className="flex items-start">
        {STEPS.map((s, i) => {
          const current = step === s.n
          const settled = satisfaction[s.n]
          return (
            // Fragment takes the key because `key` cannot be passed to a typed local
            // component in this repo — with no @types/react there is no global JSX
            // namespace, so it is checked against the component's own props.
            <Fragment key={s.n}>
              {i > 0 && (
                <li aria-hidden="true" className="mt-[10px] h-0.5 min-w-2 flex-1 rounded-full bg-stone-200">
                  <span
                    className={`rc-rail-fill block h-full rounded-full bg-emerald-400 ${
                      satisfaction[STEPS[i - 1].n] ? 'w-full' : 'w-0'
                    }`}
                  />
                </li>
              )}
              <li className="flex shrink-0 basis-[4.25rem] flex-col items-center">
                <button
                  type="button"
                  onClick={() => onGotoStep(s.n)}
                  aria-current={current ? 'step' : undefined}
                  aria-label={`Step ${s.n}, ${s.label}${settled ? ', done' : ''}`}
                  className="group flex w-full flex-col items-center gap-1.5 rounded-lg py-0.5 btn-press focus:outline-none focus-visible:ring-2 focus-visible:ring-nexgen-blue/40"
                >
                  <span
                    className={`flex h-[22px] w-[22px] items-center justify-center rounded-full border text-[11px] font-semibold tabular-nums transition-colors ${
                      current
                        ? 'border-nexgen-blue bg-white text-nexgen-blue ring-2 ring-nexgen-blue/20'
                        : settled
                          ? 'border-emerald-400 bg-emerald-400 text-white'
                          : 'border-stone-200 bg-stone-100 text-stone-400 group-hover:border-stone-300 group-hover:text-stone-500'
                    }`}
                  >
                    {settled && !current ? <Check className="h-3 w-3" strokeWidth={3} aria-hidden="true" /> : s.n}
                  </span>
                  <span
                    className={`text-[11px] font-medium leading-none ${
                      current ? 'text-nexgen-blue' : settled ? 'text-stone-600' : 'text-stone-400'
                    }`}
                  >
                    {s.label}
                  </span>
                </button>
              </li>
            </Fragment>
          )
        })}
      </ol>
    </nav>
  )
}
