// The progress rail across the top of an open Walk stop: identify, bin, count.
//
// Replaces the old inline chip row: at 360px a row of pill-shaped chips wrapped
// onto two lines as soon as an accepted code was echoed into it, and the echo was
// the useful part. Presentational; PutawayStopCard decides which stages a task has.

import React from 'react'
import { Check } from 'lucide-react'

export interface RailStage {
  key: string
  label: string
  /** The code the operator has proved at this stage, echoed once it is done. */
  value: string
}

interface StopProgressRailProps {
  /** The stages this task actually has, in order. */
  stages: ReadonlyArray<RailStage>
  /** Every stage a task can have, in order: how far along `step` is. */
  order: ReadonlyArray<string>
  step: string
}

export const StopProgressRail: React.FC<StopProgressRailProps> = ({ stages, order, step }) => {
  const currentStage = order.indexOf(step)
  return (
    <ol
      aria-label="Putaway progress"
      className="flex items-stretch divide-x divide-nexgen-blue/15 border-b border-nexgen-blue/20 bg-white/70"
    >
      {stages.map((stage) => {
        const done = order.indexOf(stage.key) < currentStage
        const isNow = stage.key === step
        return (
          <li
            key={stage.key}
            aria-current={isNow ? 'step' : undefined}
            /* `nexgen-blue-dark`, not `nexgen-blue`: white on the brand blue is
               3.70:1 and only survives as a DISCLOSED exception, while the dark
               shade measures 4.93:1 and simply passes. Same reasoning as the
               focus ring. */
            className={`min-w-0 flex-1 px-2 py-2 text-center ${
              isNow ? 'bg-nexgen-blue-dark text-white' : done ? 'text-emerald-700' : 'text-stone-600'
            }`}
          >
            <span className="flex items-center justify-center gap-1 text-xs font-semibold">
              {done && <Check className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />}
              <span className="truncate">{stage.label}</span>
            </span>
            {done && stage.value && (
              <span className="mt-0.5 block truncate font-mono text-xs text-emerald-700">{stage.value}</span>
            )}
          </li>
        )
      })}
    </ol>
  )
}
