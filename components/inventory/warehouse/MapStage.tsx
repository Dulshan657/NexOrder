// Composes the pan/zoom container + useMapViewport + WarehouseCanvas into the
// interactive map stage. Owns nothing about warehouse data — floor/selection
// state stay with the caller — it only owns the viewport gesture wiring and
// suppresses a bin click when it lands right after a pan (drag-vs-click).
//
// MapControls docks bottom-left inside this container. The other floating
// panels are deliberately siblings of this stage, not children: a wheel event
// over a scrollable panel must not reach the container's non-passive wheel
// listener, or scrolling the tree would zoom the map instead.

import type { ReactNode } from 'react'
import type { WarehouseLayout, LayoutPlacement, LayoutObject } from '@/types'
import { WarehouseCanvas } from './WarehouseCanvas'
import { MapControls } from './MapControls'
import { useMapViewport } from './useMapViewport'

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

  return (
    <div
      ref={containerRef}
      role="application"
      tabIndex={0}
      aria-label="Warehouse floor plan — arrow keys pan, plus and minus zoom, 0 to fit"
      className={`relative isolate h-full w-full flex-1 min-h-0 overflow-hidden rounded-lg border border-stone-200 bg-stone-50 outline-none focus-visible:ring-2 focus-visible:ring-nexgen-blue/40 ${
        gesturesEnabled ? (isPanning ? 'cursor-grabbing' : 'cursor-grab') : ''
      }`}
      style={{ touchAction: gesturesEnabled ? 'none' : undefined }}
      onPointerDown={handlers.onPointerDown}
      onPointerMove={handlers.onPointerMove}
      onPointerUp={handlers.onPointerUp}
      onPointerCancel={handlers.onPointerCancel}
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
    </div>
  )
}
