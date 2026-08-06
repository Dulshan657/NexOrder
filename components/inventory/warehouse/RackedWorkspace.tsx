// The racked (published-layout) workspace: a tall pan/zoom map with an
// overlay-controls strip and a tree/bin-detail/test-bench panel row stacked
// below it in normal document flow. Owns all interactive state (selection,
// floor, overlay, dry-run results) — moved unchanged from the former inline
// `RackedWarehouseView` in WarehousePage.tsx.
//
// Responsive contract: single column at every width. Below `md` the map
// keeps a fixed `aspect-[4/3]` box and gestures are disabled (tap-to-select
// only); at `md+` the map is a tall `h-[65vh]` block. The panel row below it
// is `lg:grid-cols-[...]` (asymmetric: tree | bin detail | ask-engine) and
// collapses to one stacked column below `lg`. Nothing floats over the map
// except MapControls and the hint pill, both inside MapStage's own stacking
// context — this component no longer needs one of its own.

import { useMemo, useRef, useState } from 'react'
import type { InventoryLocation, LayoutPlacement, VelocityClass } from '@/types'
import { useLayoutDetail, useLayouts } from '@/hooks/queries/useLayouts'
import { usePickRoute } from '@/hooks/queries/usePickRoute'
import { useStorageTypes } from '@/hooks/queries/useStorageTypes'
import { useZoneProfiles } from '@/hooks/queries/useZoneProfiles'
import type { PutawayResponse } from '@/services/supabase/putawayService'
import { useWarehouseViewerModel } from './useWarehouseViewerModel'
import { zoneRegions as computeZoneRegions } from './zoneRegions'
import type { BinInfo } from './WarehouseCanvas'
import { MapStage } from './MapStage'
import { FloatingPanel } from './FloatingPanel'
import { WarehouseTreePanel } from './WarehouseTreePanel'
import { BinDetailPanel } from './BinDetailPanel'
import { RenameAreaModal } from './RenameAreaModal'
import { BindZonesModal } from './BindZonesModal'
import { AreaPaintToolbar } from './AreaPaintToolbar'
import { AreaPaintSummaryModal } from './AreaPaintSummaryModal'
import { useAreaPaintState } from './useAreaPaintState'
import { areaCellsFingerprint } from '@/lib/areaPaint'
import { OverlayControls } from './OverlayControls'
import { AskEnginePanel } from './AskEnginePanel'
import { slottingArrows, routePath, putawayMarkers } from './warehouseMarkers'
import { occupancyFill, velocityFill, congestionFill, type OverlayKind, type LegendEntry } from './warehouseOverlays'
import { zoneTint, zoneTypeLabel } from './zoneTints'
import { OBJECT_FILL } from '@/components/admin/layout/layoutPalette'
import { roleLabel, sortedRoles } from '@/lib/levelRoles'
import { useLevelRoles } from '@/hooks/queries/useLevelRoles'

/** Swatch for an area with no zone profile — the same neutral both canvases
 *  paint it with, so the legend never promises a colour the map doesn't use. */
const AREA_LEGEND_FALLBACK = OBJECT_FILL.area

export interface RackedWorkspaceProps {
  warehouseId: number
  layoutId: number
  /** Admin/Manager, per mutate-warehouse-location's role gate (mig 00094).
   *  Warehouse staff read the map; they do not rename what is on it. A button
   *  that always errors is worse than no button. */
  canRename?: boolean
}

