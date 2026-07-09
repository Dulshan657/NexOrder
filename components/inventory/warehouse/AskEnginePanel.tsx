// Docks the existing read-only WarehouseTestBench as a plain "Ask the engine"
// card in the panel row below the map. WarehouseTestBench's internals are
// untouched — it already renders its own read-only/dry-run header and three
// collapsible sections (Putaway open by default), so this only adds a slim
// card title on top of it.

import { FlaskConical } from 'lucide-react'
import type { PutawayResponse } from '@/services/supabase/putawayService'
import { WarehouseTestBench } from './WarehouseTestBench'

export interface AskEnginePanelProps {
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
  return (
    <div className={`glass-card flex flex-col rounded-xl ${className}`}>
      <div className="flex shrink-0 items-center gap-2 border-b border-stone-200/80 px-3 py-2">
        <FlaskConical className="h-4 w-4 text-nexgen-blue" />
        <span className="text-sm font-semibold text-stone-900">Ask the engine</span>
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
