// Read-only Warehouse viewer — the operational surface for the Warehouse
// Intelligence Engine. Admin/Manager staff have no home warehouse, so this page
// owns its own warehouse picker (mirrors PutawayQueuePage); Warehouse staff
// default to their home site. Racked (layout-published) warehouses render the
// 2D grid + synced tree + bin detail; bulk / unpublished warehouses fall back to
// a plain stock list. Overlays + dry-run test bench mount here in later phases.
// Nothing here ever mutates inventory.

import React, { useMemo, useState } from 'react'
import { LayoutGrid } from 'lucide-react'
import type { InventoryLocation, LayoutPlacement, User, Warehouse } from '@/types'
import { useWarehouses } from '@/hooks/queries/useWarehouses'
import { useLayouts, useLayoutDetail } from '@/hooks/queries/useLayouts'
import { useWarehouseReport } from '@/hooks/queries/useWarehouseReport'
import { usePickRoute } from '@/hooks/queries/usePickRoute'
import type { PutawayResponse } from '@/services/supabase/putawayService'
import { useWarehouseViewerModel } from './useWarehouseViewerModel'
import { WarehouseCanvas } from './WarehouseCanvas'
import { WarehouseTreePanel } from './WarehouseTreePanel'
import { BinDetailPanel } from './BinDetailPanel'
import { WarehouseEmptyState } from './WarehouseEmptyState'
import { OverlayControls } from './OverlayControls'
import { WarehouseTestBench } from './WarehouseTestBench'
import { slottingArrows, routePath, putawayMarkers } from './warehouseMarkers'
import { occupancyFill, velocityFill, congestionFill, type OverlayKind } from './warehouseOverlays'

interface WarehousePageProps {
  currentUser: User
  /** Navigate into the Layout Designer (Settings) for a warehouse — used by the
   *  empty-state CTA when a site has no visual grid yet. */
  onOpenDesigner?: (warehouseId: number, opts?: { import?: boolean }) => void
}

/** True when a warehouse renders as a visual grid (racked + a published layout). */
function isRackedPublished(w: Warehouse | undefined): boolean {
  return !!w && w.locationType === 'racked' && w.activeLayoutId != null
}

/**
 * Pick which warehouse the viewer opens on. We prefer a warehouse that actually
 * has a visual grid so the tab doesn't land on the redundant bulk stock list.
 * Priority: (1) ?wh= deep link, (2) home warehouse if racked+published,
 * (3) first racked+published site, (4) home warehouse, (5) first active.
 * Pure + exported for unit testing.
 */
export function resolveDefaultWarehouse(
  warehouses: Warehouse[],
  urlId: number | null,
  homeId: number | undefined,
): number | null {
  const active = warehouses.filter((w) => w.isActive)
  const byId = (id: number | null | undefined) => (id != null ? active.find((w) => w.id === id) : undefined)

  if (byId(urlId)) return urlId as number
  if (isRackedPublished(byId(homeId))) return homeId as number
  const firstRacked = active.find(isRackedPublished)
  if (firstRacked) return firstRacked.id
  if (byId(homeId)) return homeId as number
  return active[0]?.id ?? null
}

// Deep-link the selected warehouse via ?wh= so a refresh / shared link reopens it.
function readInitialWarehouse(): number | null {
  if (typeof window === 'undefined') return null
  const v = new URLSearchParams(window.location.search).get('wh')
  return v && /^\d+$/.test(v) ? Number(v) : null
}

function writeWarehouseToUrl(id: number | null): void {
  if (typeof window === 'undefined') return
  const url = new URL(window.location.href)
  if (id != null) url.searchParams.set('wh', String(id))
  else url.searchParams.delete('wh')
  window.history.replaceState({}, '', url.toString())
}

function KpiStrip({ warehouseId }: { warehouseId: number }) {
  const { data: report } = useWarehouseReport(warehouseId)
  if (!report) return null
  const util = report.utilizationPct != null ? `${Math.round(report.utilizationPct * 100)}%` : '—'
  const items = [
    { label: 'Racks', value: report.binCount },
    { label: 'Empty', value: report.emptyBins },
    { label: 'Utilization', value: util },
  ]
  return (
    <div className="flex gap-2">
      {items.map((i) => (
        <div key={i.label} className="glass-card rounded-lg px-3 py-1.5 text-center">
          <p className="font-mono text-sm font-semibold text-stone-900">{i.value}</p>
          <p className="text-[10px] uppercase tracking-wide text-stone-400">{i.label}</p>
        </div>
      ))}
    </div>
  )
}

