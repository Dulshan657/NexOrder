// Shown when the selected warehouse has no visual grid to render — either it's a
// legacy bulk site or a racked site whose layout isn't published yet. Rather than
// dropping to the stock list (which duplicates the Stock view), we lead with a
// visual CTA into the Layout Designer / floor-plan import, and keep the raw stock
// list one click away.

import { useState } from 'react'
import { LayoutGrid, PencilRuler, ImageUp, Table2 } from 'lucide-react'
import { BulkWarehouseView } from './BulkWarehouseView'

interface WarehouseEmptyStateProps {
  warehouseId: number
  warehouseName: string
  /** 'unpublished' = racked but no published layout; 'bulk' = legacy bulk site. */
  reason: 'bulk' | 'unpublished'
  /** Navigate into the Layout Designer for this warehouse (opens Settings). */
  onOpenDesigner?: (warehouseId: number, opts?: { import?: boolean }) => void
}

export function WarehouseEmptyState({
  warehouseId,
  warehouseName,
  reason,
  onOpenDesigner,
}: WarehouseEmptyStateProps) {
  const [showStock, setShowStock] = useState(false)

  const headline =
    reason === 'unpublished'
      ? 'This warehouse has a draft layout that isn’t published yet'
      : 'This warehouse isn’t mapped for the visual view yet'
  const sub =
    reason === 'unpublished'
      ? 'Publish its layout in the Layout Designer to see the grid, racks and intelligence overlays here.'
      : 'Design a layout — or import a floor plan — to turn ' + warehouseName + ' into a visual, rack-level warehouse.'

  if (showStock) {
    return (
      <div className="space-y-3">
        <button
          onClick={() => setShowStock(false)}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-nexgen-blue hover:underline btn-press"
        >
          <LayoutGrid className="h-3.5 w-3.5" /> Back to setup
        </button>
        <BulkWarehouseView warehouseId={warehouseId} reason={reason} />
      </div>
    )
  }

  return (
    <div className="glass-panel shadow-card mx-auto max-w-2xl rounded-2xl p-8 sm:p-10 text-center">
      <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600">
        <LayoutGrid className="h-7 w-7" />
      </div>
      <h2 className="text-lg font-semibold text-stone-900">{headline}</h2>
      <p className="mx-auto mt-2 max-w-md text-sm text-stone-500">{sub}</p>

      <div className="mt-7 flex flex-col items-stretch justify-center gap-3 sm:flex-row">
        <button
          onClick={() => onOpenDesigner?.(warehouseId)}
          disabled={!onOpenDesigner}
          className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-emerald-500 disabled:opacity-50 btn-press"
        >
          <PencilRuler className="h-4 w-4" /> Design a layout
        </button>
        <button
          onClick={() => onOpenDesigner?.(warehouseId, { import: true })}
          disabled={!onOpenDesigner}
          className="inline-flex items-center justify-center gap-2 rounded-xl border border-stone-200 bg-white px-5 py-2.5 text-sm font-semibold text-stone-700 hover:bg-stone-50 disabled:opacity-50 btn-press"
        >
          <ImageUp className="h-4 w-4 text-emerald-600" /> Import a floor plan
        </button>
      </div>

      <button
        onClick={() => setShowStock(true)}
        className="mt-6 inline-flex items-center gap-1.5 text-xs font-medium text-stone-500 hover:text-stone-700 hover:underline btn-press"
      >
        <Table2 className="h-3.5 w-3.5" /> View stock list instead
      </button>
    </div>
  )
}
