// Pre-publish re-slot planner. When an operator publishes a new layout for a
// warehouse that already holds stock, this modal computes the optimal re-allocation
// of that stock into the new bins (full putaway scoring, capacity-aware splitting),
// lets the operator override any destination per line, and — on approval — publishes
// and hands the moves back to become a physical relocation worklist. Publishing is
// blocked here until the plan is feasible (no overflow) and approved.

import { useEffect, useMemo, useState } from 'react'
import { ArrowRight, Loader2, TriangleAlert, PackageCheck, Shuffle } from 'lucide-react'
import { Button, Modal } from '@/components/ui'
import { usePlanReslot } from '@/hooks/queries/useReslotPlan'
import type { CommitMove } from '@/services/supabase/reslotService'
import type { ReslotMove } from '@/services/supabase/reslotService'
import type { Warehouse } from '@/types'

interface ReslotPlannerModalProps {
  warehouse: Warehouse
  layoutId: number
  publishing: boolean
  onCancel: () => void
  /** Approve: caller publishes the layout, then writes these moves as a worklist. */
  onApprove: (moves: CommitMove[]) => void
}

export function ReslotPlannerModal({ warehouse, layoutId, publishing, onCancel, onApprove }: ReslotPlannerModalProps) {
  const plan = usePlanReslot()
  // Editable destination override per move, keyed by move index.
  const [overrides, setOverrides] = useState<Record<number, number>>({})

  useEffect(() => {
    plan.mutate(layoutId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layoutId])

  const data = plan.data
  const moves = data?.moves ?? []
  const hasOverflow = (data?.overflow.length ?? 0) > 0
  const feasible = !!data && !hasOverflow

  const commitMoves = useMemo<CommitMove[]>(
    () =>
      moves.map((m, i) => ({
        product_id: m.productId,
        from_location_id: m.fromLocationId,
        to_location_id: overrides[i] ?? m.toLocationId,
        qty: m.qty,
      })),
    [moves, overrides],
  )

  const binLabel = (id: number) => data?.bins.find((b) => b.locationId === id)?.code ?? `#${id}`
  const topFactor = (m: ReslotMove) =>
    [...(m.breakdown?.factors ?? [])].sort((a, b) => b.weighted - a.weighted)[0]?.detail ?? ''

  // The plan itself is recomputed on open, so the only state worth guarding is a
  // destination the operator has hand-overridden.
  const hasOverrides = Object.keys(overrides).length > 0

  return (
    <Modal
      open
      onClose={onCancel}
      size="3xl"
      dirty={hasOverrides}
      discardConfirm={{ title: 'Discard overrides?', message: 'Your hand-picked destinations will be lost.' }}
      icon={<Shuffle className="h-4 w-4 text-nexgen-blue" />}
      title="Re-slot existing stock"
      description={`${warehouse.name} — review where stock moves in the new layout, then publish.`}
      footer={({ requestClose }) => (
        <>
          <Button variant="ghost" onClick={requestClose} disabled={publishing}>
            Cancel
          </Button>
          <Button
            onClick={() => onApprove(commitMoves)}
            loading={publishing}
            disabled={!feasible}
            title={!feasible ? 'Resolve capacity before publishing' : moves.length ? 'Publish and create the relocation worklist' : 'Publish'}
          >
            {moves.length > 0 ? 'Approve & publish' : 'Publish'}
          </Button>
        </>
      )}
    >
      {plan.isPending && (
        <div className="flex items-center justify-center gap-2 py-12 text-sm text-stone-500">
          <Loader2 className="h-4 w-4 animate-spin" /> Computing the optimal re-allocation…
        </div>
      )}

      {plan.isError && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          Couldn't compute the plan: {plan.error?.message}
        </div>
      )}

      {data && (
        <>
          {/* Capacity feasibility banner */}
          <div
            className={`mb-3 flex items-start gap-2 rounded-lg border px-3 py-2 text-xs ${
              feasible ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-amber-300 bg-amber-50 text-amber-900'
            }`}
          >
            {feasible ? <PackageCheck className="mt-0.5 h-4 w-4 shrink-0" /> : <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />}
            <div>
              <p className="font-semibold">
                {feasible
                  ? moves.length === 0
                    ? 'No relocation needed — all stock stays in bins the new layout keeps.'
                    : `Plan fits: ${moves.length} move${moves.length === 1 ? '' : 's'} into the new layout.`
                  : "Not enough capacity — some stock can't be placed. Add more bins/capacity, then re-open."}
              </p>
              <p className="mt-0.5">
                Needs {data.capacity.requiredSlots.toFixed(0)} slots · {data.capacity.providedFreeSlots.toFixed(0)} free
                {data.capacity.hasUncapped ? ' (+ uncapped bins)' : ''}
              </p>
            </div>
          </div>

          {/* Moves table */}
          {moves.length > 0 && (
            <div className="overflow-hidden rounded-lg border border-stone-200">
              <table className="w-full text-xs">
                <thead className="bg-stone-50 text-stone-500">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">Product</th>
                    <th className="px-3 py-2 text-right font-medium">Qty</th>
                    <th className="px-3 py-2 text-left font-medium">From</th>
                    <th className="px-3 py-2 text-left font-medium">To (override)</th>
                    <th className="px-3 py-2 text-left font-medium">Why</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {moves.map((m, i) => (
                    <tr key={i}>
                      <td className="px-3 py-2">
                        <p className="font-medium text-stone-800">{m.productName}</p>
                        <p className="font-mono text-[10px] text-stone-400">{m.productCode}</p>
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-stone-700">{m.qty}</td>
                      <td className="px-3 py-2 font-mono text-stone-500">{binLabel(m.fromLocationId)}</td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-1">
                          <ArrowRight className="h-3 w-3 shrink-0 text-stone-400" />
                          <select
                            value={overrides[i] ?? m.toLocationId}
                            onChange={(e) => setOverrides((o) => ({ ...o, [i]: Number(e.target.value) }))}
                            className="max-w-[120px] rounded border border-stone-200 bg-white px-1.5 py-1 font-mono text-[11px] text-emerald-700"
                          >
                            {data.bins.map((b) => (
                              <option key={b.locationId} value={b.locationId}>{b.code}</option>
                            ))}
                          </select>
                        </div>
                      </td>
                      <td className="px-3 py-2 text-stone-500">{topFactor(m)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Overflow */}
          {hasOverflow && (
            <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              <p className="font-semibold">Couldn't place all stock:</p>
              {data.overflow.map((o) => (
                <p key={o.productId}>• {o.productName} — {o.qty} unit(s) with no bin. Add capacity and re-open.</p>
              ))}
            </div>
          )}

          {/* Reserved (stays in place) */}
          {data.reserved.length > 0 && (
            <div className="mt-3 rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 text-[11px] text-stone-500">
              <p className="font-semibold text-stone-600">Reserved stock stays put (moves after its order clears):</p>
              {data.reserved.slice(0, 6).map((r, i) => (
                <p key={i}>• {r.productName} — {r.qty} unit(s) in {binLabel(r.locationId)}</p>
              ))}
              {data.reserved.length > 6 && <p>…and {data.reserved.length - 6} more</p>}
            </div>
          )}
        </>
      )}
    </Modal>
  )
}
