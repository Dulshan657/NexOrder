// Floating bottom-left controls for the pan/zoom map stage: zoom out/in, the
// current zoom %, a Fit button, and (when the layout has more than one floor)
// the floor switcher — moved out of WarehouseCanvas now that it's a pure scene
// renderer. Purely presentational; all state lives in useMapViewport / the
// parent's floor state.

import { Maximize2, Minus, Plus } from 'lucide-react'

export interface MapControlsProps {
  scale: number
  onZoomIn: () => void
  onZoomOut: () => void
  onFit: () => void
  floor: number
  floorCount: number
  onFloorChange: (floor: number) => void
}

const ICON_BUTTON_CLASS =
  'grid h-7 w-7 place-items-center rounded-md text-stone-500 transition-colors hover:bg-stone-100 hover:text-stone-900 btn-press'

export function MapControls({ scale, onZoomIn, onZoomOut, onFit, floor, floorCount, onFloorChange }: MapControlsProps) {
  return (
    <div className="absolute bottom-3 left-3 z-20 flex flex-wrap items-center gap-2">
      <div className="flex items-center gap-1 rounded-lg border border-stone-200 bg-white/95 px-1.5 py-1 shadow-elevated backdrop-blur-sm">
        <button type="button" onClick={onZoomOut} aria-label="Zoom out" className={ICON_BUTTON_CLASS}>
          <Minus className="h-3.5 w-3.5" />
        </button>
        <span className="w-10 text-center font-mono text-xs text-stone-600">{Math.round(scale * 100)}%</span>
        <button type="button" onClick={onZoomIn} aria-label="Zoom in" className={ICON_BUTTON_CLASS}>
          <Plus className="h-3.5 w-3.5" />
        </button>
        <span className="mx-1 h-4 w-px bg-stone-200" aria-hidden="true" />
        <button type="button" onClick={onFit} aria-label="Fit to view" className={ICON_BUTTON_CLASS}>
          <Maximize2 className="h-3.5 w-3.5" />
        </button>
      </div>
      {floorCount > 1 && (
        <div className="inline-flex items-center gap-0.5 rounded-lg border border-stone-200 bg-white/95 p-0.5 shadow-elevated backdrop-blur-sm">
          {Array.from({ length: floorCount }, (_, f) => (
            <button
              key={f}
              type="button"
              onClick={() => onFloorChange(f)}
              className={`min-h-[28px] rounded-md px-2.5 py-1 text-xs font-semibold transition-all btn-press ${
                floor === f ? 'bg-nexgen-blue text-white shadow-sm' : 'text-stone-500 hover:bg-stone-50 hover:text-stone-900'
              }`}
            >
              Floor {f + 1}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
