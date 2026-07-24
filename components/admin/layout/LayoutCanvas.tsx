// SVG grid canvas for the layout designer. Renderer for the pure editor state
// (useLayoutEditorState) — draws walls/walkways/docks and storage bins on a grid,
// and turns pointer events into paint_cell / select actions. Plain SVG (no canvas
// library): the grid lives in an overflow-auto container and a zoom control sizes
// the cells, so pan is native scroll and there's no viewBox math to get wrong.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Dispatch, PointerEvent as ReactPointerEvent } from 'react'
import type { EditorAction, EditorObject, EditorPlacement, EditorState } from './useLayoutEditorState'
import { BASE_CELL, LEVEL_ROLE_FILL, LEVEL_ROLE_LABEL, LEVEL_ROLE_STROKE, OBJECT_FILL, PLACEMENT_FILL } from './layoutPalette'
import type { LevelRole, RackLevel } from '@/types'

// Re-exported for back-compat: existing importers (WarehouseCanvas) pulled these
// from here before they moved to layoutPalette. New code should import from
// './layoutPalette' directly.
export { BASE_CELL, OBJECT_FILL }

/** Object types that render their `meta.name` as centered label text (when the
 *  cell is wide enough to read it). */
const NAMED_OBJECT_TYPES = new Set<EditorObject['objectType']>(['obstacle', 'staging', 'label'])

/** Minimum rendered rect width (px) before we bother drawing the name text. */
const MIN_NAME_WIDTH = 48

// ── Rack-level grouping (mig 00072) ─────────────────────────────────────────
// Each level of a rack now gets its own placement row, co-located at the
// rack's exact (floor, x, y), distinguished by `levelIndex`. Rendering a
// placements array 1:1 therefore paints one overlapping rect per level — both
// this canvas and WarehouseCanvas group by cell first and draw one rect per
// group. See the architecture note on `LayoutPlacement.levelIndex` in types.ts.

/** Minimal shape `groupPlacementsByCell` needs — satisfied by both the
 *  designer's `EditorPlacement` and the published `LayoutPlacement`, so one
 *  helper serves both canvases. */
export interface PlacementCell {
  floor: number
  x: number
  y: number
  w: number
  h: number
  /** Which level of its rack this row is; undefined = legacy single-bin. */
  levelIndex?: number
}

export interface PlacementGroup<T extends PlacementCell> {
  key: string
  floor: number
  x: number
  y: number
  w: number
  h: number
  /** True for a lone placement with `levelIndex === undefined` — the legacy
   *  single-bin case. Callers MUST render this exactly as before; anything
   *  else is (or will become, once it has >1 row) a rack needing
   *  expand-in-place. */
  isLegacyBin: boolean
  /** Every placement sharing this cell, ascending by levelIndex. */
  items: T[]
}

/** Groups a placements array by `(floor, x, y)` — the co-location key every
 *  level of a rack shares. A group of one placement with `levelIndex ===
 *  undefined` is a legacy bin and renders exactly as it does today; this is
 *  the regression risk the grouping exists to avoid getting wrong. */
export function groupPlacementsByCell<T extends PlacementCell>(placements: T[]): PlacementGroup<T>[] {
  const order: string[] = []
  const byKey = new Map<string, T[]>()
  for (const p of placements) {
    const key = `${p.floor}:${p.x}:${p.y}`
    const bucket = byKey.get(key)
    if (bucket) bucket.push(p)
    else {
      byKey.set(key, [p])
      order.push(key)
    }
  }
  return order.map((key) => {
    const items = [...(byKey.get(key) as T[])].sort((a, b) => (a.levelIndex ?? 0) - (b.levelIndex ?? 0))
    const first = items[0]
    return {
      key,
      floor: first.floor,
      x: first.x,
      y: first.y,
      w: first.w,
      h: first.h,
      isLegacyBin: items.length === 1 && items[0].levelIndex === undefined,
      items,
    }
  })
}

/** `EditorPlacement.levels` (mig 00072, owned by `useLayoutEditorState.ts`) is
 *  the embedded per-rack level array — the shape a single draft placement
 *  uses before it's ever split into per-level rows on the backend. */
