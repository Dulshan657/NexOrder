// Read-only Warehouse viewer — the operational surface for the Warehouse
// Intelligence Engine. Admin/Manager staff have no home warehouse, so this page
// owns its own warehouse picker (mirrors PutawayQueuePage); Warehouse staff
// default to their home site. Racked (layout-published) warehouses render the
// tall pan/zoom map (RackedWorkspace); bulk / unpublished warehouses fall back
// to a plain stock list. Nothing here ever mutates inventory.
//
// Normal document flow — no viewport-height juggling here. `main`
// (AppShell.tsx) already owns the page-level `overflow-y-auto`; RackedWorkspace
// sizes its own map block (`h-[65vh]`) rather than requiring this page to
// clamp itself to `100vh`.

import React, { useMemo, useState } from 'react'
import { LayoutGrid } from 'lucide-react'
import type { User, Warehouse } from '@/types'
import { useWarehouses } from '@/hooks/queries/useWarehouses'
import { useLayouts } from '@/hooks/queries/useLayouts'
import { RackedWorkspace } from './RackedWorkspace'
import { WarehouseEmptyState } from './WarehouseEmptyState'
import { KpiStrip } from './KpiStrip'

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
    <div className="bg-white">
      <div className="px-4 sm:px-6 lg:px-8 pt-4 sm:pt-6 lg:pt-8 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
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
          // Keyed wrapper: remount the whole workspace on warehouse/layout change
          // so floor/selection/overlay/dry-run state can't leak across sites.
          <div key={`${effectiveWarehouseId}:${publishedLayout!.id}`}>
            <RackedWorkspace warehouseId={effectiveWarehouseId} layoutId={publishedLayout!.id} />
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
