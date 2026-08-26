// Three-pill KPI strip (Bins / Empty / Utilization), rendered in the page
// header beside the title + warehouse picker (WarehousePage.tsx). Extracted
// from the former inline `KpiStrip` in WarehousePage.tsx — logic unchanged.
// Uses `.glass-card` since it sits on the page background, not over the map.

import { useWarehouseReport } from '@/hooks/queries/useWarehouseReport'

interface KpiStripProps {
  warehouseId: number
}

export function KpiStrip({ warehouseId }: KpiStripProps) {
  const { data: report } = useWarehouseReport(warehouseId)
  if (!report) return null
  const util = report.utilizationPct != null ? `${Math.round(report.utilizationPct * 100)}%` : '—'
  const items = [
    { label: 'Bins', value: report.binCount },
    { label: 'Empty', value: report.emptyBins },
    { label: 'Utilization', value: util },
  ]
  return (
    <div className="flex flex-wrap gap-2">
      {items.map((i) => (
        <div key={i.label} className="glass-card rounded-lg px-3 py-1.5 text-center">
          <p className="font-mono text-sm font-semibold text-stone-900">{i.value}</p>
          <p className="text-[10px] uppercase tracking-wide text-stone-400">{i.label}</p>
        </div>
      ))}
    </div>
  )
}
