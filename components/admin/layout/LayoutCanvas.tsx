// SVG grid canvas for the layout designer. Renderer for the pure editor state
// (useLayoutEditorState) — draws walls/walkways/docks and storage bins on a grid,
// and turns pointer events into paint_cell / select actions. Plain SVG (no canvas
// library): the grid lives in an overflow-auto container and a zoom control sizes
// the cells, so pan is native scroll and there's no viewBox math to get wrong.

import { useCallback, useMemo, useRef, useState } from 'react'
import type { Dispatch, PointerEvent as ReactPointerEvent } from 'react'
import type { EditorAction, EditorObject, EditorPlacement, EditorState } from './useLayoutEditorState'
import { BASE_CELL, OBJECT_FILL, PLACEMENT_FILL } from './layoutPalette'

// Re-exported for back-compat: existing importers (WarehouseCanvas) pulled these
// from here before they moved to layoutPalette. New code should import from
// './layoutPalette' directly.
export { BASE_CELL, OBJECT_FILL }

/** Object types that render their `meta.name` as centered label text (when the
 *  cell is wide enough to read it). */
const NAMED_OBJECT_TYPES = new Set<EditorObject['objectType']>(['obstacle', 'staging', 'label'])

/** Minimum rendered rect width (px) before we bother drawing the name text. */
const MIN_NAME_WIDTH = 48

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

          {/* Storage bins */}
          {floorPlacements.map((p: EditorPlacement) => {
            const selected = p.clientRef === state.selectedRef
            const problem = highlightRefs?.has(p.clientRef) ?? false
            // Colour by storage form when known; draft (unsaved) bins render lighter.
            const formColor = p.storageTypeId != null ? formColorById?.get(p.storageTypeId) : undefined
            const fill = problem ? PLACEMENT_FILL.problemFill : (formColor ?? (p.locationId ? PLACEMENT_FILL.existing : PLACEMENT_FILL.draft))
            const stroke = problem ? PLACEMENT_FILL.problemStroke : selected ? PLACEMENT_FILL.selectedStroke : (formColor ?? PLACEMENT_FILL.stroke)
            return (
              <g key={p.clientRef} pointerEvents="none">
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
              </g>
            )
          })}

          {/* Interaction layer: ONE transparent rect over the whole grid, not one
              per cell. At 120×80 (the new import cap) a per-cell rect layer would
              be 9,600 DOM nodes and made painting/dragging visibly janky; the
              cell under the pointer is derived from clientX/Y instead. */}
          <rect
            x={0} y={0} width={gridWidth * cell} height={gridHeight * cell}
            fill="transparent"
            onPointerDown={onInteractionDown}
            onPointerMove={onInteractionMove}
            style={{ cursor: state.tool === 'select' ? 'pointer' : 'crosshair' }}
          />
        </svg>
      </div>
    </div>
  )
}
