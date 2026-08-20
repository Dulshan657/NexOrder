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

import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import type { WarehouseLayout, LayoutPlacement, LayoutObject, InventoryLocation } from '@/types'
import { WarehouseCanvas, type BinInfo, type BinHover } from './WarehouseCanvas'
import { MapControls } from './MapControls'
import { useMapViewport } from './useMapViewport'
import { BASE_CELL } from '@/components/admin/layout/layoutPalette'
import { ScaleIndicator } from '@/components/admin/layout/ScaleIndicator'
import type { ZoneRegion } from './zoneRegions'
import { MapSelectionLayer, type SelectionCell } from './MapSelectionLayer'

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
  /** Admin/Manager clicked a floor sign's text to edit or remove it (mig 00097).
   *  Routed through `guardClick` on the same terms as onRenameArea. */
  onEditSign?: (signName: string) => void
  /**
   * Area paint mode (mig 00095).
   *
   * The cell is derived HERE rather than in the canvas because this component
   * owns `viewport`, and WarehouseCanvas's scene memo deliberately excludes
   * `viewport.tx/ty` so a pan is a single `<g transform>` update — threading the
   * viewport through `renderOverlay` would drag the whole 189-bay scene into
   * every drag frame.
   */
  paint?: {
    active: boolean
    /** One undo snapshot per stroke, so a 60-cell drag is one Ctrl+Z. */
    onStrokeStart: () => void
    onPaintCell: (floor: number, x: number, y: number) => void
  }
  /**
   * Selection for a code sweep (migs 00107 / 00108).
   *
   * Cells derived here for the same reason paint's are — this component owns the
   * viewport. Mutually exclusive with `paint`: both rewrite `locations` rows, and a
   * sweep computed against an unsaved area working set would be computed from a
   * picture the server has never seen. RackedWorkspace enforces that structurally,
   * via mapMode.ts, rather than by remembering to pass only one.
   */
  select?: {
    active: boolean
    /** Which brush is armed. `paint` walks cells; `rect` drags a band. */
    tool: 'paint' | 'rect'
    /** One undo snapshot per stroke, so a 60-cell drag is one Ctrl+Z. */
    onStrokeStart: () => void
    /** The brush. Uses the NULLING cell helper — a stroke past the edge must not
     *  wrap onto the last valid cell. */
    onSelectCell: (floor: number, x: number, y: number) => void
    /** The band. Uses the CLAMPING helper — dragging one pixel outside the grid
     *  must not freeze the rectangle mid-drag. */
    onDragStart: (floor: number, x: number, y: number, additive: boolean) => void
    onDragMove: (x: number, y: number) => void
    onDragEnd: () => void
    /** The band being dragged, in grid cells. Null between drags. */
    rect: { floor: number; x0: number; y0: number; x1: number; y1: number } | null
    /** One box per selected unit, drawn by MapSelectionLayer — a SIBLING of the
     *  canvas, never a prop of it. See that file for why. Derived from the
     *  selection alone, so it survives a plan that cannot be computed. */
    cells: readonly SelectionCell[]
    /** locationId → its proposed code, for the overlay's text. May be empty while
     *  the boxes above still draw. */
    ghosts: ReadonlyMap<number, string>
  }
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
  onEditSign,
  paint,
  select,
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

  // ── Area paint mode (mig 00095) ───────────────────────────────────────────
  const paintingRef = useRef<number | null>(null)
  const painting = paint?.active === true

  /** Screen point → grid cell. Mirrors LayoutCanvas.cellFromEvent, but subtracts
   *  the viewport offset where that one subtracts RULER_PX — get this wrong and
   *  every stroke lands one cell off. */
  const cellFromEvent = useCallback((e: ReactPointerEvent<HTMLElement>) => {
    const el = containerRef.current
    if (!el) return null
    const rect = el.getBoundingClientRect()
    const px = BASE_CELL * viewport.scale
    const x = Math.floor((e.clientX - rect.left - viewport.tx) / px)
    const y = Math.floor((e.clientY - rect.top - viewport.ty) / px)
    if (x < 0 || y < 0 || x >= layout.gridWidth || y >= layout.gridHeight) return null
    return { x, y }
  }, [containerRef, viewport.scale, viewport.tx, viewport.ty, layout.gridWidth, layout.gridHeight])

  const paintAt = useCallback((e: ReactPointerEvent<HTMLElement>) => {
    const cell = cellFromEvent(e)
    if (cell) paint?.onPaintCell(floor, cell.x, cell.y)
  }, [cellFromEvent, paint, floor])

  const endPaint = useCallback((e: ReactPointerEvent<HTMLElement>): boolean => {
    if (paintingRef.current !== e.pointerId) return false
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
    paintingRef.current = null
    return true
  }, [])

  // ── Sweep selection (migs 00107 / 00108) ──────────────────────────────────
  //
  // Two gestures, one mode. The brush is the primary one — a band could not express
  // the shape of a real bulk block without swallowing its neighbours — and the
  // rectangle is kept for the cases that genuinely are rectangular.
  const marqueeRef = useRef<number | null>(null)
  const brushRef = useRef<number | null>(null)
  const sweeping = select?.active === true
  const brushing = sweeping && select?.tool === 'paint'
  const banding = sweeping && select?.tool === 'rect'

  const selectAt = useCallback((e: ReactPointerEvent<HTMLElement>) => {
    const cell = cellFromEvent(e)
    if (cell) select?.onSelectCell(floor, cell.x, cell.y)
  }, [cellFromEvent, select, floor])

  const endBrush = useCallback((e: ReactPointerEvent<HTMLElement>): boolean => {
    if (brushRef.current !== e.pointerId) return false
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
    brushRef.current = null
    return true
  }, [])

  /** Like cellFromEvent but CLAMPED instead of null out of bounds. Paint wants the
   *  null — a stroke past the edge must not wrap to the last valid cell. A band
   *  wants the clamp, or dragging one pixel outside the grid freezes it mid-drag. */
  const clampedCellFromEvent = useCallback((e: ReactPointerEvent<HTMLElement>) => {
    const el = containerRef.current
    if (!el) return null
    const rect = el.getBoundingClientRect()
    const px = BASE_CELL * viewport.scale
    const raw = {
      x: Math.floor((e.clientX - rect.left - viewport.tx) / px),
      y: Math.floor((e.clientY - rect.top - viewport.ty) / px),
    }
    return {
      x: Math.max(0, Math.min(layout.gridWidth - 1, raw.x)),
      y: Math.max(0, Math.min(layout.gridHeight - 1, raw.y)),
    }
  }, [containerRef, viewport.scale, viewport.tx, viewport.ty, layout.gridWidth, layout.gridHeight])

  const endMarquee = useCallback((e: ReactPointerEvent<HTMLElement>): boolean => {
    if (marqueeRef.current !== e.pointerId) return false
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
    marqueeRef.current = null
    select?.onDragEnd()
    return true
  }, [select])

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

  // Dragging the map past a bin shouldn't flash a card at every bin it crosses,
  // and neither should painting over one.
  const hoverInfo = !isPanning && !painting && !sweeping && hover ? binInfo?.get(hover.locationId) : undefined

  return (
    <div
      ref={containerRef}
      role="application"
      tabIndex={0}
      aria-label="Warehouse floor plan — arrow keys pan, plus and minus zoom, 0 to fit"
      className={`relative isolate h-full w-full overflow-hidden rounded-lg border border-stone-200 bg-stone-50 outline-none focus-visible:ring-2 focus-visible:ring-nexgen-blue/40 ${
        painting || sweeping ? 'cursor-crosshair' : gesturesEnabled ? (isPanning ? 'cursor-grabbing' : 'cursor-grab') : ''
      }`}
      style={{ touchAction: gesturesEnabled ? 'none' : undefined }}
      onPointerEnter={gesturesEnabled ? showHint : undefined}
      onPointerDown={(e) => {
        dismissHint()
        // Alt falls through to the pan path, which is how the operator still
        // reaches the rest of the floor while painting — useMapViewport only
        // pans on button 0, so there is no middle-drag to fall back on.
        if (painting && !e.altKey && (e.pointerType !== 'mouse' || e.button === 0)) {
          // Eager capture is correct HERE AND ONLY HERE. The lazy capture in
          // useMapViewport exists to preserve the trailing `click` on a child
          // bin; in paint mode there is no child click to preserve, and routing
          // the click to the container is exactly what stops a stroke from also
          // selecting a bin. Do not port this into useMapViewport.
          e.currentTarget.setPointerCapture(e.pointerId)
          paintingRef.current = e.pointerId
          paint?.onStrokeStart()
          paintAt(e)
          return
        }
        // A marquee is the paint case, not the pan case: eager capture, because
        // there is no child click to preserve and routing the click to the
        // container is exactly what stops a band that ends over a bin from also
        // selecting it and scrolling Bin detail into view. Alt still falls through
        // to pan, so the operator can reach the rest of the floor mid-selection.
        if (brushing && !e.altKey && (e.pointerType !== 'mouse' || e.button === 0)) {
          e.currentTarget.setPointerCapture(e.pointerId)
          brushRef.current = e.pointerId
          select?.onStrokeStart()
          selectAt(e)
          return
        }
        if (banding && !e.altKey && (e.pointerType !== 'mouse' || e.button === 0)) {
          const cell = clampedCellFromEvent(e)
          if (cell) {
            e.currentTarget.setPointerCapture(e.pointerId)
            marqueeRef.current = e.pointerId
            select?.onDragStart(floor, cell.x, cell.y, e.shiftKey)
            return
          }
        }
        handlers.onPointerDown(e)
      }}
      onPointerMove={(e) => {
        if (paintingRef.current === e.pointerId) {
          paintAt(e)
          return
        }
        if (brushRef.current === e.pointerId) {
          selectAt(e)
          return
        }
        if (marqueeRef.current === e.pointerId) {
          const cell = clampedCellFromEvent(e)
          if (cell) select?.onDragMove(cell.x, cell.y)
          return
        }
        handlers.onPointerMove(e)
      }}
      onPointerUp={(e) => {
        if (endPaint(e)) return
        if (endBrush(e)) return
        if (endMarquee(e)) return
        handlers.onPointerUp(e)
      }}
      onPointerCancel={(e) => {
        if (endPaint(e)) return
        if (endBrush(e)) return
        if (endMarquee(e)) return
        handlers.onPointerCancel(e)
      }}
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
        onEditSign={onEditSign}
      />
      {hover && hoverInfo && (
        <BinHoverCard hover={hover} info={hoverInfo} viewport={viewport} />
      )}
      {/* The selection and its proposed codes. Same argument as the band below,
          only stronger: this changes on every painted cell. */}
      {sweeping && select && (
        <MapSelectionLayer cells={select.cells} ghosts={select.ghosts} floor={floor} viewport={viewport} />
      )}
      {/* The rubber band. Plain HTML off the viewport transform, the same
          arithmetic BinHoverCard uses — deliberately NOT an SVG element in the
          scene, whose memo excludes viewport.tx/ty and must not start seeing a
          shape that changes on every pointer move. */}
      {select?.rect && select.rect.floor === floor && (
        <MarqueeBand rect={select.rect} viewport={viewport} />
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

interface MarqueeBandProps {
  rect: { floor: number; x0: number; y0: number; x1: number; y1: number }
  viewport: { scale: number; tx: number; ty: number }
}

/** The rubber band, drawn from the normalised cell rect so it looks the same
 *  whichever direction the operator dragged. `pointer-events-none` because the
 *  container holds the pointer capture and the band must not intercept anything. */
function MarqueeBand({ rect, viewport }: MarqueeBandProps) {
  const px = BASE_CELL * viewport.scale
  const x0 = Math.min(rect.x0, rect.x1)
  const y0 = Math.min(rect.y0, rect.y1)
  const x1 = Math.max(rect.x0, rect.x1)
  const y1 = Math.max(rect.y0, rect.y1)

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute z-30 rounded-[2px] border-2 border-dashed border-nexgen-blue bg-nexgen-blue/10"
      style={{
        left: viewport.tx + x0 * px,
        top: viewport.ty + y0 * px,
        width: (x1 - x0 + 1) * px,
        height: (y1 - y0 + 1) * px,
      }}
    />
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