/** The racked (published-layout) split view: grid + tree + detail. */
function RackedWarehouseView({ warehouseId, layoutId }: { warehouseId: number; layoutId: number }) {
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

  // Overlay fill per bin (Phase 4). Slotting draws arrows instead of fills.
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

  if (isLoading || !detail) {
    return <p className="p-4 text-xs text-stone-400">Loading layout…</p>
  }

  return (
    <div className="space-y-4">
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="min-w-0 space-y-2">
        <OverlayControls overlay={overlay} onChange={setOverlay} />
        <WarehouseCanvas
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
        />
        {overlay === 'slotting' && model.slotting.length > 0 && (
          <div className="glass-card rounded-lg p-2 text-xs">
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
      </div>
      <div className="space-y-3">
        <BinDetailPanel
          location={selectedLocation}
          contents={selectedLocationId != null ? model.binContents.get(selectedLocationId) ?? [] : []}
          fillPct={selectedLocationId != null ? model.binFillPct.get(selectedLocationId) : undefined}
          placement={selectedPlacement}
          nodeVisits={nodeVisits}
          zoneName={zoneName}
        />
        <div className="glass-card rounded-xl">
          <p className="border-b border-stone-100 px-3 py-2 text-xs font-semibold text-stone-700">Locations</p>
          <WarehouseTreePanel
            tree={model.tree}
            binContents={model.binContents}
            binFillPct={model.binFillPct}
            selectedLocationId={selectedLocationId}
            onSelect={selectLocation}
          />
        </div>
      </div>
    </div>
    <WarehouseTestBench
      warehouseId={warehouseId}
      layoutId={layoutId}
      onPutawayResult={setPutawayResult}
      routeOrderIds={routeOrderIds}
      onRouteOrderIdsChange={setRouteOrderIds}
    />
    </div>
  )
}

const WarehousePage: React.FC<WarehousePageProps> = ({ currentUser, onOpenDesigner }) => {
  const { data: warehouses } = useWarehouses()
  const activeWarehouses = useMemo(() => (warehouses ?? []).filter((w) => w.isActive), [warehouses])

  // selectedWarehouseId = the user's explicit pick (null until they choose or a
  // ?wh= deep link seeds it). The effective id falls back to the smart default,
  // which prefers a racked+published site so we land on the grid, not the list.
  const [selectedWarehouseId, setSelectedWarehouseId] = useState<number | null>(() => readInitialWarehouse())
  const effectiveWarehouseId =
    selectedWarehouseId ?? resolveDefaultWarehouse(warehouses ?? [], readInitialWarehouse(), currentUser.homeWarehouseId)

  const pickWarehouse = (id: number | null) => {
    setSelectedWarehouseId(id)
    writeWarehouseToUrl(id)
  }

  const selectedWarehouse = useMemo(
    () => activeWarehouses.find((w) => w.id === effectiveWarehouseId) ?? null,
    [activeWarehouses, effectiveWarehouseId],
  )

  const { data: layouts } = useLayouts(effectiveWarehouseId)
  const publishedLayout = useMemo(() => layouts?.find((l) => l.status === 'published') ?? null, [layouts])
  const isRacked = selectedWarehouse?.locationType === 'racked' && publishedLayout != null

  return (
    <div className="bg-white min-h-screen">
      <div className="px-4 sm:px-6 lg:px-8 pt-4 sm:pt-6 lg:pt-8 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h1 className="flex items-center gap-2 text-base font-semibold text-stone-900">
            <LayoutGrid className="h-5 w-5 text-nexgen-blue" /> Warehouse
          </h1>
          {effectiveWarehouseId != null && isRacked && <KpiStrip warehouseId={effectiveWarehouseId} />}
        </div>
        <label className="inline-flex items-center gap-2 text-sm text-stone-600">
          <span className="font-medium">Warehouse</span>
          <select
            value={effectiveWarehouseId ?? ''}
            onChange={(e) => pickWarehouse(e.target.value ? Number(e.target.value) : null)}
            className="text-sm rounded-lg border border-stone-200 bg-white px-2.5 py-1.5 text-stone-800 focus:outline-none focus:ring-2 focus:ring-nexgen-blue/30"
          >
            <option value="">Select a warehouse…</option>
            {activeWarehouses.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name} ({w.code})
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="px-4 sm:px-6 lg:px-8 py-6">
        {selectedWarehouse == null || effectiveWarehouseId == null ? (
          <div className="glass-card rounded-xl p-10 text-center">
            <LayoutGrid className="w-9 h-9 text-stone-300 mx-auto mb-3" />
            <p className="text-sm text-stone-600">Pick a warehouse to view its layout</p>
            <p className="text-xs text-stone-400 mt-1">Choose a site from the selector above.</p>
          </div>
        ) : isRacked ? (
          // Keyed wrapper: remount the whole racked view on warehouse/layout change
          // so floor/selection/overlay/dry-run state can't leak across sites.
          <div key={`${effectiveWarehouseId}:${publishedLayout!.id}`}>
            <RackedWarehouseView warehouseId={effectiveWarehouseId} layoutId={publishedLayout!.id} />
          </div>
        ) : (
          <WarehouseEmptyState
            warehouseId={effectiveWarehouseId}
            warehouseName={selectedWarehouse.name}
            reason={selectedWarehouse.locationType === 'racked' ? 'unpublished' : 'bulk'}
            onOpenDesigner={onOpenDesigner}
          />
        )}
      </div>
    </div>
  )
}

export default WarehousePage
