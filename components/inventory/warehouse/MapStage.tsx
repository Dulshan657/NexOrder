// Composes the pan/zoom container + useMapViewport + WarehouseCanvas into the
// interactive map stage. Owns nothing about warehouse data — floor/selection
// state stay with the caller — it only owns the viewport gesture wiring, the
// drag-vs-click suppression, and the hover card.
//
// MapControls docks bottom-left inside this container, and a first-hover hint
// pill docks top-right. Both are on-map chrome that lives inside this
// component's own `relative isolate` stacking context; every other panel
// (tree, bin detail, overlays, ask-engine) now renders below the map in
// normal document flow, not as a floating sibling — the wheel listener no
// longer preventDefaults unconditionally (it requires Ctrl/⌘), so there's no
// scroll-trap for a panel to worry about.
//
// The hover card lives here rather than in the canvas because positioning it
// needs the viewport transform (which this component owns) and because HTML
// gives it text wrapping and shadows that an SVG <text> cannot. The canvas also
// emits a plain <title> per bin as the no-pointer/assistive fallback.

import { useCallback, useEffect, useState, type ReactNode } from 'react'
import type { WarehouseLayout, LayoutPlacement, LayoutObject, InventoryLocation } from '@/types'
import { WarehouseCanvas, type BinInfo, type BinHover } from './WarehouseCanvas'
import { MapControls } from './MapControls'
import { useMapViewport } from './useMapViewport'
import { BASE_CELL } from '@/components/admin/layout/layoutPalette'
import { ScaleIndicator } from '@/components/admin/layout/ScaleIndicator'
import type { ZoneRegion } from './zoneRegions'

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
  rackColors?: Map<number, string>
  binBadges?: Map<number, string>
  binInfo?: Map<number, BinInfo>
  binFillPct?: Map<number, number | null>
  zoneRegions?: ZoneRegion[]
  zoneTypeByProfileId?: Map<number, string>
  renderOverlay?: (cell: number) => ReactNode
  /** Location metadata for labelling a rack's exploded level stack (mig 00072). */
  locationsById?: Map<number, InventoryLocation>
  /** Admin/Manager clicked an area's name to rename it (mig 00094). Passed
   *  straight through; the canvas routes it via `guardClick` so a pan that ends
   *  over the label does not open a dialog. */
  onRenameArea?: (areaName: string) => void
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
  rackColors,
  binBadges,
  binInfo,
  binFillPct,
  zoneRegions,
  zoneTypeByProfileId,
  renderOverlay,
  locationsById,
  onRenameArea,
}: MapStageProps) {
  const { viewport, containerRef, handlers, fit, zoomIn, zoomOut, isPanning, didDrag, gesturesEnabled } = useMapViewport({
    placements,
    objects,
    floor,
  })

  // A pan that ends over a bin must not select it — only forward a clean click.
  //
  // useCallback is load-bearing, not tidiness: WarehouseCanvas memoizes its
  // whole scene on everything except the pan offset, and a handler with a fresh
  // identity on every viewport change would bust that memo on every drag frame.
  const guardedSelectBin = useCallback((locationId: number) => {
    if (!didDrag()) onSelectBin(locationId)
  }, [didDrag, onSelectBin])

  // Same guard, generalised for the rack expand/collapse interactions (not a
  // bin selection, so they don't go through guardedSelectBin above) — a pan
  // that ends over a rack must not toggle its expansion either.
  const guardClick = useCallback((fn: () => void) => {
    if (!didDrag()) fn()
  }, [didDrag])

  const [hover, setHover] = useState<BinHover | null>(null)
  const handleHover = useCallback((next: BinHover | null) => {
    setHover(next)
  }, [])

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

  // Dragging the map past a bin shouldn't flash a card at every bin it crosses.
  const hoverInfo = !isPanning && hover ? binInfo?.get(hover.locationId) : undefined

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
      onPointerLeave={() => setHover(null)}
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
        rackColors={rackColors}
        binBadges={binBadges}
        binInfo={binInfo}
        binFillPct={binFillPct}
        zoneRegions={zoneRegions}
        zoneTypeByProfileId={zoneTypeByProfileId}
        renderOverlay={renderOverlay}
        locationsById={locationsById}
        guardClick={guardClick}
        onHoverBin={handleHover}
        onRenameArea={onRenameArea}
      />
      {hover && hoverInfo && (
        <BinHoverCard hover={hover} info={hoverInfo} viewport={viewport} />
      )}
      <MapControls
        scale={viewport.scale}
        onZoomIn={zoomIn}
        onZoomOut={zoomOut}
        onFit={fit}
        floor={floor}
        floorCount={layout.floorCount}
        onFloorChange={onFloorChange}
      />
      {/* Same scale bar the designer draws, off the same maths — the ops map and
          the plan it was drawn from must agree about how long 5 m is. */}
      <div className="map-panel-pill pointer-events-none absolute bottom-3 right-3 z-20 px-3 py-1.5">
        <ScaleIndicator pxPerCell={BASE_CELL * viewport.scale} cellSizeM={layout.cellSizeM} />
      </div>
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

interface BinHoverCardProps {
  hover: BinHover
  info: BinInfo
  viewport: { scale: number; tx: number; ty: number }
}

/** Floating detail card, anchored above the hovered cell.
 *
 *  `pointer-events-none` is essential: the card overlaps the cell that spawned
 *  it, and an interactive card would steal the pointerleave and strobe. */
function BinHoverCard({ hover, info, viewport }: BinHoverCardProps) {
  const left = viewport.tx + (hover.x + hover.w / 2) * BASE_CELL * viewport.scale
  const top = viewport.ty + hover.y * BASE_CELL * viewport.scale

  return (
    <div
      aria-hidden="true"
      className="map-panel-pill pointer-events-none absolute z-30 max-w-[16rem] -translate-x-1/2 -translate-y-full px-2.5 py-1.5 text-[11px] leading-snug text-stone-700"
      style={{ left, top: top - 8 }}
    >
      <p className="font-mono font-semibold text-stone-900">{info.code}</p>
      <p className="text-stone-500">
        {hover.levelCount > 0 && <>{hover.levelCount} levels · </>}
        {hover.fillPct != null ? `${Math.round(hover.fillPct * 100)}% full` : 'No capacity set'}
        {info.capacitySlots ? ` of ${info.capacitySlots} ${info.slotKind ?? 'slot'}s` : ''}
      </p>
      {info.contentsCount > 0 ? (
        <p className="truncate text-stone-500">
          {info.topSku}
          {info.contentsCount > 1 && ` +${info.contentsCount - 1} more`}
        </p>
      ) : (
        <p className="text-stone-400">Empty</p>
      )}
    </div>
  )
}
