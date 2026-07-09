// Read-only SVG scene renderer for the Warehouse viewer. Unlike the designer's
// LayoutCanvas (paint tools + editor state), this renders published geometry
// from types.ts (WarehouseLayout/LayoutPlacement/LayoutObject) and is purely
// for looking: bins colored by an optional overlay map, click-to-select, and
// overlay marker layers (route / putaway / slotting) supplied by later phases.
// It shares OBJECT_FILL/BASE_CELL with the designer for visual consistency.
//
// This component owns NO pan/zoom state — it's a pure function of a `viewport`
// prop (see mapViewport.ts) applied via a wrapping `<g transform>`. The stage
// (MapStage.tsx / useMapViewport.ts) owns the gesture handling and measures the
// container; this file only draws. Floor switching and zoom controls live in
// MapControls.tsx now.

import type { ReactNode, CSSProperties } from 'react'
import type { WarehouseLayout, LayoutPlacement, LayoutObject } from '@/types'
import { OBJECT_FILL, BASE_CELL, PLACEMENT_FILL } from '@/components/admin/layout/layoutPalette'
import { DEFAULT_BIN_FILL, DEFAULT_BIN_STROKE } from './warehouseOverlays'
import type { Viewport } from './mapViewport'

/** Center of a placement in grid cells — used by marker/route layers. */
export function placementCenter(p: LayoutPlacement): { cx: number; cy: number } {
  return { cx: p.x + p.w / 2, cy: p.y + p.h / 2 }
}

export interface WarehouseCanvasProps {
  layout: WarehouseLayout
  placements: LayoutPlacement[]
  objects: LayoutObject[]
  floor: number
  /** Pan/zoom transform applied to the whole scene, owned by the stage. */
  viewport: Viewport
  selectedLocationId: number | null
  /** Bins to outline (e.g. all descendants of a selected zone). */
  highlightedLocationIds?: Set<number>
  onSelectBin: (locationId: number) => void
  /** locationId → overlay fill (Phase 4). Absent → default bin fill. */
  binColors?: Map<number, string>
  /** locationId → small corner badge text, e.g. "×3" for multi-product bins. */
  binBadges?: Map<number, string>
  /** Extra SVG drawn on top of the active floor, in cell units × `cell`. */
  renderOverlay?: (cell: number) => ReactNode
}

export function WarehouseCanvas({
  layout,
  placements,
  objects,
  floor,
  viewport,
  selectedLocationId,
  highlightedLocationIds,
  onSelectBin,
  binColors,
  binBadges,
  renderOverlay,
}: WarehouseCanvasProps) {
  const cell = BASE_CELL
  const { gridWidth, gridHeight } = layout

  const floorObjects = objects.filter((o) => o.floor === floor)
  const floorPlacements = placements.filter((p) => p.floor === floor)

  return (
    <svg
      className="block h-full w-full"
      role="img"
      aria-label={`${layout.name} floor ${floor + 1}`}
    >
      <g transform={`translate(${viewport.tx},${viewport.ty}) scale(${viewport.scale})`}>
        {/* Grid lines */}
        {Array.from({ length: gridWidth + 1 }, (_, i) => (
          <line
            key={`v${i}`}
            x1={i * cell} y1={0} x2={i * cell} y2={gridHeight * cell}
            stroke="#e7e5e4" strokeWidth={1} vectorEffect="non-scaling-stroke"
          />
        ))}
        {Array.from({ length: gridHeight + 1 }, (_, i) => (
          <line
            key={`h${i}`}
            x1={0} y1={i * cell} x2={gridWidth * cell} y2={i * cell}
            stroke="#e7e5e4" strokeWidth={1} vectorEffect="non-scaling-stroke"
          />
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
        {floorPlacements.map((p, i) => {
          const selected = p.locationId === selectedLocationId
          const highlighted = highlightedLocationIds?.has(p.locationId)
          const fill = binColors?.get(p.locationId) ?? DEFAULT_BIN_FILL
          const stroke = selected ? PLACEMENT_FILL.selectedStroke : highlighted ? PLACEMENT_FILL.highlightStroke : DEFAULT_BIN_STROKE
          const badge = binBadges?.get(p.locationId)
          return (
            <g key={p.id} onClick={() => onSelectBin(p.locationId)} style={{ cursor: 'pointer' }}>
              <rect
                className="wh-bin wh-bin-in"
                style={{ '--wh-i': Math.min(i, 40) } as CSSProperties}
                x={p.x * cell + 1} y={p.y * cell + 1} width={p.w * cell - 2} height={p.h * cell - 2}
                fill={fill} stroke={stroke} strokeWidth={selected ? 3 : highlighted ? 2 : 1.5} rx={3}
                vectorEffect="non-scaling-stroke"
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
      </g>
    </svg>
  )
}
