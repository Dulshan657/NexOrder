// Three-pill KPI strip (Bins / Empty / Utilization), floated top-left over the
// map by RackedWorkspace. Extracted from the former inline `KpiStrip` in
// WarehousePage.tsx — logic unchanged; the pill surface swaps `.glass-card`
// (bg-white/70, designed for sitting on the page background) for
// `.map-panel-pill` (bg-white/90) since it now floats directly over live map
// colors and needs to stay legible there.

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
    <div className="flex gap-2">
      {items.map((i) => (
        <div key={i.label} className="map-panel-pill px-3 py-1.5 text-center">
          <p className="font-mono text-sm font-semibold text-stone-900">{i.value}</p>
          <p className="text-[10px] uppercase tracking-wide text-stone-400">{i.label}</p>
        </div>
      ))}
    </div>
  )
}
