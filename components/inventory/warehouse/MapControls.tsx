// The map's floating controls: one frosted vertical stack docked bottom-right,
// above the scale bar — the floor switcher (when the layout has more than one
// floor), zoom in, the current zoom %, zoom out, and Fit. Purely presentational;
// all state lives in useMapViewport / the parent's floor state.
//
// Bottom-right, not bottom-left where this sat until NX-0047: the legend now
// lives on the map and owns that corner, and a vertical stack on the right is
// where every map product puts its zoom, so nobody has to look for it.

import React from 'react'
import { Maximize2, Minus, Plus } from 'lucide-react'
import { HoverHint } from '@/components/ui/Tooltip'

export interface MapControlsProps {
  scale: number
  onZoomIn: () => void
  onZoomOut: () => void
  onFit: () => void
  floor: number
  floorCount: number
  onFloorChange: (floor: number) => void
  /** Operator names for the floors, by index. A layout carries none today
   *  (`warehouse_layouts` has only `floor_count`), so this falls back to
   *  "Floor N" — the prop exists so a name has somewhere to arrive. */
  floorNames?: readonly (string | null | undefined)[]
}

/** 36px at rest, 44px under a coarse pointer — the handheld's touch floor,
 *  applied without changing desktop density. */
const BUTTON_SIZE_CLASS = 'h-9 w-9 pointer-coarse:h-11 pointer-coarse:w-11'

const FOCUS_CLASS = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-nexgen-blue-dark'

const BUTTON_CLASS =
  `grid ${BUTTON_SIZE_CLASS} shrink-0 place-items-center rounded-lg text-stone-600 transition-colors ` +
  `hover:bg-stone-900/5 hover:text-stone-900 btn-press ${FOCUS_CLASS}`

const FLOOR_BUTTON_CLASS =
  `grid ${BUTTON_SIZE_CLASS} shrink-0 place-items-center rounded-lg text-sm font-semibold tabular-nums ` +
  `transition-colors btn-press ${FOCUS_CLASS}`

// A row on a narrow map, a column from sm up: on the 328 px handheld map a column
// of 44 px buttons covered a third of the floor (NX-0047 browser walk).
const DIVIDER_CLASS = 'mx-0.5 h-5 w-px bg-stone-200 sm:mx-auto sm:my-0.5 sm:h-px sm:w-5'

function floorLabel(names: MapControlsProps['floorNames'], index: number): string {
  const name = names?.[index]?.trim()
  return name || `Floor ${index + 1}`
}

export function MapControls({
  scale, onZoomIn, onZoomOut, onFit, floor, floorCount, onFloorChange, floorNames,
}: MapControlsProps) {
  return (
    // `data-map-control` is how the stage tells a press on these buttons from a
    // press on the floor (mapGesture rule 0). Without it Annotate paints under them.
    <div
      data-map-control
      className="map-panel absolute bottom-3 right-3 z-20 flex flex-row items-center p-1 sm:bottom-14 sm:flex-col"
    >
      {floorCount > 1 && (
        <>
          <div role="group" aria-label="Floor" className="flex flex-row items-center sm:flex-col">
            {/* The caption and the number read together as "Floor 2"; the button's
                own name says it in full, and so does its hint. */}
            <span className="hidden px-1 pb-0.5 pt-1 text-xs font-medium text-stone-600 sm:block" aria-hidden="true">Floor</span>
            {Array.from({ length: floorCount }, (_, f) => {
              const label = floorLabel(floorNames, f)
              return (
                // `key` on a Fragment: with no @types/react a typed local
                // component cannot take one.
                <React.Fragment key={f}>
                  <HoverHint text={label} side="left">
                    <button
                      type="button"
                      onClick={() => onFloorChange(f)}
                      aria-label={label}
                      aria-pressed={floor === f}
                      className={`${FLOOR_BUTTON_CLASS} ${
                        floor === f
                          ? 'bg-stone-900 text-white shadow-sm'
                          : 'text-stone-600 hover:bg-stone-900/5 hover:text-stone-900'
                      }`}
                    >
                      {f + 1}
                    </button>
                  </HoverHint>
                </React.Fragment>
              )
            })}
          </div>
          <span className={DIVIDER_CLASS} aria-hidden="true" />
        </>
      )}
      <HoverHint text="Zoom in (+)" side="left">
        <button type="button" onClick={onZoomIn} aria-label="Zoom in" aria-keyshortcuts="+" className={BUTTON_CLASS}>
          <Plus className="h-4 w-4" aria-hidden="true" />
        </button>
      </HoverHint>
      <span className="hidden w-full select-none py-0.5 text-center font-mono text-xs tabular-nums text-stone-600 sm:block">
        {Math.round(scale * 100)}%
      </span>
      <HoverHint text="Zoom out (−)" side="left">
        <button type="button" onClick={onZoomOut} aria-label="Zoom out" aria-keyshortcuts="-" className={BUTTON_CLASS}>
          <Minus className="h-4 w-4" aria-hidden="true" />
        </button>
      </HoverHint>
      <span className={DIVIDER_CLASS} aria-hidden="true" />
      <HoverHint text="Fit to view (0)" side="left">
        <button type="button" onClick={onFit} aria-label="Fit to view" aria-keyshortcuts="0" className={BUTTON_CLASS}>
          <Maximize2 className="h-4 w-4" aria-hidden="true" />
        </button>
      </HoverHint>
    </div>
  )
}