export function RackedWorkspace({ warehouseId, layoutId, canRename = false }: RackedWorkspaceProps) {
  const { data: detail, isLoading } = useLayoutDetail(layoutId)
  const model = useWarehouseViewerModel(warehouseId, layoutId)
  const { data: storageTypes = [], isLoading: storageTypesLoading } = useStorageTypes()
  const { data: zoneProfiles = [] } = useZoneProfiles()
  const { data: levelRoles = [] } = useLevelRoles()

  const [selectedLocationId, setSelectedLocationId] = useState<number | null>(null)
  /** Area whose name is being edited (mig 00094); null = dialog closed. */
  const [renamingArea, setRenamingArea] = useState<string | null>(null)
  const [bindingZones, setBindingZones] = useState(false)

  // ── Area painting (mig 00095) ─────────────────────────────────────────────
  const paint = useAreaPaintState()
  const [confirmingPaint, setConfirmingPaint] = useState(false)
  /**
   * The fingerprint of the picture this session was built from, captured ONCE at
   * paint-mode entry.
   *
   * Held in a ref rather than recomputed from `detail`, because a background
   * refetch would otherwise move the baseline under the operator and the
   * conflict check would compare the server's picture against itself — silently
   * disabling the only protection against two people painting at once.
   */
  const baseFingerprintRef = useRef<string>('')
  const { data: layouts = [] } = useLayouts(warehouseId)
  const draftLayout = layouts.find((l) => l.status === 'draft')

  const beginPaint = () => {
    if (!detail) return
    baseFingerprintRef.current = areaCellsFingerprint(detail.objects as any)
    paint.dispatch({ type: 'begin', objects: detail.objects })
  }
  const [floor, setFloor] = useState(0)
  const [overlay, setOverlay] = useState<OverlayKind>('none')
  // Dry-run test-bench outputs drawn on the grid.
  const [putawayResult, setPutawayResult] = useState<PutawayResponse | null>(null)
  const [routeOrderIds, setRouteOrderIds] = useState<string[]>([])
  const routeQuery = usePickRoute(warehouseId, routeOrderIds)
  const routeStops = routeQuery.data?.mode === 'engine' ? routeQuery.data.route.stops : []

  const placements = detail?.placements ?? []
  const placementByLocation = useMemo(() => {
    const map = new Map<number, LayoutPlacement>()
    placements.forEach((p) => map.set(p.locationId, p))
    return map
  }, [placements])

  // Overlay fill per bin. Slotting draws arrows instead of fills.
  const binColors = useMemo(() => {
    if (overlay === 'none' || overlay === 'slotting') return undefined
    const map = new Map<number, string>()
    for (const p of placements) {
      if (overlay === 'occupancy') {
        map.set(p.locationId, occupancyFill(model.binFillPct.get(p.locationId)))
      } else if (overlay === 'velocity') {
        map.set(p.locationId, velocityFill(model.binVelocityClass.get(p.locationId)))
      } else if (overlay === 'congestion' && p.graphNodeId != null) {
        const c = congestionFill(model.visitsByNode.get(p.graphNodeId) ?? 0, model.maxVisits)
        if (c) map.set(p.locationId, c)
      }
    }
    return map
  }, [overlay, placements, model.binFillPct, model.binVelocityClass, model.visitsByNode, model.maxVisits])

  // "×N" badge on multi-product bins while the velocity overlay is active.
  const binBadges = useMemo(() => {
    if (overlay !== 'velocity') return undefined
    const map = new Map<number, string>()
    for (const p of placements) {
      const n = model.binContents.get(p.locationId)?.length ?? 0
      if (n > 1) map.set(p.locationId, `×${n}`)
    }
    return map
  }, [overlay, placements, model.binContents])

  // ── Map labelling data ─────────────────────────────────────────────────────
  // All of this is a reshape of queries already in memory (locations, storage
  // types, the viewer model) — the map used to receive only a flat colour per
  // bin, so it could not draw a code, a capacity or a form.

  const formColorById = useMemo(() => {
    const map = new Map<number, string>()
    for (const st of storageTypes) if (st.color) map.set(st.id, st.color)
    return map
  }, [storageTypes])

  const zoneTypeByProfileId = useMemo(() => {
    const map = new Map<number, string>()
    for (const zp of zoneProfiles) map.set(zp.id, zp.zoneType)
    return map
  }, [zoneProfiles])

  /** Per-location display record for on-map labels, spines and the hover card.
   *  Covers RACK parents too: a rack owns no stock itself, but it owns the code
   *  the map labels the cell with, and its capacity is the sum of its levels'. */
  const binInfo = useMemo(() => {
    const map = new Map<number, BinInfo>()
    for (const loc of model.locationsById.values()) {
      const contents = model.binContents.get(loc.id) ?? []
      // Dominant SKU by slots occupied — the same rule the tree and the detail
      // panel use to pick a bin's headline product.
      let top: (typeof contents)[number] | null = null
      for (const row of contents) if (!top || row.slots > top.slots) top = row

      let capacitySlots = loc.capacitySlots
      if (loc.kind === 'RACK') {
        const levels = model.levelsByRackId.get(loc.id) ?? []
        const summed = levels.reduce((acc, lv) => acc + (lv.capacitySlots ?? 0), 0)
        capacitySlots = summed > 0 ? summed : undefined
      }

      map.set(loc.id, {
        code: loc.code,
        // Already on the client: getWarehouseLocations does select('*'), so the
        // friendly name (mig 00094) arrives with no new query.
        name: loc.name,
        capacitySlots,
        slotKind: loc.slotKind,
        contentsCount: contents.length,
        topSku: top?.productName ?? undefined,
        formColor: loc.storageTypeId != null ? formColorById.get(loc.storageTypeId) : undefined,
      })
    }
    return map
  }, [model.locationsById, model.binContents, model.levelsByRackId, formColorById])

  /** Overlay colour for a whole rack, for the zoomed-out case where the cell is
   *  too small to draw a per-level spine.
   *
   *  This replaces the canvas's old "colour of whichever level happened to be
   *  first", which could paint a rack white when its pick face was jammed and
   *  its bulk level empty. Occupancy rolls up weighted by capacity; velocity
   *  reports the fastest class present and congestion the busiest node, since
   *  those are the levels an operator needs to notice. */
  const rackColors = useMemo(() => {
    if (overlay === 'none' || overlay === 'slotting') return undefined
    const map = new Map<number, string>()
    for (const [rackId, levels] of model.levelsByRackId) {
      if (overlay === 'occupancy') {
        let used = 0
        let capacity = 0
        for (const lv of levels) {
          const pct = model.binFillPct.get(lv.id)
          const cap = lv.capacitySlots
          if (pct == null || cap == null || cap <= 0) continue
          used += pct * cap
          capacity += cap
        }
        map.set(rackId, occupancyFill(capacity > 0 ? used / capacity : null))
      } else if (overlay === 'velocity') {
        const order: VelocityClass[] = ['A', 'B', 'C']
        let best: VelocityClass | null = null
        for (const lv of levels) {
          const cls = model.binVelocityClass.get(lv.id)
          if (cls && (best == null || order.indexOf(cls) < order.indexOf(best))) best = cls
        }
        map.set(rackId, velocityFill(best))
      } else if (overlay === 'congestion') {
        let peak = 0
        for (const lv of levels) {
          const node = placementByLocation.get(lv.id)?.graphNodeId
          if (node != null) peak = Math.max(peak, model.visitsByNode.get(node) ?? 0)
        }
        const c = congestionFill(peak, model.maxVisits)
        if (c) map.set(rackId, c)
      }
    }
    return map
  }, [
    overlay, model.levelsByRackId, model.binFillPct, model.binVelocityClass,
    model.visitsByNode, model.maxVisits, placementByLocation,
  ])

  /** Zones have no geometry of their own (see zoneRegions.ts) — recover the area
   *  each one covers from the cells of the bins parented under it. */
  const zoneAreas = useMemo(
    () => computeZoneRegions(placements, model.locationsById, floor),
    [placements, model.locationsById, floor],
  )

  /** Legend rows for the map's own colours, restricted to what this warehouse
   *  actually contains. Storage forms are omitted while an overlay is active
   *  because the overlay has recoloured those very bins — showing the form
   *  swatches then would explain a colour that is no longer on screen. */
  const legendExtras = useMemo(() => {
    const entries: LegendEntry[] = []

    if (overlay === 'none') {
      const usedFormIds = new Set<number>()
      for (const loc of model.locationsById.values()) {
        if (loc.storageTypeId != null) usedFormIds.add(loc.storageTypeId)
      }
      for (const st of storageTypes) {
        if (st.color && usedFormIds.has(st.id)) entries.push({ color: st.color, label: st.name })
      }
    }

    const usedRoleKeys = new Set<string>()
    for (const loc of model.locationsById.values()) {
      if (loc.levelRole) usedRoleKeys.add(loc.levelRole)
    }
    for (const role of sortedRoles(levelRoles)) {
      if (usedRoleKeys.has(role.key)) {
        entries.push({ color: role.colorFill, label: roleLabel(levelRoles, role.key) })
      }
    }

    // Named areas (mig 00090). Listed before the derived zone rows because an
    // area is what the operator actually drew and named; a zone region is
    // inferred from bin ancestry. Deduped by name — an area is many 1×1 cells.
    const seenAreas = new Set<string>()
    for (const o of detail?.objects ?? []) {
      if (o.objectType !== 'area' || o.floor !== floor) continue
      const name = typeof o.meta?.name === 'string' ? o.meta.name : ''
      if (!name || seenAreas.has(name)) continue
      seenAreas.add(name)
      const zp = o.meta?.zoneProfileId
      const zoneType = typeof zp === 'number' ? zoneTypeByProfileId.get(zp) : undefined
      entries.push({ color: zoneType ? zoneTint(zoneType) : AREA_LEGEND_FALLBACK, label: name })
    }

    const seenZoneTypes = new Set<string>()
    for (const area of zoneAreas) {
      const type = area.zoneProfileId != null ? zoneTypeByProfileId.get(area.zoneProfileId) : undefined
      const key = type ?? ''
      if (seenZoneTypes.has(key)) continue
      seenZoneTypes.add(key)
      entries.push({ color: zoneTint(type), label: `${zoneTypeLabel(type)} zone` })
    }

    return entries
  }, [overlay, model.locationsById, storageTypes, levelRoles, zoneAreas, zoneTypeByProfileId, detail?.objects, floor])

  // Highlight the descendant bins of a selected non-bin (zone/aisle/rack).
  const highlightedLocationIds = useMemo(() => {
    if (selectedLocationId == null) return undefined
    const sel = model.locationsById.get(selectedLocationId)
    if (!sel || sel.kind === 'BIN') return undefined
    const prefix = `${sel.materializedPath}/`
    const set = new Set<number>()
    for (const loc of model.locationsById.values()) {
      if (loc.kind === 'BIN' && loc.materializedPath.startsWith(prefix)) set.add(loc.id)
    }
    return set
  }, [selectedLocationId, model.locationsById])

  const selectLocation = (loc: InventoryLocation) => {
    setSelectedLocationId(loc.id)
    const placement = placementByLocation.get(loc.id)
    if (placement) setFloor(placement.floor)
  }

  /**
   * Selecting from the MAP has to bring Bin detail with it.
   *
   * The map is `md:h-[65vh]` and the panel row sits below it in normal document
   * flow, so clicking a bin — or a level in an expanded rack — answered entirely
   * off-screen: the panel filled in correctly and the operator never saw it, which
   * reads as "clicking does nothing".
   *
   * Only the map path scrolls. The tree already scrolls its own selected row into
   * view (WarehouseTreePanel's useLayoutEffect), and scrolling the page from there
   * too would fight it — selecting in the tree would yank the tree off-screen.
   */
  const binDetailRef = useRef<HTMLDivElement | null>(null)
  const selectFromMap = (locationId: number) => {
    setSelectedLocationId(locationId)
    const reduced =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    binDetailRef.current?.scrollIntoView({
      block: 'nearest',
      behavior: reduced ? 'auto' : 'smooth',
    })
  }

  const selectedLocation = selectedLocationId != null ? model.locationsById.get(selectedLocationId) ?? null : null
  const selectedPlacement = selectedLocationId != null ? placementByLocation.get(selectedLocationId) : undefined
  const nodeVisits =
    selectedPlacement?.graphNodeId != null ? model.visitsByNode.get(selectedPlacement.graphNodeId) : undefined

  // The rack a selected level (or a directly-selected rack) belongs to — used
  // to feed RackLevelEditor its full sibling list, not just the one row the
  // map/tree happened to select (mig 00072).
  const selectedRackId =
    selectedLocation?.kind === 'RACK'
      ? selectedLocation.id
      : selectedLocation?.kind === 'SHELF' && selectedLocation.levelIndex != null
        ? selectedLocation.parentId ?? null
        : null
  const rackLevelLocations = selectedRackId != null ? model.levelsByRackId.get(selectedRackId) ?? [] : []
  const rackFillByLevel = useMemo(() => {
    const map = new Map<number, number>()
    for (const loc of rackLevelLocations) {
      if (loc.levelIndex == null) continue
      const pct = model.binFillPct.get(loc.id)
      if (pct != null) map.set(loc.levelIndex, pct)
    }
    return map
  }, [rackLevelLocations, model.binFillPct])

  const zoneName = useMemo(() => {
    if (!selectedLocation) return undefined
    let cur: InventoryLocation | undefined = selectedLocation
    while (cur) {
      if (cur.kind === 'ZONE') return cur.name
      cur = cur.parentId != null ? model.locationsById.get(cur.parentId) : undefined
    }
    return undefined
  }, [selectedLocation, model.locationsById])

  // Compose the marker layers: dry-run route + putaway always show; slotting
  // arrows only when its overlay is active.
  const putawayRec = putawayResult?.mode === 'engine' ? putawayResult.recommendations[0] : null
  const renderMarkers = (cell: number) => (
    <g>
      {routeStops.length > 0 && routePath(cell, routeStops, placementByLocation, floor)}
      {putawayRec && putawayMarkers(cell, putawayRec, placementByLocation, floor)}
      {overlay === 'slotting' && slottingArrows(cell, model.slotting, placementByLocation, floor)}
    </g>
  )

  // Skeleton mirrors the loaded shape (a tall map slot) so the tab doesn't
  // reflow when the layout lands — this is the first frame of every demo.
  //
  // Gated on THREE queries, not one. The layout supplies geometry; the storage
  // forms supply every fill colour and the locations supply every code, the tree
  // and a levelled rack's colour. Waiting on the layout alone opened a window
  // where geometry had landed and the other two had not, and the canvas has a
  // defined-but-wrong answer for that state: `formColorById` and `locationsById`
  // are both empty, so every bin falls through to DEFAULT_BIN_FILL and the tree
  // renders "No storage locations defined for this warehouse." An operator sees a
  // finished-looking grey map that silently recolours a moment later, which reads
  // as a rendering bug rather than as loading — and is exactly what was reported
  // on NEXG. Deliberately NOT gated on `model.isLoading`: that bundles velocity
  // and traffic, whose absence costs a `0%` label, not the picture.
  if (isLoading || !detail || model.isCoreLoading || storageTypesLoading) {
    return (
      <div aria-busy="true" className="flex flex-col gap-4">
        <span className="sr-only">Loading warehouse layout…</span>
        <div className="aspect-[4/3] w-full md:aspect-auto md:h-[65vh] md:min-h-[420px]">
          <div className="wh-shimmer h-full w-full rounded-lg" />
        </div>
      </div>
    )
  }

  // While painting, the canvas draws the WORKING SET in place of the stored
  // areas — through the very same shape the stored rows have, so the preview and
  // the saved result cannot look different. Every other object is untouched.
  const canvasObjects = paint.state.active
    ? [...detail.objects.filter((o) => o.objectType !== 'area'), ...paint.previewObjects]
    : detail.objects

  return (
    <div className="flex flex-col gap-4">
      {/* The tree (not the map) is the keyboard/AT selection path — this
          announces what just got selected, from either surface. A rack level
          (mig 00072) gets a friendlier phrasing than its raw SHELF kind. */}
      <div aria-live="polite" className="sr-only">
        {selectedLocation
          ? selectedLocation.kind === 'SHELF' && selectedLocation.levelIndex != null
            ? `Selected level ${selectedLocation.levelIndex} (${selectedLocation.code})`
            : `Selected ${selectedLocation.kind.toLowerCase()} ${selectedLocation.code}`
          : ''}
      </div>

      {/* Painting is a pointer-drag on a pan/zoom surface, which has no honest
          one-finger equivalent — MapStage disables gestures below md anyway, so
          the entry point is desktop-only rather than ambiguous on a phone. */}
      {canRename && !paint.state.active && (
        <div className="hidden md:flex md:justify-end md:gap-2">
          {/* Painting and saving bind automatically (mig 00096), so this is for a
              site painted before that existed — and it is the only surface that
              previews a re-parent before it happens. */}
          <button
            type="button"
            onClick={() => setBindingZones(true)}
            className="rounded-lg border border-stone-200 bg-white px-3 py-1.5 text-xs font-medium text-stone-600 btn-press hover:bg-stone-50"
          >
            Bind areas to zones
          </button>
          <button
            type="button"
            onClick={beginPaint}
            className="rounded-lg border border-stone-200 bg-white px-3 py-1.5 text-xs font-medium text-stone-600 btn-press hover:bg-stone-50"
          >
            Paint areas
          </button>
        </div>
      )}

      {paint.state.active && (
        <AreaPaintToolbar
          brush={paint.state.brush}
          mode={paint.state.mode}
          areaNames={paint.names}
          zoneProfiles={zoneProfiles}
          dirty={paint.state.dirty}
          canUndo={paint.state.undo.length > 0}
          saving={confirmingPaint}
          draftWarning={draftLayout
            ? `A draft of this layout exists (“${draftLayout.name}”). Publishing it will replace these areas.`
            : null}
          onBrushName={(name) => paint.dispatch({ type: 'set_brush_name', name })}
          onBrushProfile={(zoneProfileId) => paint.dispatch({ type: 'set_brush_profile', zoneProfileId })}
          onMode={(mode) => paint.dispatch({ type: 'set_mode', mode })}
          onEraseArea={(name) => paint.dispatch({ type: 'erase_area', name })}
          onUndo={() => paint.dispatch({ type: 'undo' })}
          onCancel={() => paint.dispatch({ type: 'cancel' })}
          onSave={() => setConfirmingPaint(true)}
        />
      )}

      <div className="aspect-[4/3] w-full md:aspect-auto md:h-[65vh] md:min-h-[420px]">
        <MapStage
          layout={detail.layout}
          placements={detail.placements}
          objects={canvasObjects}
          floor={floor}
          onFloorChange={setFloor}
          selectedLocationId={selectedLocationId}
          highlightedLocationIds={highlightedLocationIds}
          onSelectBin={selectFromMap}
          binColors={binColors}
          rackColors={rackColors}
          binBadges={binBadges}
          binInfo={binInfo}
          binFillPct={model.binFillPct}
          zoneRegions={zoneAreas}
          zoneTypeByProfileId={zoneTypeByProfileId}
          renderOverlay={renderMarkers}
          locationsById={model.locationsById}
          // The pencil and paint mode must never be live together: both rewrite
          // the same rows, and a rename applied against a working set that has
          // not been saved would be computed from a picture the server has
          // never seen.
          onRenameArea={canRename && !paint.state.active ? setRenamingArea : undefined}
          paint={{
            active: paint.state.active,
            onStrokeStart: () => paint.dispatch({ type: 'stroke_start' }),
            onPaintCell: paint.paintCell,
          }}
        />
      </div>

      {renamingArea && (
        <RenameAreaModal
          warehouseId={warehouseId}
          areaName={renamingArea}
          onClose={() => setRenamingArea(null)}
        />
      )}

      {bindingZones && (
        <BindZonesModal warehouseId={warehouseId} onClose={() => setBindingZones(false)} />
      )}

      {confirmingPaint && (
        <AreaPaintSummaryModal
          warehouseId={warehouseId}
          layoutId={layoutId}
          baseFingerprint={baseFingerprintRef.current}
          specs={paint.specs}
          floorCount={detail.layout.floorCount}
          onClose={() => setConfirmingPaint(false)}
          onSaved={() => {
            setConfirmingPaint(false)
            // Leave paint mode outright rather than re-hydrating: the mutation
            // has invalidated layout-detail, and the next `detail` to arrive is
            // the server's answer. Staying in with a stale baseFingerprint would
            // make the very next save 409.
            paint.dispatch({ type: 'cancel' })
          }}
        />
      )}

      <div className="glass-card rounded-xl p-3">
        <OverlayControls overlay={overlay} onChange={setOverlay} extraEntries={legendExtras} />
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,18rem)_minmax(0,1fr)_minmax(0,22rem)]">
        <FloatingPanel id="wh-tree" title="Locations" className="max-h-[70vh]">
          <WarehouseTreePanel
            tree={model.tree}
            binContents={model.binContents}
            binFillPct={model.binFillPct}
            selectedLocationId={selectedLocationId}
            onSelect={selectLocation}
          />
        </FloatingPanel>

        <FloatingPanel
          id="wh-bin-detail"
          title="Bin detail"
          className="max-h-[70vh]"
          containerRef={binDetailRef}
        >
          <BinDetailPanel
            warehouseId={warehouseId}
            location={selectedLocation}
            contents={selectedLocationId != null ? model.binContents.get(selectedLocationId) ?? [] : []}
            fillPct={selectedLocationId != null ? model.binFillPct.get(selectedLocationId) : undefined}
            placement={selectedPlacement}
            nodeVisits={nodeVisits}
            zoneName={zoneName}
            rackLevelLocations={rackLevelLocations}
            rackFillByLevel={rackFillByLevel}
            onSelectLevel={setSelectedLocationId}
            canRename={canRename}
          />
          {/* Slotting's suggested moves live here rather than as a separate
              panel: they're overlay-driven context about what's currently on
              the map, same as the selected bin's contents. */}
          {overlay === 'slotting' && model.slotting.length > 0 && (
            <div className="mt-3 rounded-lg border border-stone-200 bg-white/60 p-2 text-xs">
              <p className="mb-1 font-semibold text-stone-700">Suggested moves</p>
              <ul className="space-y-0.5 text-stone-500">
                {model.slotting.map((s) => (
                  <li key={s.id} className="font-mono">
                    #{s.productId}: {model.locationsById.get(s.fromLocationId)?.code ?? s.fromLocationId} →{' '}
                    {model.locationsById.get(s.toLocationId)?.code ?? s.toLocationId}
                    <span className="ml-1 text-emerald-600">−{Math.round(s.expectedGainM)}m</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </FloatingPanel>

        <AskEnginePanel
          className="max-h-[70vh]"
          warehouseId={warehouseId}
          layoutId={layoutId}
          onPutawayResult={setPutawayResult}
          routeOrderIds={routeOrderIds}
          onRouteOrderIdsChange={setRouteOrderIds}
        />
      </div>
    </div>
  )
}
