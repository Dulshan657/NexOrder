// What-if simulation results — replays real order picks through a target layout
// and (when the target isn't already active) diffs travel/utilization against the
// warehouse's active layout. Purely presentational; the edge function computed
// every number, this just makes it legible to the operator.

import type { SimulationKpiDiff, SimulationResult } from '@/types'

function KpiRow({ label, value, amber }: { label: string; value: string; amber?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-stone-500">{label}</span>
      <span className={`font-mono tabular-nums ${amber ? 'text-amber-600 font-semibold' : 'text-stone-700'}`}>{value}</span>
    </div>
  )
}

function TravelDelta({ diff }: { diff: SimulationKpiDiff }) {
  const pct = diff.travelDeltaPct
  // Less travel (negative delta) is better → green; more → red; ~zero → neutral.
  const neutral = Math.abs(diff.totalTravelDeltaM) < 1e-9
  const better = !neutral && (pct != null ? pct < 0 : diff.totalTravelDeltaM < 0)
  // A coverage warning means the lower travel is partly from NOT serving some
  // bins — don't paint it as a win.
  const tone = diff.coverageWarning
    ? 'text-amber-700 bg-amber-50 border-amber-100'
    : neutral
      ? 'text-stone-600 bg-stone-50 border-stone-200'
      : better
        ? 'text-emerald-700 bg-emerald-50 border-emerald-100'
        : 'text-red-700 bg-red-50 border-red-100'
  const pctLabel = pct != null ? `${pct > 0 ? '+' : ''}${pct.toFixed(1)}%` : '—'
  const absLabel = `${diff.totalTravelDeltaM > 0 ? '+' : ''}${diff.totalTravelDeltaM.toFixed(0)} m`
  const utilLabel =
    diff.utilizationDeltaPct != null
      ? `${diff.utilizationDeltaPct > 0 ? '+' : ''}${diff.utilizationDeltaPct.toFixed(0)}%`
      : '—'

  return (
    <div className={`p-2 rounded-lg border ${tone}`}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-medium">Travel vs active layout</span>
        <span className="font-mono tabular-nums text-sm font-semibold">{pctLabel}</span>
      </div>
      <div className="mt-1 flex items-center justify-between gap-2 text-[11px] opacity-80">
        <span className="font-mono tabular-nums">{absLabel}</span>
        <span>utilization {utilLabel}</span>
      </div>
      {diff.coverageWarning && (
        <p className="mt-1 text-[11px]">⚠ Some racks are unplaced in this layout — the travel drop is partly uncounted stops, not a like-for-like saving.</p>
      )}
    </div>
  )
}

interface SimulationResultCardProps {
  result: SimulationResult
  /** 'card' (default) keeps today's bordered/shadowed shell — used by the Layout
   *  Designer. 'flat' drops the border/bg/shadow for when this already sits
   *  inside another panel (e.g. the Warehouse test bench), so it isn't a
   *  card-in-card. */
  variant?: 'card' | 'flat'
}

export function SimulationResultCard({ result, variant = 'card' }: SimulationResultCardProps) {
  const { params, kpis, diff } = result
  const util = kpis.utilizationPct != null ? `${(kpis.utilizationPct * 100).toFixed(0)}%` : '—'
  const congested = kpis.congestionByNode.slice(0, 5)
  const shellClass =
    variant === 'flat'
      ? 'space-y-3 text-xs'
      : 'space-y-3 text-xs rounded-lg border border-stone-200 bg-white p-3 shadow-card'

  return (
    <div className={shellClass}>
      <p className="text-sm font-semibold text-stone-800">
        What-if simulation
        <span className="ml-1 font-normal text-stone-500">
          · {params.orderCount} orders over {params.days}d
        </span>
      </p>

      {diff ? <TravelDelta diff={diff} /> : (
        <p className="text-stone-500 bg-stone-50 border border-stone-100 rounded-lg px-2 py-1.5">
          This is the active layout (no baseline to compare).
        </p>
      )}

      <div className="space-y-1.5">
        <KpiRow label="Total travel" value={`${kpis.totalTravelM.toFixed(0)} m`} />
        <KpiRow label="Avg travel / order" value={`${kpis.avgTravelPerOrderM.toFixed(1)} m`} />
        <KpiRow label="Utilization (current fill)" value={util} />
        <KpiRow label="Racks used" value={`${kpis.binsUsed}/${kpis.binsTotal}`} />
        <KpiRow label="Unreachable stops" value={`${kpis.unreachableStops}`} amber={kpis.unreachableStops > 0} />
      </div>

      <p className="text-[11px] text-stone-500">
        Replays historical picks with today's slotting; travel reflects layout geometry, not re-slotting.
      </p>

      {congested.length > 0 && (
        <div className="space-y-1">
          <p className="text-stone-500 font-medium">Top congested nodes</p>
          <ul className="space-y-0.5">
            {congested.map((c) => (
              <li key={c.graphNodeId} className="text-stone-500">
                node #{c.graphNodeId} <span className="text-stone-500">· {c.visits} visits</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
