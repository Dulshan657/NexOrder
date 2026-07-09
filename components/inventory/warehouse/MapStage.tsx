// Composes the pan/zoom container + useMapViewport + WarehouseCanvas into the
// interactive map stage. Owns nothing about warehouse data — floor/selection
// state stay with the caller — it only owns the viewport gesture wiring and
// suppresses a bin click when it lands right after a pan (drag-vs-click).
//
// MapControls docks bottom-left inside this container, and a first-hover hint
// pill docks top-right. Both are on-map chrome that lives inside this
// component's own `relative isolate` stacking context; every other panel
// (tree, bin detail, overlays, ask-engine) now renders below the map in
// normal document flow, not as a floating sibling — the wheel listener no
// longer preventDefaults unconditionally (it requires Ctrl/⌘), so there's no
// scroll-trap for a panel to worry about.

import { useCallback, useEffect, useState, type ReactNode } from 'react'
import type { WarehouseLayout, LayoutPlacement, LayoutObject } from '@/types'
import { WarehouseCanvas } from './WarehouseCanvas'
import { MapControls } from './MapControls'
import { useMapViewport } from './useMapViewport'

const HINT_AUTO_DISMISS_MS = 4000

type HintPhase = 'idle' | 'shown' | 'dismissed'

export interface MapStageProps {
  layout: WarehouseLayout
  placements: LayoutPlacement[]
  objects: LayoutObject[]
  floor: number
  onFloorChange: (floor: number) => void
  selectedLocationId: number | null
  highlightedLocationIds?: Set<number>
  onSelectBin: (locationId: number) => void
  binColors?: Map<number, string>
  binBadges?: Map<number, string>
  renderOverlay?: (cell: number) => ReactNode
}

export function MapStage({
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
}: MapStageProps) {
  const { viewport, containerRef, handlers, fit, zoomIn, zoomOut, isPanning, didDrag, gesturesEnabled } = useMapViewport({
    placements,
    objects,
    floor,
  })

  // A pan that ends over a bin must not select it — only forward a clean click.
  const guardedSelectBin = (locationId: number) => {
    if (!didDrag()) onSelectBin(locationId)
  }

  // First-hover hint pill: appears once on the first pointer-enter of the
  // stage, then auto-dismisses after HINT_AUTO_DISMISS_MS or on the first
  // pan/zoom gesture, and never returns for this mount (idle -> shown ->
  // dismissed is one-way — see the functional updaters below).
  const [hintPhase, setHintPhase] = useState<HintPhase>('idle')

  useEffect(() => {
    if (hintPhase !== 'shown') return
    const timer = setTimeout(() => setHintPhase('dismissed'), HINT_AUTO_DISMISS_MS)
    return () => clearTimeout(timer)
  }, [hintPhase])

  const showHint = useCallback(() => {
    setHintPhase((p) => (p === 'idle' ? 'shown' : p))
  }, [])

  const dismissHint = useCallback(() => {
    setHintPhase((p) => (p === 'shown' ? 'dismissed' : p))
  }, [])

  return (
    <div
      ref={containerRef}
      role="application"
      tabIndex={0}
      aria-label="Warehouse floor plan — arrow keys pan, plus and minus zoom, 0 to fit"
      className={`relative isolate h-full w-full overflow-hidden rounded-lg border border-stone-200 bg-stone-50 outline-none focus-visible:ring-2 focus-visible:ring-nexgen-blue/40 ${
        gesturesEnabled ? (isPanning ? 'cursor-grabbing' : 'cursor-grab') : ''
      }`}
      style={{ touchAction: gesturesEnabled ? 'none' : undefined }}
      onPointerEnter={gesturesEnabled ? showHint : undefined}
      onPointerDown={(e) => {
        dismissHint()
        handlers.onPointerDown(e)
      }}
      onPointerMove={handlers.onPointerMove}
      onPointerUp={handlers.onPointerUp}
      onPointerCancel={handlers.onPointerCancel}
      onWheel={(e) => {
        if (e.ctrlKey || e.metaKey) dismissHint()
      }}
      onKeyDown={handlers.onKeyDown}
    >
      <WarehouseCanvas
        layout={layout}
        placements={placements}
        objects={objects}
        floor={floor}
        viewport={viewport}
        selectedLocationId={selectedLocationId}
        highlightedLocationIds={highlightedLocationIds}
        onSelectBin={guardedSelectBin}
        binColors={binColors}
        binBadges={binBadges}
        renderOverlay={renderOverlay}
      />
      <MapControls
        scale={viewport.scale}
        onZoomIn={zoomIn}
        onZoomOut={zoomOut}
        onFit={fit}
        floor={floor}
        floorCount={layout.floorCount}
        onFloorChange={onFloorChange}
      />
      {gesturesEnabled && (
        <div
          aria-hidden="true"
          className={`map-panel-pill pointer-events-none absolute right-3 top-3 z-20 px-3 py-1.5 text-[11px] font-medium text-stone-600 transition-opacity duration-300 motion-reduce:duration-0 ${
            hintPhase === 'shown' ? 'opacity-100' : 'opacity-0'
          }`}
        >
          Drag to pan · Ctrl/⌘ + scroll to zoom
        </div>
      )}
    </div>
  )
}
