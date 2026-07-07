// Read-only SVG grid for the Warehouse viewer. Unlike the designer's LayoutCanvas
// (paint tools + editor state), this renders published geometry from types.ts
// (WarehouseLayout/LayoutPlacement/LayoutObject) and is purely for looking: bins
// colored by an optional overlay map, click-to-select, a floor switcher, and
// overlay marker layers (route / putaway / slotting) supplied by later phases.
// It shares OBJECT_FILL/BASE_CELL with the designer for visual consistency.

import { useState, type ReactNode } from 'react'
import type { WarehouseLayout, LayoutPlacement, LayoutObject } from '@/types'
import { OBJECT_FILL, BASE_CELL, PLACEMENT_FILL } from '@/components/admin/layout/layoutPalette'

/** Center of a placement in grid cells — used by marker/route layers. */
export function placementCenter(p: LayoutPlacement): { cx: number; cy: number } {
  return { cx: p.x + p.w / 2, cy: p.y + p.h / 2 }
}

export interface WarehouseCanvasProps {
  layout: WarehouseLayout
  placements: LayoutPlacement[]
  objects: LayoutObject[]
  floor: number
  onFloorChange: (floor: number) => void
  selectedLocationId: number | null
  /** Bins to outline (e.g. all descendants of a selected zone). */
  highlightedLocationIds?: Set<number>
  onSelectBin: (locationId: number) => void
  /** locationId → overlay fill (Phase 4). Absent → default bin green. */
  binColors?: Map<number, string>
  /** locationId → small corner badge text, e.g. "×3" for multi-product bins. */
  binBadges?: Map<number, string>
  /** Extra SVG drawn on top of the active floor, in cell units × `cell`. */
  renderOverlay?: (cell: number) => ReactNode
}

const DEFAULT_BIN_FILL = PLACEMENT_FILL.existing
const DEFAULT_BIN_STROKE = PLACEMENT_FILL.stroke

export function WarehouseCanvas({
  layout,
  placements,
  objects,
  floor,
  onFloorChange,
  selectedLocationId,
  highlightedLocationIds,
  onSelectBin,
  binColors,
  binBadges,
  renderOverlay,
}: WarehouseCanvasProps) {
  const [zoom, setZoom] = useState(1)
  const cell = BASE_CELL * zoom
  const { gridWidth, gridHeight, floorCount } = layout

  const floorObjects = objects.filter((o) => o.floor === floor)
  const floorPlacements = placements.filter((p) => p.floor === floor)

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2 text-xs text-stone-500">
        <div className="flex items-center gap-2">
          <span>Zoom</span>
          <button className="px-2 py-0.5 border border-stone-200 rounded btn-press" onClick={() => setZoom((z) => Math.max(0.5, z - 0.25))}>−</button>
          <span className="w-10 text-center font-mono">{Math.round(zoom * 100)}%</span>
          <button className="px-2 py-0.5 border border-stone-200 rounded btn-press" onClick={() => setZoom((z) => Math.min(2.5, z + 0.25))}>+</button>
        </div>
        {floorCount > 1 && (
          <div className="inline-flex rounded-lg border border-stone-200 bg-stone-100 p-0.5">
            {Array.from({ length: floorCount }, (_, f) => (
              <button
                key={f}
                type="button"
                onClick={() => onFloorChange(f)}
                className={`min-h-[28px] rounded-md px-2.5 py-1 text-xs font-semibold transition-all ${
                  floor === f ? 'bg-nexgen-blue text-white shadow-sm' : 'text-stone-500 hover:bg-stone-50 hover:text-stone-900'
                }`}
              >
                Floor {f + 1}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="overflow-auto border border-stone-200 rounded-lg bg-stone-50" style={{ maxHeight: 560 }}>
        <svg
          width={gridWidth * cell}
          height={gridHeight * cell}
          role="img"
          aria-label={`${layout.name} floor ${floor + 1}`}
        >
          {/* Grid lines */}
          {Array.from({ length: gridWidth + 1 }, (_, i) => (
            <line key={`v${i}`} x1={i * cell} y1={0} x2={i * cell} y2={gridHeight * cell} stroke="#e7e5e4" strokeWidth={1} />
          ))}
          {Array.from({ length: gridHeight + 1 }, (_, i) => (
            <line key={`h${i}`} x1={0} y1={i * cell} x2={gridWidth * cell} y2={i * cell} stroke="#e7e5e4" strokeWidth={1} />
          ))}

          {/* Objects (walls/walkways/docks/lifts) */}
          {floorObjects.map((o) => (
            <rect
              key={o.id}
              x={o.x * cell + 1} y={o.y * cell + 1} width={o.w * cell - 2} height={o.h * cell - 2}
              fill={OBJECT_FILL[o.objectType]} rx={2} pointerEvents="none"
            />
          ))}

          {/* Storage bins */}
          {floorPlacements.map((p) => {
            const selected = p.locationId === selectedLocationId
            const highlighted = highlightedLocationIds?.has(p.locationId)
            const fill = binColors?.get(p.locationId) ?? DEFAULT_BIN_FILL
            const stroke = selected ? PLACEMENT_FILL.selectedStroke : highlighted ? PLACEMENT_FILL.highlightStroke : DEFAULT_BIN_STROKE
            const badge = binBadges?.get(p.locationId)
            return (
              <g key={p.id} onClick={() => onSelectBin(p.locationId)} style={{ cursor: 'pointer' }}>
                <rect
                  x={p.x * cell + 1} y={p.y * cell + 1} width={p.w * cell - 2} height={p.h * cell - 2}
                  fill={fill} stroke={stroke} strokeWidth={selected ? 3 : highlighted ? 2 : 1.5} rx={3}
                />
                {badge && cell >= 18 && (
                  <text
                    x={p.x * cell + p.w * cell - 3} y={p.y * cell + 10}
                    textAnchor="end" fontSize={Math.min(9, cell / 3)} fill="#334155" fontFamily="monospace"
                    pointerEvents="none"
                  >
                    {badge}
                  </text>
                )}
              </g>
            )
          })}

          {/* Overlay marker layers (route/putaway/slotting), supplied by consumers. */}
          {renderOverlay?.(cell)}
        </svg>
      </div>
    </div>
  )
}
