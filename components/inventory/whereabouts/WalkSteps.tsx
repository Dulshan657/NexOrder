// A walk from the dock as numbered steps (NX-0039): the handheld's map.

import type { ProductWalk } from '@/services/supabase/productWhereaboutsService'

export interface WalkStepsProps {
  /** Accessible name, e.g. "Put away walk". */
  title: string
  walk: ProductWalk | null
  /** Said when there is no walk, e.g. "No stock to pick." */
  empty: string
}

export function WalkSteps({ title, walk, empty }: WalkStepsProps) {
  if (!walk || walk.stops.length === 0) {
    return (
      <div className="text-xs">
        <p className="font-semibold text-stone-700">{title}</p>
        <p className="text-stone-600">{empty}</p>
      </div>
    )
  }
  return (
    <div className="text-xs">
      <p className="font-semibold text-stone-700">
        {title} <span className="font-normal text-stone-600">· {Math.round(walk.totalDistanceM)} m from the dock</span>
      </p>
      <ol aria-label={title} className="mt-1 space-y-0.5 font-mono text-stone-800">
        <li className="text-stone-600">Start at the dock</li>
        {walk.steps.map((s) => <li key={s}>{s}</li>)}
      </ol>
      {walk.unreachableCount > 0 && (
        <p className="mt-1 text-amber-700">
          {walk.unreachableCount} bin{walk.unreachableCount === 1 ? '' : 's'} could not be reached on the layout.
        </p>
      )}
    </div>
  )
}
