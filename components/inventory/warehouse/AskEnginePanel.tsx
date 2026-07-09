// Docks the existing read-only WarehouseTestBench as a bottom-right "Ask the
// engine" pill that expands into a floating panel. WarehouseTestBench's
// internals are untouched — it already renders its own read-only/dry-run
// header, so the expanded shell only adds a slim title bar with a collapse
// button on top of it (an accepted card-in-card, same trade-off the plan
// takes for SimulationResultCard nested elsewhere in the test bench).

import { useState } from 'react'
import { FlaskConical, X } from 'lucide-react'
import type { PutawayResponse } from '@/services/supabase/putawayService'
import { WarehouseTestBench } from './WarehouseTestBench'

export interface AskEnginePanelProps {
  /** Positioning classes from the caller, e.g. "md:absolute md:bottom-4 md:right-4 md:z-20". */
  className?: string
  warehouseId: number
  layoutId: number
  onPutawayResult: (r: PutawayResponse | null) => void
  routeOrderIds: string[]
  onRouteOrderIdsChange: (ids: string[]) => void
}

export function AskEnginePanel({
  className = '',
  warehouseId,
  layoutId,
  onPutawayResult,
  routeOrderIds,
  onRouteOrderIdsChange,
}: AskEnginePanelProps) {
  const [open, setOpen] = useState(false)

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-expanded={false}
        className={`map-panel-pill inline-flex items-center gap-2 px-4 py-2.5 text-xs font-semibold text-stone-700 btn-press hover:text-nexgen-blue ${className}`}
      >
        <FlaskConical className="h-4 w-4 text-nexgen-blue" />
        Ask the engine
      </button>
    )
  }

  return (
    <div
      className={`map-panel wh-panel-in flex w-full flex-col md:w-96 md:max-h-[calc(100%-2rem)] ${className}`}
    >
      <div className="flex shrink-0 items-center justify-between rounded-t-xl border-b border-stone-200/80 px-3 py-2">
        <div className="flex items-center gap-2">
          <FlaskConical className="h-4 w-4 text-nexgen-blue" />
          <span className="text-sm font-semibold text-stone-900">Ask the engine</span>
        </div>
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="Collapse Ask the engine panel"
          className="grid h-6 w-6 shrink-0 place-items-center rounded-md text-stone-400 hover:bg-stone-100 hover:text-stone-900 btn-press"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        <WarehouseTestBench
          warehouseId={warehouseId}
          layoutId={layoutId}
          onPutawayResult={onPutawayResult}
          routeOrderIds={routeOrderIds}
          onRouteOrderIdsChange={onRouteOrderIdsChange}
        />
      </div>
    </div>
  )
}