function embeddedLevels(p: EditorPlacement): RackLevel[] | undefined {
  return p.levels
}

/** Resolves a group's level list (+ each level's own clientRef, when the
 *  reducer represents levels as separate placement rows rather than one
 *  embedded array) regardless of which of those two shapes the editor state
 *  ends up using. Returns an empty level list for anything that isn't (yet)
 *  a levelled rack, so callers can key expand-in-place off `levels.length`. */
function levelDataForGroup(group: PlacementGroup<EditorPlacement>): { levels: RackLevel[]; refByIndex: Map<number, string> } {
  const refByIndex = new Map<number, string>()
  if (group.items.length > 1) {
    // Each level is its own EditorPlacement row (mirrors the published model).
    const levels = group.items.map((p, i) => {
      const withLevelFields = p as EditorPlacement & { levelIndex?: number; levelRole?: LevelRole }
      const levelIndex = withLevelFields.levelIndex ?? i + 1
      refByIndex.set(levelIndex, p.clientRef)
      const role = withLevelFields.levelRole ?? 'pick'
      return {
        locationId: p.locationId, levelIndex, role, code: p.code,
        capacitySlots: p.capacitySlots, slotKind: p.slotKind, weightCapacityKg: p.weightCapacityKg,
      } as RackLevel
    })
    return { levels, refByIndex }
  }
  return { levels: embeddedLevels(group.items[0]) ?? [], refByIndex }
}

interface LayoutCanvasProps {
  state: EditorState
  dispatch: Dispatch<EditorAction>
  gridWidth: number
  gridHeight: number
  /** clientRefs of bins to flag as problems (e.g. unreachable from a dock). */
  highlightRefs?: ReadonlySet<string>
  /** storage_type_id → palette colour, so each form draws in its own colour. */
  formColorById?: ReadonlyMap<number, string>
}

