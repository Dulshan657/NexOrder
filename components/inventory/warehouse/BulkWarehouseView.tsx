// Fallback for warehouses with no published grid layout (bulk sites, or racked
// sites not yet published): a plain stock list grouped by location. No map,
// overlays, routes, or simulation — those need a published spatial layout.

import { Info } from 'lucide-react'
import { useWarehouseViewerModel } from './useWarehouseViewerModel'
import { StockTable } from './StockTable'
import { LocationLabel } from '@/components/inventory/LocationLabel'

interface BulkWarehouseViewProps {
  warehouseId: number
  reason: 'bulk' | 'unpublished'
}

export function BulkWarehouseView({ warehouseId, reason }: BulkWarehouseViewProps) {
  const model = useWarehouseViewerModel(warehouseId, null)

  // Iterate every stock-holding location (bins AND the warehouse root, where
  // bulk stock lives), resolving a label from the tree or falling back to root.
  const locationsWithStock = Array.from(model.binContents.entries())
    .filter(([, rows]) => rows.length > 0)
    .map(([locId, rows]) => {
      const loc = model.locationsById.get(locId)
      return {
        id: locId,
        code: loc?.code ?? (locId === warehouseId ? 'ROOT' : `#${locId}`),
        name: loc?.name ?? (locId === warehouseId ? 'Warehouse root' : ''),
        rows,
      }
    })
    .sort((a, b) => a.code.localeCompare(b.code))

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-2 rounded-lg border border-sky-100 bg-sky-50 px-3 py-2 text-xs text-sky-800">
        <Info className="mt-0.5 h-4 w-4 shrink-0" />
        <span>
          {reason === 'bulk'
            ? 'Bulk warehouse — stock is tracked without a rack-level grid, so there is no map or intelligence overlays for this site.'
            : 'This warehouse has no published layout yet. Publish one from the layout designer to unlock the grid map and overlays.'}
        </span>
      </div>

      {model.isLoading ? (
        <div className="space-y-3">
          <span className="sr-only">Loading stock…</span>
          {Array.from({ length: 3 }, (_, i) => (
            <div key={i} aria-hidden="true" className="glass-card rounded-xl p-3">
              <div className="mb-2 flex items-center gap-2">
                <div className="wh-shimmer h-3 w-14" />
                <div className="wh-shimmer h-3 w-28" />
              </div>
              <div className="space-y-1.5">
                {Array.from({ length: 3 }, (_, j) => (
                  <div key={j} className="wh-shimmer h-6 w-full" />
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : locationsWithStock.length === 0 ? (
        <p className="glass-card rounded-xl p-8 text-center text-xs text-stone-500">No stock recorded at this warehouse.</p>
      ) : (
        <div className="space-y-3">
          {locationsWithStock.map((loc) => (
            <div key={loc.id} className="glass-card rounded-xl p-3">
              <div className="mb-2 flex items-center gap-2">
                <LocationLabel
                  location={loc}
                  layout="inline"
                  titleClassName="text-xs font-semibold text-stone-900"
                />
              </div>
              <StockTable rows={loc.rows} showAllocated />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
