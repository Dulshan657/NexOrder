// Segmented control for the grid overlay.
//
// The legend left this strip in NX-0047: on the 2D map it is a card ON the map
// (MapLegend, mounted by MapStage), next to the colours it explains. It is still
// drawn here in 3D, where MapStage — and so that card — is unmounted.

import type { OverlayKind, LegendEntry } from './warehouseOverlays'
import { MapLegend } from './MapLegend'

const OPTIONS: { kind: OverlayKind; label: string }[] = [
  { kind: 'none', label: 'None' },
  { kind: 'occupancy', label: 'Occupancy' },
  { kind: 'velocity', label: 'Velocity' },
  { kind: 'congestion', label: 'Congestion' },
  { kind: 'slotting', label: 'Slotting' },
  { kind: 'slotting_blocks', label: 'Blocks' },
  { kind: 'unswept', label: 'Codes' },
]

interface OverlayControlsProps {
  overlay: OverlayKind
  onChange: (overlay: OverlayKind) => void
  /** Draw the legend in this strip. True only while the 3D view is up; the 2D
   *  map carries its own. */
  inlineLegend?: boolean
  /** Legend rows for what the map shows besides the active overlay — storage
   *  forms, level roles, zone types. Supplied by the caller because only it
   *  knows which of those are actually present in this warehouse. Used only
   *  with `inlineLegend`. */
  extraEntries?: LegendEntry[]
}

export function OverlayControls({ overlay, onChange, inlineLegend = false, extraEntries = [] }: OverlayControlsProps) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="inline-flex flex-wrap rounded-lg border border-stone-200 bg-stone-100 p-0.5">
        {OPTIONS.map((o) => (
          <button
            key={o.kind}
            type="button"
            onClick={() => onChange(o.kind)}
            className={`touch-target-y rounded-md px-2.5 py-1 text-xs font-semibold transition-all ${
              overlay === o.kind ? 'bg-nexgen-blue text-white shadow-sm' : 'text-stone-600 hover:bg-stone-50 hover:text-stone-900'
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
      {inlineLegend && <MapLegend variant="inline" overlay={overlay} extraEntries={extraEntries} />}
    </div>
  )
}
