// SVG grid canvas for the layout designer. Renderer for the pure editor state
// (useLayoutEditorState) — draws walls/walkways/docks and storage bins on a grid,
// and turns pointer events into paint_cell / select actions. Plain SVG (no canvas
// library): the grid lives in an overflow-auto container and a zoom control sizes
// the cells, so pan is native scroll and there's no viewBox math to get wrong.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Dispatch, PointerEvent as ReactPointerEvent } from 'react'
import type { EditorAction, EditorObject, EditorPlacement, EditorState } from './useLayoutEditorState'
import { placementAt } from './useLayoutEditorState'
import { BASE_CELL, levelRoleFill, levelRoleLabel, levelRoleStroke, OBJECT_FILL, OBJECT_STROKE, PLACEMENT_FILL } from './layoutPalette'
import { MERGED_OBJECT_TYPES, objectRegions, regionBounds, regionFillPath, regionOutlinePath } from './objectRegions'
import { useLevelRoles } from '@/hooks/queries/useLevelRoles'
import { labelTier, fitCode, fitName } from '@/components/inventory/warehouse/mapLabels'
import { isUninformativeName, nameTail } from '@/lib/locationDisplay'
import { zoneTint, ZONE_FILL_OPACITY, ZONE_STROKE_OPACITY } from '@/components/inventory/warehouse/zoneTints'
import { defaultRoleKey } from '@/lib/levelRoles'
import { rulerStride } from '@/supabase/functions/_shared/wie/gridScale'
import { ScaleIndicator } from './ScaleIndicator'
import type { LevelRole, RackLevel } from '@/types'

// Re-exported for back-compat: existing importers (WarehouseCanvas) pulled these
// from here before they moved to layoutPalette. New code should import from
// './layoutPalette' directly.
export { BASE_CELL, OBJECT_FILL }

/** Object types that render their `meta.name` as centered label text (when the
 *  cell is wide enough to read it), stamped PER OBJECT.
 *
 *  `label` left here as of mig 00097: a floor sign is now a merged named region,
 *  drawn once per region below. Stamping it per object would repeat the text on
 *  every one of a painted sign's 1x1 cells — and would never draw at all, since
 *  a single cell can't clear MIN_NAME_WIDTH. */
const NAMED_OBJECT_TYPES = new Set<EditorObject['objectType']>(['obstacle', 'staging'])

/** Minimum rendered rect width (px) before we bother drawing the name text. */
const MIN_NAME_WIDTH = 48

/** Width of the ruler gutters, px. Fixed rather than zoom-scaled: it holds text,
 *  and text doesn't get more legible because the cells grew. */
const RULER_PX = 22

/** Ruler labels are distances, so they read in metres, not cells. Whole numbers
 *  stay whole; a 0.5 m grid gets one decimal rather than "2.5000000004". */
