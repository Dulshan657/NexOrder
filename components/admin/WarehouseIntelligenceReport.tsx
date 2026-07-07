import { useMemo, type ReactNode } from 'react'
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts'
import { useWarehouseReport } from '@/hooks/queries/useWarehouseReport'
import type { WarehouseReport } from '@/types'

interface WarehouseIntelligenceReportProps {
  warehouseId: number
}

// ABC velocity classes — fast movers (A) green → slow movers (C) stone.
const ABC_SEGMENTS: { key: string; label: string; color: string }[] = [
  { key: 'A', label: 'A · fast', color: '#10b981' }, // emerald-500
  { key: 'B', label: 'B · medium', color: '#f59e0b' }, // amber-500
  { key: 'C', label: 'C · slow', color: '#a8a29e' }, // stone-400
]

// Ordered status rows so the panel reads accepted → suggested → the rest.
const PUTAWAY_STATUSES = ['accepted', 'overridden', 'suggested', 'expired'] as const
const SLOTTING_STATUSES = ['accepted', 'suggested', 'rejected'] as const

function StatRow({ counts, statuses }: { counts: Record<string, number>; statuses: readonly string[] }) {
  return (
    <ul className="space-y-1.5">
      {statuses.map((status) => (
        <li key={status} className="flex items-center justify-between text-xs">
          <span className="capitalize text-stone-500">{status}</span>
          <span className="font-mono font-semibold text-stone-800">{counts[status] ?? 0}</span>
        </li>
      ))}
    </ul>
  )
}

function VelocityDonut({ velocity }: { velocity: Record<string, number> }) {
  const chartData = useMemo(
    () =>
      ABC_SEGMENTS.map((s) => ({ name: s.label, value: velocity[s.key] ?? 0, color: s.color })).filter(
        (d) => d.value > 0,
      ),
    [velocity],
  )
  const total = chartData.reduce((sum, d) => sum + d.value, 0)

  if (total === 0) {
    return (
      <div className="flex h-[140px] items-center justify-center text-xs text-stone-400">
        no pick history yet
      </div>
    )
  }

  return (
    <div className="flex items-center gap-4">
      <div className="relative h-[140px] w-[140px] shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={chartData}
              dataKey="value"
              nameKey="name"
              cx="50%"
              cy="50%"
              innerRadius="60%"
              outerRadius="92%"
              paddingAngle={2}
              stroke="none"
            >
              {chartData.map((d) => (
                <Cell key={d.name} fill={d.color} />
              ))}
            </Pie>
            <Tooltip
              formatter={(value: number, name: string) => [`${value} SKUs`, name]}
              contentStyle={{ borderRadius: 8, border: '1px solid #e7e5e4', fontSize: 12 }}
            />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="font-mono text-lg font-bold text-stone-900">{total}</span>
          <span className="text-[9px] uppercase tracking-wider text-stone-400">SKUs</span>
        </div>
      </div>
      <ul className="space-y-1.5">
        {ABC_SEGMENTS.map((s) => (
          <li key={s.key} className="flex items-center justify-between gap-4 text-xs">
            <span className="flex items-center gap-2 text-stone-600">
              <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: s.color }} />
              {s.label}
            </span>
            <span className="font-mono font-semibold text-stone-900">{velocity[s.key] ?? 0}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-lg border border-stone-200 bg-stone-50/60 p-3">
      <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-stone-400">{title}</p>
      {children}
    </div>
  )
}

function ReportBody({ report }: { report: WarehouseReport }) {
  const occupiedBins = report.binCount - report.emptyBins
  const sim = report.latestSimulation

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <Card title="Utilization">
        <div className="flex items-baseline gap-2">
          <span className="font-mono text-3xl font-bold text-stone-900">
            {report.utilizationPct != null ? `${(report.utilizationPct * 100).toFixed(0)}%` : '—'}
          </span>
          <span className="text-xs text-stone-500">space used (current fill)</span>
        </div>
        <p className="mt-1 font-mono text-xs text-stone-600">
          {occupiedBins}/{report.binCount} bins occupied
        </p>
      </Card>

      <Card title="Velocity mix (ABC)">
        <VelocityDonut velocity={report.velocity} />
      </Card>

      <Card title="Putaway (30d)">
        <StatRow counts={report.putaway} statuses={PUTAWAY_STATUSES} />
      </Card>

      <Card title="Slotting suggestions">
        <StatRow counts={report.slotting} statuses={SLOTTING_STATUSES} />
      </Card>

      {report.congestion.length > 0 && (
        <Card title="Top congested nodes">
          <ul className="space-y-1.5">
            {report.congestion.slice(0, 8).map((c) => (
              <li key={c.node} className="flex items-center justify-between text-xs">
                <span className="text-stone-500">node #{c.node}</span>
                <span className="font-mono font-semibold text-stone-800">{c.visits} visits</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card title="Latest simulation">
        {sim ? (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="text-stone-500">Total travel</span>
              <span className="font-mono font-semibold text-stone-800">{sim.kpis.totalTravelM.toFixed(0)} m</span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-stone-500">Avg / order</span>
              <span className="font-mono font-semibold text-stone-800">
                {sim.kpis.avgTravelPerOrderM.toFixed(1)} m
              </span>
            </div>
            {sim.diff?.travelDeltaPct != null && (
              <div className="flex items-center justify-between text-xs">
                <span className="text-stone-500">Travel Δ vs baseline</span>
                <span
                  className={`font-mono font-semibold ${
                    sim.diff.travelDeltaPct < 0 ? 'text-emerald-600' : 'text-stone-800'
                  }`}
                >
                  {sim.diff.travelDeltaPct > 0 ? '+' : ''}
                  {sim.diff.travelDeltaPct.toFixed(1)}%
                </span>
              </div>
            )}
          </div>
        ) : (
          <p className="text-xs text-stone-400">no simulations run</p>
        )}
      </Card>
    </div>
  )
}

/**
 * Compact Warehouse Intelligence analytics rollup for one warehouse — utilization,
 * ABC velocity mix, putaway/slotting decision counts, congestion hotspots, and the
 * latest travel simulation. Reads the `wie_warehouse_report` RPC.
 */
export function WarehouseIntelligenceReport({ warehouseId }: WarehouseIntelligenceReportProps) {
  const { data: report, isLoading, isError, error } = useWarehouseReport(warehouseId)

  if (isLoading) {
    return <div className="py-6 text-center text-xs text-stone-400">Loading analytics…</div>
  }

  if (isError) {
    return (
      <div className="py-6 text-center text-xs text-red-500">
        {error instanceof Error ? error.message : 'Failed to load analytics.'}
      </div>
    )
  }

  if (!report) {
    return <div className="py-6 text-center text-xs text-stone-400">No analytics available yet.</div>
  }

  return <ReportBody report={report} />
}

export default WarehouseIntelligenceReport
