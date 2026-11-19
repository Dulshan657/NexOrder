// Ask the engine → Pick route: how would these orders be walked? The engine's
// sequenced walk (recommend-pick-route), drawn on the map along the aisles
// (NX-0037). Read-only.

import { useMemo } from 'react'
import { Check } from 'lucide-react'
import { usePickQueue } from '@/hooks/queries/usePickQueue'
import { PickRoutePanel } from '@/components/inventory/PickRoutePanel'

const MAX_ROUTE_ORDERS = 3

export interface PickRouteTabProps {
  warehouseId: number
  routeOrderIds: string[]
  onChange: (ids: string[]) => void
}

export function PickRouteTab({ warehouseId, routeOrderIds, onChange }: PickRouteTabProps) {
  const { data: queue } = usePickQueue()
  const orders = useMemo(
    () => (queue ?? []).filter((o) => o.fulfilmentWarehouseIds.includes(warehouseId)),
    [queue, warehouseId],
  )

  const toggle = (orderId: string) => {
    if (routeOrderIds.includes(orderId)) onChange(routeOrderIds.filter((id) => id !== orderId))
    else if (routeOrderIds.length < MAX_ROUTE_ORDERS) onChange([...routeOrderIds, orderId])
  }

  if (orders.length === 0) {
    return <p className="text-xs text-stone-600">No orders waiting to be picked at this warehouse.</p>
  }

  return (
    <div className="space-y-2 text-xs">
      <p className="text-stone-600">Choose up to {MAX_ROUTE_ORDERS} orders to walk together:</p>
      <ul className="max-h-40 divide-y divide-stone-100 overflow-auto rounded-lg ring-1 ring-stone-200">
        {orders.map((o) => {
          const on = routeOrderIds.includes(o.orderId)
          return (
            <li key={o.orderId}>
              <button
                type="button"
                aria-pressed={on}
                onClick={() => toggle(o.orderId)}
                className={`flex w-full items-center gap-2 px-3 py-1.5 text-left btn-press ${
                  on ? 'bg-nexgen-blue/10 text-nexgen-blue' : 'text-stone-700 hover:bg-stone-50'
                }`}
              >
                <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded ring-1 ${on ? 'bg-nexgen-blue ring-nexgen-blue' : 'ring-stone-300'}`}>
                  {on && <Check className="h-3 w-3 text-white" aria-hidden="true" />}
                </span>
                <span className="font-mono">{o.orderId.slice(0, 12)}</span>
                <span className="ml-auto truncate text-stone-600">{o.horecaName}</span>
              </button>
            </li>
          )
        })}
      </ul>
      {routeOrderIds.length > 0 && <PickRoutePanel warehouseId={warehouseId} orderIds={routeOrderIds} />}
    </div>
  )
}
