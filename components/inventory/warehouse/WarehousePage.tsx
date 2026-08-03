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

import React, { useEffect, useMemo, useRef } from 'react'
import { LayoutGrid } from 'lucide-react'
import type { User, Warehouse } from '@/types'
import type { NavTarget as SetupNavTarget } from '@/lib/warehouseSetup/steps'
import { WarehouseSetupPanel } from './setup/WarehouseSetupPanel'
import { useWarehouses } from '@/hooks/queries/useWarehouses'
import { useLayouts } from '@/hooks/queries/useLayouts'
import { useWarehouseScope } from '@/context/WarehouseScopeContext'
import { WarehousePicker } from '@/components/inventory/WarehousePicker'
import { RackedWorkspace } from './RackedWorkspace'
import { WarehouseEmptyState } from './WarehouseEmptyState'
import { KpiStrip } from './KpiStrip'
import LayoutLabelBadge from '@/components/admin/labels/LayoutLabelBadge'

interface WarehousePageProps {
  currentUser: User
  /** Navigate into the Layout Designer (Settings) for a warehouse — used by the
   *  empty-state CTA when a site has no visual grid yet. */
  onOpenDesigner?: (warehouseId: number, opts?: { import?: boolean }) => void
  /** Navigate to a setup-checklist step's target. Threaded from AdminView,
   *  which owns the one URL writer. */
  onNavigateSetup?: (target: SetupNavTarget, warehouseId: number) => void
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

const WarehousePage: React.FC<WarehousePageProps> = ({ currentUser, onOpenDesigner, onNavigateSetup }) => {
  const { data: warehouses } = useWarehouses()
  const activeWarehouses = useMemo(() => (warehouses ?? []).filter((w) => w.isActive), [warehouses])

  // The Warehouse/Putaway tabs share one app-wide warehouse scope (see
  // WarehouseScopeContext) so Stock/Products/Dashboard filters stay in sync
  // with whatever site this tab is showing. But merely opening this tab must
  // NOT clobber a shared 'all' scope for those other tabs — so when scope is
  // 'all' we only *display* a smart local default (preferring a racked+
  // published site so we land on the grid, not the list); we never call
  // setScope for it. Explicitly picking a site via the selector below DOES
  // write back to the shared scope — that's intended.
  const { scope, setScope } = useWarehouseScope()
  const effectiveWarehouseId =
    scope !== 'all' ? scope : resolveDefaultWarehouse(warehouses ?? [], null, currentUser.homeWarehouseId)

  // A setup-checklist step targeting this tab sets `?wh=<id>` then switches
  // tabs. The scope provider only reads `?wh=` at its OWN init, so a fresh page
  // load honours the link but an in-session tab switch would silently show a
  // different site. Adopt a valid deep link into the shared scope exactly once,
  // and only while scope is still 'all' — an explicitly chosen site must never
  // be overridden by a stale link. Same effect as PutawayQueuePage:90-106.
  const deepLinkAdopted = useRef(false)
  useEffect(() => {
    if (deepLinkAdopted.current) return
    if (scope !== 'all') {
      deepLinkAdopted.current = true
      return
    }
    if (activeWarehouses.length === 0) return
    if (typeof window === 'undefined') return

    const raw = new URLSearchParams(window.location.search).get('wh')
    const deepLinkId = raw && /^\d+$/.test(raw) ? Number(raw) : null
    if (deepLinkId != null && activeWarehouses.some((w) => w.id === deepLinkId)) {
      deepLinkAdopted.current = true
      setScope(deepLinkId)
    }
  }, [scope, activeWarehouses, setScope])

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
        <div className="flex flex-wrap items-center gap-3">
          {isRacked && publishedLayout && (
            <LayoutLabelBadge
              layoutId={publishedLayout.id}
              layoutName={selectedWarehouse?.name}
              dense
            />
          )}
          <label className="inline-flex items-center gap-2 text-sm text-stone-600">
            <span className="font-medium">Warehouse</span>
            <WarehousePicker showAllOption={false} effectiveId={effectiveWarehouseId ?? undefined} />
          </label>
        </div>
      </div>

      {/* Above the map, and above the empty state — the checklist is the first
          thing an incompletely-set-up site should say. It renders nothing once
          every derivable step passes except a single collapsed summary line. */}
      {selectedWarehouse != null && effectiveWarehouseId != null && (
        // Keyed by warehouse so the panel REMOUNTS when the site changes. Its
        // collapsed/expanded state is remembered per warehouse in localStorage,
        // and useLocalStorage seeds its value in a useState initialiser that
        // runs once while its key recomputes every render — without the
        // remount, switching sites would write the previous site's state under
        // the new site's key. Fragment carries the key because there is no
        // @types/react, so `key` on a typed component is a tsc error.
        <React.Fragment key={effectiveWarehouseId}>
          <div className="px-4 sm:px-6 lg:px-8 pt-4">
            <WarehouseSetupPanel
              warehouseId={effectiveWarehouseId}
              warehouseName={selectedWarehouse.name}
              currentUser={currentUser}
              onNavigate={onNavigateSetup}
            />
          </div>
        </React.Fragment>
      )}

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
