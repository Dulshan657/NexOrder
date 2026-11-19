// Ask the engine → Simulate: replay the last N days of picks against this
// layout (wie-simulate). Read-only.

import { useState } from 'react'
import type { SimulationResult } from '@/types'
import { useRunSimulation } from '@/hooks/queries/useSimulation'
import { SimulationResultCard } from '@/components/admin/layout/SimulationResultCard'

const WINDOWS = [7, 30, 90]

export function SimulateTab({ layoutId }: { layoutId: number }) {
  const [days, setDays] = useState(30)
  const sim = useRunSimulation()
  const result: SimulationResult | undefined = sim.data

  return (
    <div className="space-y-3 text-xs">
      <p className="text-stone-600">Replay past picks against this layout to see how far pickers would walk.</p>
      <div className="flex items-center gap-2">
        <div role="group" aria-label="History window" className="inline-flex rounded-lg bg-stone-100 p-0.5">
          {WINDOWS.map((d) => (
            <button
              key={d}
              type="button"
              aria-pressed={days === d}
              onClick={() => setDays(d)}
              className={`rounded-md px-2.5 py-1 font-semibold btn-press ${
                days === d ? 'bg-white text-nexgen-blue shadow-sm' : 'text-stone-700 hover:text-stone-900'
              }`}
            >
              {d} days
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => sim.mutate({ layoutId, days })}
          disabled={sim.isPending}
          className="ml-auto rounded-lg bg-nexgen-blue px-3 py-2 font-semibold text-white btn-press disabled:opacity-40"
        >
          {sim.isPending ? 'Simulating…' : 'Simulate'}
        </button>
      </div>
      {sim.isError && <p className="rounded-lg bg-red-50 px-3 py-2 text-red-700">Simulation failed. Try again.</p>}
      {result && <SimulationResultCard result={result} variant="flat" />}
    </div>
  )
}
