// SVG grid canvas for the layout designer. Renderer for the pure editor state
// (useLayoutEditorState) — draws walls/walkways/docks and storage bins on a grid,
// and turns pointer events into paint_cell / select actions. Plain SVG (no canvas
// library): the grid lives in an overflow-auto container and a zoom control sizes
// the cells, so pan is native scroll and there's no viewBox math to get wrong.

import { useCallback, useRef, useState } from 'react'
import type { Dispatch } from 'react'
import type { EditorAction, EditorPlacement, EditorState } from './useLayoutEditorState'
import { BASE_CELL, OBJECT_FILL, PLACEMENT_FILL } from './layoutPalette'

// Re-exported for back-compat: existing importers (WarehouseCanvas) pulled these
// from here before they moved to layoutPalette. New code should import from
// './layoutPalette' directly.
export { BASE_CELL, OBJECT_FILL }

interface LayoutCanvasProps {
  state: EditorState
  dispatch: Dispatch<EditorAction>
  gridWidth: number
  gridHeight: number
}

export function LayoutCanvas({ state, dispatch, gridWidth, gridHeight }: LayoutCanvasProps) {
  const [zoom, setZoom] = useState(1)
  const painting = useRef(false)
  const cell = BASE_CELL * zoom

  const paint = useCallback(
    (x: number, y: number) => dispatch({ type: 'paint_cell', x, y }),
    [dispatch],
  )

  const onCellDown = (x: number, y: number) => {
    painting.current = true
    paint(x, y)
  }
  const onCellEnter = (x: number, y: number) => {
    if (painting.current && state.tool !== 'select') paint(x, y)
  }
  const stopPainting = () => {
    painting.current = false
  }

  const floorObjects = state.objects.filter((o) => o.floor === state.floor)
  const floorPlacements = state.placements.filter((p) => p.floor === state.floor)

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
          width={gridWidth * cell}
          height={gridHeight * cell}
          onPointerUp={stopPainting}
          onPointerLeave={stopPainting}
          role="img"
          aria-label="Warehouse layout grid"
          style={{ touchAction: 'none' }}
        >
          {/* Grid lines */}
          {Array.from({ length: gridWidth + 1 }, (_, i) => (
            <line key={`v${i}`} x1={i * cell} y1={0} x2={i * cell} y2={gridHeight * cell} stroke="#e7e5e4" strokeWidth={1} />
          ))}
          {Array.from({ length: gridHeight + 1 }, (_, i) => (
            <line key={`h${i}`} x1={0} y1={i * cell} x2={gridWidth * cell} y2={i * cell} stroke="#e7e5e4" strokeWidth={1} />
          ))}

          {/* Objects (walls/walkways/docks) */}
          {floorObjects.map((o) => (
            <rect
              key={o.clientRef}
              x={o.x * cell + 1} y={o.y * cell + 1} width={o.w * cell - 2} height={o.h * cell - 2}
              fill={OBJECT_FILL[o.objectType]} rx={2} pointerEvents="none"
            />
          ))}

          {/* Storage bins */}
          {floorPlacements.map((p: EditorPlacement) => {
            const selected = p.clientRef === state.selectedRef
            return (
              <g key={p.clientRef} pointerEvents="none">
                <rect
                  x={p.x * cell + 1} y={p.y * cell + 1} width={p.w * cell - 2} height={p.h * cell - 2}
                  fill={p.locationId ? PLACEMENT_FILL.existing : PLACEMENT_FILL.draft}
                  stroke={selected ? PLACEMENT_FILL.selectedStroke : PLACEMENT_FILL.stroke}
                  strokeWidth={selected ? 3 : 1.5} rx={3}
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

          {/* Interaction layer: one transparent rect per cell */}
          {Array.from({ length: gridHeight }, (_, y) =>
            Array.from({ length: gridWidth }, (_, x) => (
              <rect
                key={`c${x}-${y}`}
                x={x * cell} y={y * cell} width={cell} height={cell}
                fill="transparent"
                onPointerDown={() => onCellDown(x, y)}
                onPointerEnter={() => onCellEnter(x, y)}
                style={{ cursor: state.tool === 'select' ? 'pointer' : 'crosshair' }}
              />
            )),
          )}
        </svg>
      </div>
    </div>
  )
}
