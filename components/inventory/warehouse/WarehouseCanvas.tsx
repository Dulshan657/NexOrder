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

import { useMemo, useState, type ReactNode, type CSSProperties } from 'react'
import type { WarehouseLayout, LayoutPlacement, LayoutObject, InventoryLocation } from '@/types'
import { OBJECT_FILL, BASE_CELL, PLACEMENT_FILL, LEVEL_ROLE_FILL, LEVEL_ROLE_STROKE, LEVEL_ROLE_LABEL } from '@/components/admin/layout/layoutPalette'
import { groupPlacementsByCell } from '@/components/admin/layout/LayoutCanvas'
import { DEFAULT_BIN_FILL, DEFAULT_BIN_STROKE } from './warehouseOverlays'
import type { Viewport } from './mapViewport'

/** Sentinel meaning "explicitly collapsed" — distinct from `null` ("no manual
 *  override; derive expansion from `selectedLocationId`"), see `expandedKey`. */
const COLLAPSED = '__collapsed__'

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
  /** Location metadata (code, levelRole) for the level rows in a placement
   *  group — needed to label the exploded stack. Absent → levels render with
   *  a bare "L{n}" label instead of their real code/role. */
  locationsById?: Map<number, InventoryLocation>
  /** Wraps a click-driven state change (expand/collapse) so a pan that ends
   *  over a rack doesn't also toggle it — mirrors the `didDrag()` guard
   *  MapStage already applies to `onSelectBin`. Defaults to firing immediately. */
  guardClick?: (fn: () => void) => void
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
  locationsById,
  guardClick,
}: WarehouseCanvasProps) {
  const cell = BASE_CELL
  const { gridWidth, gridHeight } = layout
  const guard = guardClick ?? ((fn: () => void) => fn())

  const floorObjects = objects.filter((o) => o.floor === floor)
  const floorPlacements = placements.filter((p) => p.floor === floor)

  // Group by (floor,x,y) — every level of a rack now shares its rack's cell,
  // distinguished only by `levelIndex` (see LayoutPlacement.levelIndex in
  // types.ts). A legacy group (lone placement, levelIndex undefined) renders
  // exactly as the original per-placement loop below.
  const placementGroups = useMemo(() => groupPlacementsByCell(floorPlacements), [floorPlacements])

  // Manual expand/collapse override: undefined = "derive from selection",
  // a group key = "force this rack expanded" (right after clicking its
  // collapsed cell, before any level has been selected), COLLAPSED = "force
  // nothing expanded" (right after clicking the scrim), regardless of a
  // stale selection still pointing at one of that rack's levels.
  const [expandOverride, setExpandOverride] = useState<string | null>(null)

  const derivedExpandedKey = useMemo(() => {
    if (selectedLocationId == null) return null
    const g = placementGroups.find((gr) => gr.items.some((item) => item.locationId === selectedLocationId))
    return g && !g.isLegacyBin ? g.key : null
  }, [placementGroups, selectedLocationId])

  const effectiveExpandedKey = expandOverride === COLLAPSED ? null : expandOverride ?? derivedExpandedKey
  const expandedGroup = effectiveExpandedKey != null
    ? placementGroups.find((g) => g.key === effectiveExpandedKey) ?? null
    : null

  const selectLevel = (locationId: number) => {
    // Reuses the caller's (already didDrag()-guarded) onSelectBin — see
    // MapStage's guardedSelectBin — so this needs no guard of its own.
    onSelectBin(locationId)
    setExpandOverride(null)
  }

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

        {/* Storage bins — one rect per (floor,x,y) group (see placementGroups
            above), so a levelled rack paints once instead of N overlapping
            times. A legacy group (isLegacyBin) renders byte-identical to the
            original per-placement loop; only its variable name (`p`) moved. */}
        {placementGroups.map((group, i) => {
          const p = group.items[0]
          const selected = group.items.some((item) => item.locationId === selectedLocationId)
          const highlighted = group.items.some((item) => highlightedLocationIds?.has(item.locationId))
          const isRack = !group.isLegacyBin

          if (!isRack) {
            const fill = binColors?.get(p.locationId) ?? DEFAULT_BIN_FILL
            const stroke = selected ? PLACEMENT_FILL.selectedStroke : highlighted ? PLACEMENT_FILL.highlightStroke : DEFAULT_BIN_STROKE
            const badge = binBadges?.get(p.locationId)
            return (
              <g key={group.key} onClick={() => onSelectBin(p.locationId)} style={{ cursor: 'pointer' }}>
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
          }

          // Rack group: collapsed aggregate rect. Clicking it expands the
          // cell in place rather than selecting a bin directly — there's no
          // single "the" location to select until a level is chosen.
          // Aggregate colour: the first level with a defined overlay colour
          // (occupancy/velocity/congestion are per-level; there's no single
          // "right" way to collapse N colours into one, so this is a
          // reasonable approximation rather than a precise rollup).
          const fill = group.items.map((lvl) => binColors?.get(lvl.locationId)).find((c) => c != null) ?? DEFAULT_BIN_FILL
          const stroke = selected ? PLACEMENT_FILL.selectedStroke : highlighted ? PLACEMENT_FILL.highlightStroke : DEFAULT_BIN_STROKE
          return (
            <g
              key={group.key}
              onClick={() => guard(() => setExpandOverride(group.key))}
              style={{ cursor: 'pointer' }}
            >
              <rect
                className="wh-bin wh-bin-in"
                style={{ '--wh-i': Math.min(i, 40) } as CSSProperties}
                x={p.x * cell + 1} y={p.y * cell + 1} width={p.w * cell - 2} height={p.h * cell - 2}
                fill={fill} stroke={stroke} strokeWidth={selected ? 3 : highlighted ? 2 : 1.5} rx={3}
                vectorEffect="non-scaling-stroke"
              />
              {cell >= 18 && (
                <text
                  x={p.x * cell + p.w * cell - 3} y={p.y * cell + 10}
                  textAnchor="end" fontSize={Math.min(9, cell / 3)} fill="#334155" fontFamily="monospace"
                  pointerEvents="none"
                >
                  {group.items.length}L
                </text>
              )}
            </g>
          )
        })}

        {/* Expand-in-place: the selected rack's levels, exploded into a
            vertical stack anchored to its cell. Drawn on top of everything
            else; the scrim dims the rest of the grid (never moves it) and
            collapses the expansion on click. */}
        {expandedGroup && (() => {
          const group = expandedGroup
          const gridPxW = gridWidth * cell
          const gridPxH = gridHeight * cell
          const levels = [...group.items].sort((a, b) => (b.levelIndex ?? 0) - (a.levelIndex ?? 0))
          const rowH = Math.max(cell * 1.1, 20)
          const gap = 3
          const stackW = Math.max(cell * 2.6, 100)
          const stackH = levels.length * rowH + (levels.length - 1) * gap
          const cellCenterX = group.x * cell + (group.w * cell) / 2
          const cellCenterY = group.y * cell + (group.h * cell) / 2
          const clamp = (v: number, max: number) => Math.min(Math.max(v, 4), Math.max(4, max - 4))
          const stackX = clamp(cellCenterX - stackW / 2, gridPxW - stackW)
          const stackY = clamp(cellCenterY - stackH / 2, gridPxH - stackH)
          return (
            <g>
              <rect
                x={0} y={0} width={gridPxW} height={gridPxH}
                fill="rgba(15,23,42,0.45)"
                onClick={() => guard(() => setExpandOverride(COLLAPSED))}
                style={{ cursor: 'pointer' }}
              />
              {levels.map((lvl, stackPos) => {
                const loc = locationsById?.get(lvl.locationId)
                const role = loc?.levelRole ?? 'pick'
                const idx = lvl.levelIndex ?? loc?.levelIndex ?? 0
                const y = stackY + stackPos * (rowH + gap)
                const isSelected = lvl.locationId === selectedLocationId
                return (
                  <g
                    key={lvl.locationId}
                    onClick={(e) => {
                      e.stopPropagation()
                      selectLevel(lvl.locationId)
                    }}
                    style={{ cursor: 'pointer' }}
                  >
                    <rect
                      x={stackX} y={y} width={stackW} height={rowH} rx={4}
                      fill={LEVEL_ROLE_FILL[role]}
                      stroke={isSelected ? PLACEMENT_FILL.selectedStroke : LEVEL_ROLE_STROKE[role]}
                      strokeWidth={isSelected ? 2.5 : 1.5}
                      vectorEffect="non-scaling-stroke"
                    />
                    <text x={stackX + 6} y={y + rowH / 2 + 3} fontSize={10} fontFamily="monospace" fill="#1c1917">
                      L{idx} · {(loc?.code ?? `#${lvl.locationId}`).slice(0, 14)}
                    </text>
                    <text
                      x={stackX + stackW - 6} y={y + rowH / 2 + 3}
                      textAnchor="end" fontSize={9} fontFamily="sans-serif" fill="#44403c"
                    >
                      {LEVEL_ROLE_LABEL[role]}
                    </text>
                  </g>
                )
              })}
            </g>
          )
        })()}

        {/* Overlay marker layers (route/putaway/slotting), supplied by consumers. */}
        {renderOverlay?.(cell)}
      </g>
    </svg>
  )
}