const formatTick = (metres: number): string =>
  Number.isInteger(metres) ? String(metres) : metres.toFixed(1)

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
function levelDataForGroup(group: PlacementGroup<EditorPlacement>, fallbackRole: LevelRole): { levels: RackLevel[]; refByIndex: Map<number, string> } {
  const refByIndex = new Map<number, string>()
  if (group.items.length > 1) {
    // Each level is its own EditorPlacement row (mirrors the published model).
    const levels = group.items.map((p, i) => {
      const withLevelFields = p as EditorPlacement & { levelIndex?: number; levelRole?: LevelRole }
      const levelIndex = withLevelFields.levelIndex ?? i + 1
      refByIndex.set(levelIndex, p.clientRef)
      const role = withLevelFields.levelRole ?? fallbackRole
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
  /** The layout's metres per cell — drives the scale bar and the ruler ticks.
   *  Defaults to 1, which is what every layout was before it was settable. */
  cellSizeM?: number
  /** clientRefs of bins to flag as problems (e.g. unreachable from a dock). */
  highlightRefs?: ReadonlySet<string>
  /** storage_type_id → palette colour, so each form draws in its own colour. */
  formColorById?: ReadonlyMap<number, string>
  /** zone_profiles.id → zone_type, so a named area draws in its zone's tint —
   *  the same lookup the viewer does, so the two canvases agree about what
   *  "Cold Storage" looks like. */
  zoneTypeByProfileId?: ReadonlyMap<number, string>
}

export function LayoutCanvas({ state, dispatch, gridWidth, gridHeight, cellSizeM = 1, highlightRefs, formColorById, zoneTypeByProfileId }: LayoutCanvasProps) {
  // Operator-managed role vocabulary (mig 00081). placeholderData means the
  // exploded level stack never flashes grey while this resolves.
  const { data: levelRoles = [] } = useLevelRoles()
  const fallbackRole = defaultRoleKey(levelRoles)
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
      // RULER_PX offset: the grid content sits inside a translated <g>, but this
      // derives the cell from raw screen coordinates rather than from a DOM node,
      // so the translation has to be subtracted here by hand. Miss it and every
      // stroke lands one gutter up and to the left of the pointer.
      const x = Math.floor((e.clientX - rect.left - RULER_PX) / cell)
      const y = Math.floor((e.clientY - rect.top - RULER_PX) / cell)
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
      const hit = placementAt(state, c.x, c.y)
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

  // Memoized on state.objects/state.floor, NOT on floorObjects — that's a fresh
  // array every render, so a memo keyed on it would never hit.
  const objRegions = useMemo(() => objectRegions(state.objects, state.floor), [state.objects, state.floor])
  const areaRegions = useMemo(() => objRegions.filter((r) => r.objectType === 'area'), [objRegions])
  // Signs (mig 00097) draw their PLATE with the structural regions above and
  // their TEXT once per region below, so they need their own handle without
  // being subtracted from the structural pass.
  const signRegions = useMemo(() => objRegions.filter((r) => r.objectType === 'label'), [objRegions])

  /** An area wears its zone profile's tint (the same lookup WarehouseCanvas
   *  does), falling back to the palette neutral when it has no profile yet. */
  const areaFill = useCallback(
    (region: (typeof areaRegions)[number]): string => {
      const zp = region.meta?.zoneProfileId
      const zoneType = typeof zp === 'number' ? zoneTypeByProfileId?.get(zp) : undefined
      return zoneType ? zoneTint(zoneType) : OBJECT_FILL.area
    },
    [zoneTypeByProfileId],
  )
  const unmergedObjects = useMemo(
    () => state.objects.filter((o) => o.floor === state.floor && !MERGED_OBJECT_TYPES.has(o.objectType)),
    [state.objects, state.floor],
  )

  const floorObjects = useMemo(
    () => state.objects.filter((o) => o.floor === state.floor),
    [state.objects, state.floor],
  )
  const floorPlacements = useMemo(
    () => state.placements.filter((p) => p.floor === state.floor),
    [state.placements, state.floor],
  )

  // Brief red flash on a cell whose paint was refused (see EditorState.blockedAt).
  // Keyed off `seq`, not off presence, so a repeated refusal at the same cell
  // re-triggers instead of sitting silent.
  const [flash, setFlash] = useState<{ x: number; y: number } | null>(null)
  const blockedSeq = state.blockedAt?.seq
  useEffect(() => {
    if (!state.blockedAt) return
    setFlash({ x: state.blockedAt.x, y: state.blockedAt.y })
    const timer = setTimeout(() => setFlash(null), 350)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blockedSeq])

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
      map.set(g.key, levelDataForGroup(g, fallbackRole))
    }
    return map
  }, [placementGroups, fallbackRole])

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

  // Which cells get a ruler label. Memoized next to gridLines for the same
  // reason: it is recomputed only when the grid or the zoom actually moves.
  const rulerTicks = useMemo(() => {
    const stride = rulerStride(cell)
    const every = (n: number) => {
      const out: number[] = []
      for (let i = 0; i <= n; i += stride) out.push(i)
      return out
    }
    return { x: every(gridWidth), y: every(gridHeight) }
  }, [gridWidth, gridHeight, cell])

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2 text-xs text-stone-500">
        <span>Zoom</span>
        <button className="px-2 py-0.5 border border-stone-200 rounded btn-press" onClick={() => setZoom((z) => Math.max(0.5, z - 0.25))}>−</button>
        <span className="w-10 text-center font-mono">{Math.round(zoom * 100)}%</span>
        <button className="px-2 py-0.5 border border-stone-200 rounded btn-press" onClick={() => setZoom((z) => Math.min(2.5, z + 0.25))}>+</button>
        <ScaleIndicator pxPerCell={cell} cellSizeM={cellSizeM} className="ml-3" />
      </div>
      <div className="overflow-auto border border-stone-200 rounded-lg bg-stone-50" style={{ maxHeight: 520 }}>
        <svg
          ref={svgRef}
          width={gridWidth * cell + RULER_PX}
          height={gridHeight * cell + RULER_PX}
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

          {/* Ruler gutters. Drawn INSIDE the same <svg> and the grid shifted
              right/down by RULER_PX, so the ticks pan and zoom with the plan
              inside the existing overflow-auto container. Sticky gutters outside
              the scroll container would need their scroll position mirrored by
              hand and would drift on every zoom step. */}
          <g pointerEvents="none" fontFamily="sans-serif" fontSize={9} fill="#a8a29e">
            {rulerTicks.x.map((c) => (
              <text key={`rx${c}`} x={RULER_PX + c * cell + cell / 2} y={RULER_PX - 4} textAnchor="middle">
                {formatTick(c * cellSizeM)}
              </text>
            ))}
            {rulerTicks.y.map((c) => (
              <text key={`ry${c}`} x={RULER_PX - 4} y={RULER_PX + c * cell + cell / 2 + 3} textAnchor="end">
                {formatTick(c * cellSizeM)}
              </text>
            ))}
            <line x1={RULER_PX} y1={RULER_PX} x2={RULER_PX + gridWidth * cell} y2={RULER_PX} stroke="#d6d3d1" />
            <line x1={RULER_PX} y1={RULER_PX} x2={RULER_PX} y2={RULER_PX + gridHeight * cell} stroke="#d6d3d1" />
            <text x={4} y={RULER_PX - 4} fontSize={8}>m</text>
          </g>

          <g transform={`translate(${RULER_PX},${RULER_PX})`}>

          {/* Named areas (mig 00090) — the wayfinding backdrop, UNDER the grid so
              the grid reads through them, and under every structural object: an
              area names the ground the racks stand on rather than competing with
              them for the cell (which is also why ALLOWED_COOCCUPANTS lets it
              overlap everything). Drawn from merged regions, not per cell, so a
              50-cell "Cold Storage" is one outline with one name — matching
              WarehouseCanvas exactly, so the designer and the ops map agree. */}
          {areaRegions.map((region) => {
            const tint = areaFill(region)
            return (
              <g key={region.key} pointerEvents="none">
                <path d={regionFillPath(region, cell)} fill={tint} fillOpacity={ZONE_FILL_OPACITY} />
                <path
                  d={regionOutlinePath(region, cell)}
                  fill="none" stroke={tint} strokeOpacity={ZONE_STROKE_OPACITY}
                  strokeWidth={2} strokeDasharray="5 3"
                />
              </g>
            )
          })}

          {/* Grid lines */}
          {gridLines}

          {/* Merged structural regions (walls/walkways/docks/lifts/conveyors/
              staging). Contiguous same-type cells draw as ONE silhouette: an
              inset-free, radius-free union fill plus an exterior-only outline.
              The old per-cell rect carried a 1px inset and rx={2}, which put a
              2px gap between neighbours with the grid line showing through — a
              drawn wall looked like a row of separate squares. The inset and the
              radius now live on the SELECTION highlight below, which is the one
              place they help. */}
          {objRegions.filter((r) => r.objectType !== 'area').map((region) => (
            <g key={region.key} pointerEvents="none">
              <path d={regionFillPath(region, cell)} fill={OBJECT_FILL[region.objectType]} />
              {region.objectType === 'conveyor' && (
                <path d={regionFillPath(region, cell)} fill="url(#conveyor-hatch)" />
              )}
              <path
                d={regionOutlinePath(region, cell)}
                fill="none"
                stroke={OBJECT_STROKE[region.objectType]}
                strokeWidth={1}
                shapeRendering="crispEdges"
              />
            </g>
          ))}

          {/* The one type that deliberately does NOT merge — `obstacle` (discrete
              named rooms, which would read as one mislabelled room if two
              adjacent ones fused). */}
          {unmergedObjects.map((o) => (
            <rect
              key={o.clientRef}
              x={o.x * cell + 1} y={o.y * cell + 1} width={o.w * cell - 2} height={o.h * cell - 2}
              fill={OBJECT_FILL[o.objectType]} rx={2} pointerEvents="none"
            />
          ))}

          {/* Selection highlight — per OBJECT, keyed by clientRef, so clicking one
              cell of a merged wall outlines that cell and not the whole run. */}
          {floorObjects
            .filter((o) => o.clientRef === state.selectedRef)
            .map((o) => (
              <rect
                key={`sel-${o.clientRef}`}
                x={o.x * cell + 1} y={o.y * cell + 1} width={o.w * cell - 2} height={o.h * cell - 2}
                fill="none" rx={2} pointerEvents="none"
                stroke={PLACEMENT_FILL.selectedStroke} strokeWidth={2}
              />
            ))}

          {/* Object names, topmost of the object layers so a name is never buried
              under a merged fill. */}
          {floorObjects.map((o) => {
            const name = typeof o.meta?.name === 'string' ? o.meta.name : undefined
            if (!NAMED_OBJECT_TYPES.has(o.objectType) || !name || o.w * cell < MIN_NAME_WIDTH) return null
            return (
              <text
                key={`name-${o.clientRef}`}
                x={o.x * cell + (o.w * cell) / 2} y={o.y * cell + (o.h * cell) / 2 + 3}
                textAnchor="middle" fontSize={11} fill="#292524" fontFamily="sans-serif" pointerEvents="none"
              >
                {name}
              </text>
            )
          })}

          {/* Area names — one per merged region, anchored to its top-left cell.
              Deliberately NOT driven by NAMED_OBJECT_TYPES like the block above:
              an area is painted cell-by-cell, so that path would stamp the name
              onto every one of its cells. */}
          {areaRegions.map((region) => {
            const name = typeof region.meta?.name === 'string' ? region.meta.name : ''
            const anchor = region.cells[0]
            if (!name || !anchor) return null
            return (
              <text
                key={`area-name-${region.key}`}
                x={anchor.x * cell + 3}
                y={Math.max(11, anchor.y * cell - 3)}
                fontSize={12} fontWeight={700} fill={areaFill(region)}
                fontFamily="sans-serif" pointerEvents="none"
              >
                {name}
              </text>
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
                {/* `cell` here already IS screen px (the designer scales its cell
                    rather than the scene), so the rect's screen size is just
                    w×cell by h×cell. fitCode replaces a hardcoded 6-character
                    clip: warehouse codes share a prefix, so it keeps the
                    discriminating tail and fits the width actually available.
                    See mapLabels.ts. */}
                {labelTier(p.w * cell - 2, p.h * cell - 2) !== 'none' && (() => {
                  const fontSize = Math.min(9, cell / 3)
                  // Prefer the friendly name's TAIL (mig 00094) — the area name
                  // is drawn once across the region, so repeating it per bin
                  // spends the label on what the operator can already see. Falls
                  // back to the code when there is no useful name (a layout
                  // drawn before 00094) or when even the tail will not fit: a
                  // truncated stub is worse than a whole code.
                  const tail = isUninformativeName(p.name, p.code) ? '' : nameTail(p.name)
                  const named = tail ? fitName(tail, p.w * cell - 4, fontSize) : ''
                  const code = named || fitCode(p.code, p.w * cell - 4, fontSize)
                  return code ? (
                    <text
                      x={p.x * cell + cell / 2} y={p.y * cell + cell / 2 + 3}
                      textAnchor="middle" fontSize={fontSize} fill={PLACEMENT_FILL.labelText}
                      fontFamily={named ? 'sans-serif' : 'monospace'}
                    >
                      {code}
                    </text>
                  ) : null
                })()}
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

          {/* Floor signs (mig 00097) — one per merged region, centred on its
              bounding box, and drawn ABOVE the bins. Signs co-occupy with
              everything, so one placed over a rack row is the normal case rather
              than an edge one, and text under the bins would simply vanish.
              Centred rather than top-left-anchored like an area name because a
              sign IS the plate being read, where an area is a backdrop whose name
              must clear the racks standing on it. Centring also keeps a seeded
              `w: 10` sign looking exactly as it did before signs became regions. */}
          {signRegions.map((region) => {
            const name = typeof region.meta?.name === 'string' ? region.meta.name : ''
            if (!name) return null
            const b = regionBounds(region)
            // Gated on the REGION's width, which is the point of merging: a
            // painted sign is N 1x1 cells and could never clear this bar
            // object-by-object.
            if (b.w * cell < MIN_NAME_WIDTH) return null
            return (
              <text
                key={`sign-name-${region.key}`}
                x={(b.x + b.w / 2) * cell} y={(b.y + b.h / 2) * cell + 3}
                textAnchor="middle" fontSize={11} fill="#292524" fontFamily="sans-serif" pointerEvents="none"
              >
                {name}
              </text>
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

          {/* Refused-paint flash. Above the interaction rect so it's visible, and
              pointerEvents="none" is mandatory there or it would swallow the drag. */}
          {flash && (
            <rect
              data-testid="blocked-cell-flash"
              x={flash.x * cell} y={flash.y * cell} width={cell} height={cell}
              fill={PLACEMENT_FILL.problemFill} fillOpacity={0.55}
              stroke={PLACEMENT_FILL.problemStroke} strokeWidth={2}
              pointerEvents="none"
            />
          )}

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
                    // A modifier-click on the scrim is still meant to be a
                    // multi-select of the rack UNDER the pointer — the scrim
                    // just happens to sit over it. Without this, shift-clicking
                    // a second rack while the first is expanded collapses the
                    // first instead of adding the second. Plain click collapses.
                    if (e.shiftKey || e.ctrlKey || e.metaKey) {
                      const c = cellFromEvent(e)
                      const hit = c && placementAt(state, c.x, c.y)
                      if (hit) {
                        dispatch({ type: 'select', ref: hit.clientRef, additive: true })
                        return
                      }
                    }
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
                        fill={levelRoleFill(levelRoles, level.role)}
                        stroke={levelSelected ? PLACEMENT_FILL.selectedStroke : levelRoleStroke(levelRoles, level.role)}
                        strokeWidth={levelSelected ? 2.5 : 1.5}
                      />
                      <text x={stackX + 6} y={y + rowH / 2 + 3} fontSize={10} fontFamily="monospace" fill="#1c1917">
                        L{level.levelIndex} · {(level.code ?? `#${level.levelIndex}`).slice(0, 14)}
                      </text>
                      <text
                        x={stackX + stackW - 6} y={y + rowH / 2 + 3}
                        textAnchor="end" fontSize={9} fontFamily="sans-serif" fill="#44403c"
                      >
                        {levelRoleLabel(levelRoles, level.role)}
                      </text>
                    </g>
                  )
                })}
              </g>
            )
          })()}
          </g>
        </svg>
      </div>
    </div>
  )
}
