// "Suggested pick route" — an additive advisory card in the pick workspace.
// The engine (recommend-pick-route) computes an optimal bin-walk order for the
// order's allocated stock. Warehouses without a published layout return a
// 'legacy' result (or no stops) and this renders nothing, so it never clutters
// non-layout sites. Purely presentational; matches PutawayExplanationCard.

import { usePickRoute } from '@/hooks/queries/usePickRoute'

interface PickRoutePanelProps {
  warehouseId: number | null
  orderIds: string[]
}

export function PickRoutePanel({ warehouseId, orderIds }: PickRoutePanelProps) {
  const { data, isLoading } = usePickRoute(warehouseId, orderIds)

  if (isLoading) {
    return <p className="text-xs text-stone-400 py-2">computing route…</p>
  }

  // Legacy warehouses (no layout) show nothing. But a route with only off-route
  // (unplaced) bins still surfaces the warning — that's the signal an operator
  // needs when the layout is stale, so only bail when there's truly nothing.
  if (!data || data.mode === 'legacy') return null
  const { stops, totalDistanceM, unreachableCount } = data.route
  if (stops.length === 0 && unreachableCount === 0) return null

  if (stops.length === 0) {
    return (
      <p className="my-2 text-[11px] text-amber-600">
        {unreachableCount} allocated bin{unreachableCount === 1 ? '' : 's'} not placed in the current layout — no route available.
      </p>
    )
  }

  return (
    <div className="my-2 p-3 rounded-lg bg-emerald-50 border border-emerald-100 text-xs">
      <div className="flex items-center justify-between mb-2">
        <p className="font-medium text-emerald-800">Suggested pick route</p>
        <span className="font-mono text-emerald-700">{totalDistanceM.toFixed(1)} m</span>
      </div>
      <ol className="space-y-1">
        {stops.map((stop) => (
          <li key={stop.sequence} className="flex items-center gap-2 text-stone-600">
            <span className="font-mono text-emerald-700 shrink-0">#{stop.sequence}</span>
            <span className="font-medium text-stone-700 shrink-0">{stop.code ?? '—'}</span>
            <span className="text-stone-400">·</span>
            <span className="font-mono text-stone-600">{stop.qtyBase} units</span>
            <span className="text-stone-400">·</span>
            <span className="font-mono text-stone-400">+{stop.legDistanceM.toFixed(1)} m</span>
          </li>
        ))}
      </ol>
      {unreachableCount > 0 && (
        <p className="mt-2 text-[11px] text-amber-600">
          {unreachableCount} allocated bin{unreachableCount === 1 ? '' : 's'} off-route
        </p>
      )}
    </div>
  )
}
