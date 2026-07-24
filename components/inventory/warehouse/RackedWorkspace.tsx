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

import { useMemo, useState } from 'react'
import type { InventoryLocation, LayoutPlacement } from '@/types'
import { useLayoutDetail } from '@/hooks/queries/useLayouts'
import { usePickRoute } from '@/hooks/queries/usePickRoute'
import type { PutawayResponse } from '@/services/supabase/putawayService'
import { useWarehouseViewerModel } from './useWarehouseViewerModel'
import { MapStage } from './MapStage'
import { FloatingPanel } from './FloatingPanel'
import { WarehouseTreePanel } from './WarehouseTreePanel'
import { BinDetailPanel } from './BinDetailPanel'
import { OverlayControls } from './OverlayControls'
import { AskEnginePanel } from './AskEnginePanel'
import { slottingArrows, routePath, putawayMarkers } from './warehouseMarkers'
import { occupancyFill, velocityFill, congestionFill, type OverlayKind } from './warehouseOverlays'

export interface RackedWorkspaceProps {
  warehouseId: number
  layoutId: number
}

export function RackedWorkspace({ warehouseId, layoutId }: RackedWorkspaceProps) {
  const { data: detail, isLoading } = useLayoutDetail(layoutId)
  const model = useWarehouseViewerModel(warehouseId, layoutId)

  const [selectedLocationId, setSelectedLocationId] = useState<number | null>(null)
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
  if (isLoading || !detail) {
    return (
      <div aria-busy="true" className="flex flex-col gap-4">
        <span className="sr-only">Loading warehouse layout…</span>
        <div className="aspect-[4/3] w-full md:aspect-auto md:h-[65vh] md:min-h-[420px]">
          <div className="wh-shimmer h-full w-full rounded-lg" />
        </div>
      </div>
    )
  }

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

      <div className="aspect-[4/3] w-full md:aspect-auto md:h-[65vh] md:min-h-[420px]">
        <MapStage
          layout={detail.layout}
          placements={detail.placements}
          objects={detail.objects}
          floor={floor}
          onFloorChange={setFloor}
          selectedLocationId={selectedLocationId}
          highlightedLocationIds={highlightedLocationIds}
          onSelectBin={setSelectedLocationId}
          binColors={binColors}
          binBadges={binBadges}
          renderOverlay={renderMarkers}
          locationsById={model.locationsById}
        />
      </div>

      <div className="glass-card rounded-xl p-3">
        <OverlayControls overlay={overlay} onChange={setOverlay} />
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

        <FloatingPanel id="wh-bin-detail" title="Bin detail" className="max-h-[70vh]">
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
