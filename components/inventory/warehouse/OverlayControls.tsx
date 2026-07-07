// Segmented control for the grid overlay + a legend for the active one.

import type { OverlayKind, LegendEntry } from './warehouseOverlays'
import { legendFor } from './warehouseOverlays'

const OPTIONS: { kind: OverlayKind; label: string }[] = [
  { kind: 'none', label: 'None' },
  { kind: 'occupancy', label: 'Occupancy' },
  { kind: 'velocity', label: 'Velocity' },
  { kind: 'congestion', label: 'Congestion' },
  { kind: 'slotting', label: 'Slotting' },
]

interface OverlayControlsProps {
  overlay: OverlayKind
  onChange: (overlay: OverlayKind) => void
}

function Legend({ entries }: { entries: LegendEntry[] }) {
  if (entries.length === 0) return null
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-stone-500">
      {entries.map((e, i) => (
        <span key={i} className="inline-flex items-center gap-1">
          <span className="inline-block h-3 w-3 rounded-sm border border-stone-200" style={{ backgroundColor: e.color }} />
          {e.label}
        </span>
      ))}
    </div>
  )
}

export function OverlayControls({ overlay, onChange }: OverlayControlsProps) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="inline-flex flex-wrap rounded-lg border border-stone-200 bg-stone-100 p-0.5">
        {OPTIONS.map((o) => (
          <button
            key={o.kind}
            type="button"
            onClick={() => onChange(o.kind)}
            className={`min-h-[30px] rounded-md px-2.5 py-1 text-xs font-semibold transition-all ${
              overlay === o.kind ? 'bg-nexgen-blue text-white shadow-sm' : 'text-stone-500 hover:bg-stone-50 hover:text-stone-900'
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
      <Legend entries={legendFor(overlay)} />
    </div>
  )
}
