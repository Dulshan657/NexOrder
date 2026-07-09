// Shared product/on-hand/allocated table for the Warehouse viewer. One visual
// treatment (bordered wrapper, stone-50 header) used by both the bin detail
// panel (with the ABC pill column) and the bulk stock list (without it), so
// the same underlying data never renders two different ways.

import type { VelocityClass } from '@/types'
import type { BinContentRow } from './useWarehouseViewerModel'

export interface StockTableProps {
  rows: BinContentRow[]
  showAbc?: boolean
  showAllocated?: boolean
  emptyLabel?: string
}

const CLASS_TONE: Record<VelocityClass, string> = {
  A: 'bg-rose-100 text-rose-700',
  B: 'bg-amber-100 text-amber-700',
  C: 'bg-sky-100 text-sky-700',
}

export function StockTable({
  rows,
  showAbc = false,
  showAllocated = false,
  emptyLabel = 'No stock recorded.',
}: StockTableProps) {
  if (rows.length === 0) {
    return <p className="rounded-lg bg-stone-50 py-3 text-center text-xs text-stone-400">{emptyLabel}</p>
  }

  return (
    <div className="overflow-hidden rounded-lg border border-stone-100">
      <table className="w-full text-xs">
        <thead className="bg-stone-50 text-[10px] uppercase tracking-wide text-stone-400">
          <tr>
            <th className="px-2 py-1.5 text-left font-semibold">Product</th>
            <th className="px-2 py-1.5 text-right font-semibold">On hand</th>
            {showAllocated && <th className="px-2 py-1.5 text-right font-semibold">Alloc</th>}
            {showAbc && <th className="px-2 py-1.5 text-center font-semibold">ABC</th>}
          </tr>
        </thead>
        <tbody className="divide-y divide-stone-100">
          {rows.map((r) => (
            <tr key={r.productId}>
              <td className="px-2 py-1.5 text-stone-700">{r.productName ?? `#${r.productId}`}</td>
              <td className="px-2 py-1.5 text-right font-mono tabular-nums text-stone-700">{r.onHand}</td>
              {showAllocated && (
                <td className="px-2 py-1.5 text-right font-mono tabular-nums text-stone-400">{r.allocated}</td>
              )}
              {showAbc && (
                <td className="px-2 py-1.5 text-center">
                  {r.velocityClass ? (
                    <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${CLASS_TONE[r.velocityClass]}`}>
                      {r.velocityClass}
                    </span>
                  ) : (
                    <span className="text-stone-300">—</span>
                  )}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
