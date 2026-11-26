// What the map's colours mean (NX-0047).
//
// Two variants of one component, so the 2D map and the 3D view cannot disagree
// about a swatch:
//
//   - `map`: a frosted card docked bottom-left ON the map, where the colours it
//     explains are. It carries `data-map-control`, which is how the stage tells a
//     press on it from a press on the floor — without it, collapsing the legend
//     while Annotate is armed would paint the cells underneath.
//   - `inline`: a plain row, used beside the overlay switcher while the 3D view is
//     up. MapStage is unmounted in 3D, so the on-map card does not exist there.
//
// Occupancy is a continuous ramp on the map, so it is drawn as one gradient bar
// rather than as five swatches that would imply five classes.
//
// Text is 12px throughout: this is read at arm's length on a handheld.

import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import type { LegendEntry, OverlayKind } from './warehouseOverlays'
import { legendFor, occupancyFill, OCCUPANCY_GRADIENT_CSS } from './warehouseOverlays'

interface MapLegendProps {
  overlay: OverlayKind
  /** Rows for what the map shows besides the active overlay — storage forms,
   *  level roles, areas, zone types. Supplied by the caller, which is the only
   *  thing that knows which of those this warehouse actually contains. */
  extraEntries?: readonly LegendEntry[]
  variant?: 'map' | 'inline'
  /** Start collapsed — the handheld, where the card would cover a third of the map. */
  defaultCollapsed?: boolean
}

/** The two occupancy states the ramp itself cannot show. */
const OCCUPANCY_ASIDES: LegendEntry[] = [
  { color: occupancyFill(0), label: 'Empty' },
  { color: occupancyFill(null), label: 'No capacity' },
]

function Swatches({ entries }: { entries: readonly LegendEntry[] }) {
  // An unlabelled entry is a step in a scale (congestion's 2nd and 4th), so it
  // draws its swatch and no text rather than being dropped.
  return (
    <ul className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
      {entries.map((e, i) => (
        <li key={i} className="inline-flex items-center gap-1.5">
          <span
            className="inline-block h-3 w-3 shrink-0 rounded-[3px] ring-1 ring-inset ring-stone-900/15"
            style={{ backgroundColor: e.color }}
            aria-hidden="true"
          />
          {e.label}
        </li>
      ))}
    </ul>
  )
}

function OccupancyBar() {
  return (
    <div>
      <div
        className="h-2.5 w-full min-w-36 rounded-full ring-1 ring-inset ring-stone-900/15"
        style={{ backgroundImage: OCCUPANCY_GRADIENT_CSS }}
        role="img"
        aria-label="Occupancy, from 0% to 100% full"
      />
      <div className="mt-1 flex justify-between font-mono tabular-nums" aria-hidden="true">
        <span>0%</span>
        <span>100%</span>
      </div>
    </div>
  )
}

function LegendBody({ overlay, extraEntries }: { overlay: OverlayKind; extraEntries: readonly LegendEntry[] }) {
  const isOccupancy = overlay === 'occupancy'
  const swatches = isOccupancy
    ? [...OCCUPANCY_ASIDES, ...extraEntries]
    : [...legendFor(overlay), ...extraEntries]
  return (
    <div className="flex flex-col gap-2 text-xs text-stone-600">
      {isOccupancy && <OccupancyBar />}
      {swatches.length > 0 && <Swatches entries={swatches} />}
    </div>
  )
}

export function MapLegend({ overlay, extraEntries = [], variant = 'map', defaultCollapsed = false }: MapLegendProps) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed)
  const hasContent = overlay === 'occupancy' || legendFor(overlay).length + extraEntries.length > 0
  if (!hasContent) return null

  if (variant === 'inline') return <LegendBody overlay={overlay} extraEntries={extraEntries} />

  return (
    // Bottom-left. Below `sm` it rides above the scale bar's row and stops short
    // of the control stack (12 + 52 + 12 px on a coarse pointer), so at 360px the
    // three never overlap; from `sm` up there is room to sit on the bottom edge.
    <div
      data-map-control
      className="map-panel absolute bottom-14 left-3 z-20 flex max-h-[60%] max-w-[calc(100%-5.5rem)] flex-col sm:bottom-3 sm:max-w-80"
    >
      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        aria-expanded={!collapsed}
        className="touch-target-y flex shrink-0 items-center justify-between gap-3 rounded-xl px-3 py-1.5 text-xs font-semibold text-stone-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-nexgen-blue-dark"
      >
        Legend
        <ChevronDown
          className={`h-3.5 w-3.5 transition-transform motion-reduce:transition-none ${collapsed ? '-rotate-90' : ''}`}
          aria-hidden="true"
        />
      </button>
      {!collapsed && (
        <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-2.5">
          <LegendBody overlay={overlay} extraEntries={extraEntries} />
        </div>
      )}
    </div>
  )
}
