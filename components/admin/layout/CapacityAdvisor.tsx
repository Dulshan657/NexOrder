// Live capacity advisor for the layout designer. As the operator draws bins, it
// compares the slots they've provided against the slots the warehouse's current
// stock needs, and — when short — tells them the minimum extra bins to add so the
// layout can actually hold the stock before they try to publish.

import { PackageCheck, TriangleAlert } from 'lucide-react'
import { STORAGE_UNIT } from './labels'

interface CapacityAdvisorProps {
  /** Σ onHand × sizeFactor of the warehouse's current stock. */
  requiredSlots: number
  /** Σ capacity_slots of the bins drawn on the canvas. */
  providedSlots: number
  /** Number of bins drawn (for the "add ~N bins" estimate). */
  binCount: number
  hasStock: boolean
  loading?: boolean
}

export function CapacityAdvisor({ requiredSlots, providedSlots, binCount, hasStock, loading }: CapacityAdvisorProps) {
  if (loading) {
    return <div className="h-16 rounded-xl border border-stone-200 bg-white animate-pulse" />
  }
  if (!hasStock) {
    return (
      <div className="rounded-xl border border-stone-200 bg-white p-3">
        <p className="text-xs font-semibold text-stone-700">Capacity</p>
        <p className="mt-1 text-[11px] text-stone-500">No stock in this warehouse yet — no capacity constraint.</p>
      </div>
    )
  }

  const sufficient = providedSlots >= requiredSlots - 1e-6
  const deficit = Math.max(0, requiredSlots - providedSlots)
  const pct = requiredSlots > 0 ? Math.min(100, (providedSlots / requiredSlots) * 100) : 100
  const typicalBin = binCount > 0 ? providedSlots / binCount : 0
  const extraBins = deficit > 0 && typicalBin > 0 ? Math.ceil(deficit / typicalBin) : 0

  return (
    <div className={`rounded-xl border p-3 ${sufficient ? 'border-emerald-200 bg-emerald-50/40' : 'border-amber-300 bg-amber-50/60'}`}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold text-stone-700">Capacity</p>
        {sufficient ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
            <PackageCheck className="h-3 w-3" /> Fits
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 rounded-full bg-amber-200 px-2 py-0.5 text-[10px] font-semibold text-amber-800">
            <TriangleAlert className="h-3 w-3" /> Short
          </span>
        )}
      </div>

      <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-stone-200">
        <div className={`h-full ${sufficient ? 'bg-emerald-500' : 'bg-amber-500'}`} style={{ width: `${pct}%` }} />
      </div>
      <p className="mt-1.5 text-[11px] text-stone-600">
        {providedSlots.toFixed(0)} of {requiredSlots.toFixed(0)} slots needed for current stock
      </p>
      {!sufficient && (
        <p className="mt-1 text-[11px] font-medium text-amber-800">
          Short by {deficit.toFixed(0)} slots — add {extraBins > 0 ? `~${extraBins} more ${extraBins === 1 ? STORAGE_UNIT.lower : STORAGE_UNIT.lowerPlural}` : 'more storage'} or increase bin capacity.
        </p>
      )}
    </div>
  )
}