export function LayoutCanvas({ state, dispatch, gridWidth, gridHeight, highlightRefs, formColorById }: LayoutCanvasProps) {
  const [zoom, setZoom] = useState(1)
  const painting = useRef(false)
  const lastCell = useRef<{ x: number; y: number } | null>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const cell = BASE_CELL * zoom

  const paint = useCallback(
    (x: number, y: number) => dispatch({ type: 'paint_cell', x, y }),
    [dispatch],
  )

  // Derive the grid cell under the pointer from raw screen coordinates instead
  // of relying on one DOM node per cell — see the interaction-layer comment
  // below for why that matters at 120×80.
  const cellFromEvent = useCallback(
    (e: ReactPointerEvent<SVGRectElement>): { x: number; y: number } | null => {
      const svg = svgRef.current
      if (!svg) return null
      const rect = svg.getBoundingClientRect()
      const x = Math.floor((e.clientX - rect.left) / cell)
      const y = Math.floor((e.clientY - rect.top) / cell)
      if (x < 0 || y < 0 || x >= gridWidth || y >= gridHeight) return null
      return { x, y }
    },
    [cell, gridWidth, gridHeight],
  )

  const onInteractionDown = (e: ReactPointerEvent<SVGRectElement>) => {
    const c = cellFromEvent(e)
    if (!c) return
    // Shift/Ctrl/⌘-click with the select tool TOGGLES a rack into the
    // multi-selection, which is what drives "apply this level layout to all N
    // selected racks" in the inspector. Without this the reducer's additive
    // select action is unreachable and multi-select silently does nothing.
    if (state.tool === 'select' && (e.shiftKey || e.ctrlKey || e.metaKey)) {
      const hit = state.placements.find((p) => p.floor === state.floor && p.x === c.x && p.y === c.y)
      if (hit) {
        dispatch({ type: 'select', ref: hit.clientRef, additive: true })
        return
      }
    }
    painting.current = true
    lastCell.current = c
    paint(c.x, c.y)
  }
  const onInteractionMove = (e: ReactPointerEvent<SVGRectElement>) => {
    if (!painting.current || state.tool === 'select') return
    const c = cellFromEvent(e)
    if (!c) return
    if (lastCell.current && lastCell.current.x === c.x && lastCell.current.y === c.y) return
    lastCell.current = c
    paint(c.x, c.y)
  }
  const stopPainting = () => {
    painting.current = false
    lastCell.current = null
  }

  const floorObjects = state.objects.filter((o) => o.floor === state.floor)
  const floorPlacements = state.placements.filter((p) => p.floor === state.floor)

  // Group by cell (see groupPlacementsByCell above) so a levelled rack — once
  // useLayoutEditorState represents one — paints one rect, not N overlapping
  // ones. Today every group is a lone legacy placement (EditorPlacement has no
  // levelIndex yet), so this is a no-op pass-through until that lands.
  const placementGroups = useMemo(() => groupPlacementsByCell(floorPlacements), [floorPlacements])

  // Per-group level data, computed only for groups that aren't a plain legacy
  // bin (cheap: at most a handful of racks are ever levelled on screen).
  const groupLevelData = useMemo(() => {
    const map = new Map<string, { levels: RackLevel[]; refByIndex: Map<number, string> }>()
    for (const g of placementGroups) {
      if (g.isLegacyBin) continue
      map.set(g.key, levelDataForGroup(g))
    }
    return map
  }, [placementGroups])

  // Selecting a rack (the existing click-to-select path — no new reducer
  // action needed) expands it in place; selecting anything else, or nothing,
  // collapses it. Mirrors how WarehouseCanvas derives expansion from
  // `selectedLocationId`.
  const expandedGroup = useMemo(() => {
    if (!state.selectedRef) return null
    const g = placementGroups.find((gr) => gr.items.some((p) => p.clientRef === state.selectedRef))
    if (!g || g.isLegacyBin) return null
    const data = groupLevelData.get(g.key)
    return data && data.levels.length > 1 ? { group: g, ...data } : null
  }, [placementGroups, groupLevelData, state.selectedRef])

  // Which level within the exploded stack is highlighted. This is purely
  // local/visual: EditorPlacement has no per-level clientRef in the
  // embedded-levels case, so there's nothing further to dispatch — the real
  // per-level selection surface is RackLevelEditor, mounted in
  // PlacementInspector (owned by another workstream).
  const [selectedLevelIndex, setSelectedLevelIndex] = useState<number | null>(null)
  useEffect(() => {
    setSelectedLevelIndex(null)
  }, [expandedGroup?.group.key])

  // MANDATORY perf fix: at the 120×80 grid cap a per-cell <line> pair is only
  // ~200 nodes (cheap), but the interaction layer used to be one <rect> per
  // cell (9,600 nodes) — that's what's replaced by the single transparent rect
  // above. The grid lines themselves are memoized so panning/zoom-independent
  // re-renders (e.g. selecting an object) don't rebuild this array.
  const gridLines = useMemo(() => {
    // No @types/react in this repo, so JSX element types aren't resolvable —
    // let TS infer the array element type rather than annotating it.
    const lines = []
    for (let i = 0; i <= gridWidth; i++) {
      lines.push(<line key={`v${i}`} x1={i * cell} y1={0} x2={i * cell} y2={gridHeight * cell} stroke="#e7e5e4" strokeWidth={1} />)
    }
    for (let i = 0; i <= gridHeight; i++) {
      lines.push(<line key={`h${i}`} x1={0} y1={i * cell} x2={gridWidth * cell} y2={i * cell} stroke="#e7e5e4" strokeWidth={1} />)
    }
    return lines
  }, [gridWidth, gridHeight, cell])

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2 text-xs text-stone-500">
        <span>Zoom</span>
        <button className="px-2 py-0.5 border border-stone-200 rounded btn-press" onClick={() => setZoom((z) => Math.max(0.5, z - 0.25))}>−</button>
        <span className="w-10 text-center font-mono">{Math.round(zoom * 100)}%</span>
        <button className="px-2 py-0.5 border border-stone-200 rounded btn-press" onClick={() => setZoom((z) => Math.min(2.5, z + 0.25))}>+</button>
      </div>
      <div className="overflow-auto border border-stone-200 rounded-lg bg-stone-50" style={{ maxHeight: 520 }}>
        <svg
          ref={svgRef}
          width={gridWidth * cell}
          height={gridHeight * cell}
          onPointerUp={stopPainting}
          onPointerLeave={stopPainting}
          role="img"
          aria-label="Warehouse layout grid"
          style={{ touchAction: 'none' }}
        >
          <defs>
            {/* Diagonal hatch so a conveyor reads as "blocks routing" at a glance,
                distinct from the flat fills used elsewhere. */}
            <pattern id="conveyor-hatch" width={8} height={8} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <line x1={0} y1={0} x2={0} y2={8} stroke="#9a3412" strokeWidth={2} />
            </pattern>
          </defs>

          {/* Grid lines */}
          {gridLines}

          {/* Objects (walls/walkways/docks/conveyors/staging/obstacles/labels) */}
          {floorObjects.map((o) => {
            const name = typeof o.meta?.name === 'string' ? o.meta.name : undefined
            const showName = NAMED_OBJECT_TYPES.has(o.objectType) && !!name && o.w * cell >= MIN_NAME_WIDTH
            const selected = o.clientRef === state.selectedRef
            return (
              <g key={o.clientRef}>
                <rect
                  x={o.x * cell + 1} y={o.y * cell + 1} width={o.w * cell - 2} height={o.h * cell - 2}
                  fill={OBJECT_FILL[o.objectType]} rx={2} pointerEvents="none"
                  stroke={selected ? PLACEMENT_FILL.selectedStroke : undefined}
                  strokeWidth={selected ? 2 : 0}
                />
                {o.objectType === 'conveyor' && (
                  <rect
                    x={o.x * cell + 1} y={o.y * cell + 1} width={o.w * cell - 2} height={o.h * cell - 2}
                    fill="url(#conveyor-hatch)" rx={2} pointerEvents="none"
                  />
                )}
                {showName && (
                  <text
                    x={o.x * cell + (o.w * cell) / 2} y={o.y * cell + (o.h * cell) / 2 + 3}
                    textAnchor="middle" fontSize={11} fill="#292524" fontFamily="sans-serif" pointerEvents="none"
                  >
                    {name}
                  </text>
                )}
              </g>
            )
          })}

          {/* Storage bins — one rect per (floor,x,y) group, not per placement
              row, so a levelled rack never paints overlapping cells (see
              groupPlacementsByCell above). A legacy single-bin group renders
              byte-identical to the original per-placement loop. */}
          {placementGroups.map((group) => {
            const p: EditorPlacement = group.items[0]
            const selected = group.items.some((item) => item.clientRef === state.selectedRef)
            const problem = group.items.some((item) => highlightRefs?.has(item.clientRef) ?? false)
            // Colour by storage form when known; draft (unsaved) bins render lighter.
            const formColor = p.storageTypeId != null ? formColorById?.get(p.storageTypeId) : undefined
            const fill = problem ? PLACEMENT_FILL.problemFill : (formColor ?? (p.locationId ? PLACEMENT_FILL.existing : PLACEMENT_FILL.draft))
            const stroke = problem ? PLACEMENT_FILL.problemStroke : selected ? PLACEMENT_FILL.selectedStroke : (formColor ?? PLACEMENT_FILL.stroke)
            const levelData = groupLevelData.get(group.key)
            const levelCount = levelData?.levels.length ?? 0
            return (
              <g key={group.key} data-testid={`rack-${p.code}`} pointerEvents="none">
                <rect
                  x={p.x * cell + 1} y={p.y * cell + 1} width={p.w * cell - 2} height={p.h * cell - 2}
                  fill={fill} fillOpacity={p.locationId || problem ? 1 : 0.6}
                  stroke={stroke}
                  strokeWidth={problem || selected ? 3 : 1.5} rx={3}
                />
                {cell >= 22 && (
                  <text
                    x={p.x * cell + cell / 2} y={p.y * cell + cell / 2 + 3}
                    textAnchor="middle" fontSize={Math.min(9, cell / 3)} fill={PLACEMENT_FILL.labelText} fontFamily="monospace"
                  >
                    {p.code.slice(0, 6)}
                  </text>
                )}
                {levelCount > 1 && cell >= 18 && (
                  <text
                    x={p.x * cell + p.w * cell - 3} y={p.y * cell + 9}
                    textAnchor="end" fontSize={8} fill={PLACEMENT_FILL.labelText} fontFamily="monospace"
                  >
                    {levelCount}L
                  </text>
                )}
              </g>
            )
          })}

          {/* Interaction layer: ONE transparent rect over the whole grid, not one
              per cell. At 120×80 (the new import cap) a per-cell rect layer would
              be 9,600 DOM nodes and made painting/dragging visibly janky; the
              cell under the pointer is derived from clientX/Y instead. */}
          <rect
            data-testid="layout-grid-interaction"
            x={0} y={0} width={gridWidth * cell} height={gridHeight * cell}
            fill="transparent"
            onPointerDown={onInteractionDown}
            onPointerMove={onInteractionMove}
            style={{ cursor: state.tool === 'select' ? 'pointer' : 'crosshair' }}
          />

          {/* Expand-in-place: selecting a rack (the existing select-tool path,
              above) explodes its cell into an editable level stack. Drawn
              ABOVE the interaction rect so clicks reach it; the scrim dims
              every other cell without moving them, and clicking it collapses
              the expansion by clearing selection. */}
          {expandedGroup && (() => {
            const { group, levels, refByIndex } = expandedGroup
            const gridPxW = gridWidth * cell
            const gridPxH = gridHeight * cell
            const topFirst = [...levels].sort((a, b) => b.levelIndex - a.levelIndex)
            const rowH = Math.max(cell * 1.1, 20)
            const gap = 3
            const stackW = Math.max(cell * 2.6, 96)
            const stackH = topFirst.length * rowH + (topFirst.length - 1) * gap
            const cellCenterX = group.x * cell + (group.w * cell) / 2
            const cellCenterY = group.y * cell + (group.h * cell) / 2
            const clamp = (v: number, max: number) => Math.min(Math.max(v, 4), Math.max(4, max - 4))
            const stackX = clamp(cellCenterX - stackW / 2, gridPxW - stackW)
            const stackY = clamp(cellCenterY - stackH / 2, gridPxH - stackH)
            return (
              <g>
                <rect
                  x={0} y={0} width={gridPxW} height={gridPxH}
                  fill="rgba(28,25,23,0.45)"
                  onPointerDown={(e) => {
                    e.stopPropagation()
                    dispatch({ type: 'select', ref: null })
                  }}
                  style={{ cursor: 'pointer' }}
                />
                {topFirst.map((level, i) => {
                  const y = stackY + i * (rowH + gap)
                  const levelSelected = selectedLevelIndex === level.levelIndex
                  const ownRef = refByIndex.get(level.levelIndex)
                  return (
                    <g
                      key={level.levelIndex}
                      data-testid={`level-${level.code ?? level.levelIndex}`}
                      onPointerDown={(e) => {
                        e.stopPropagation()
                        setSelectedLevelIndex(level.levelIndex)
                        if (ownRef) dispatch({ type: 'select', ref: ownRef })
                      }}
                      style={{ cursor: 'pointer' }}
                    >
                      <rect
                        x={stackX} y={y} width={stackW} height={rowH} rx={4}
                        fill={LEVEL_ROLE_FILL[level.role]}
                        stroke={levelSelected ? PLACEMENT_FILL.selectedStroke : LEVEL_ROLE_STROKE[level.role]}
                        strokeWidth={levelSelected ? 2.5 : 1.5}
                      />
                      <text x={stackX + 6} y={y + rowH / 2 + 3} fontSize={10} fontFamily="monospace" fill="#1c1917">
                        L{level.levelIndex} · {(level.code ?? `#${level.levelIndex}`).slice(0, 14)}
                      </text>
                      <text
                        x={stackX + stackW - 6} y={y + rowH / 2 + 3}
                        textAnchor="end" fontSize={9} fontFamily="sans-serif" fill="#44403c"
                      >
                        {LEVEL_ROLE_LABEL[level.role]}
                      </text>
                    </g>
                  )
                })}
              </g>
            )
          })()}
        </svg>
      </div>
    </div>
  )
}
