// Stocktake — count a location, post the variances.
//
// The gap this closes: AdjustStockModal corrects one (product, location, batch)
// slot at a time, and the opening-stock CSV importer is additive — it can raise
// a count but never lower one. So reconciling drift after go-live meant walking
// a bin with a clipboard and then typing one adjustment per line, and a
// re-count that found LESS than the system believed had nowhere to go at all.
//
// Shell cloned from ReplenQueuePage: same warehouse scope handling, same
// home-warehouse guard for the Warehouse role, same empty state. The work
// itself is two steps — choose a place, count it — so there is no queue and no
// assign/walk split.

import React, { useMemo, useState } from 'react'
import { ClipboardList } from 'lucide-react'
import { useWarehouses } from '../../hooks/queries/useWarehouses'
import { useWarehouseLocations } from '../../hooks/queries/useWarehouseLocations'
import { useWarehouseScope } from '../../context/WarehouseScopeContext'
import { UserRole, type InventoryLocation, type Product, type User } from '../../types'
import { CountLocationFinder } from './stocktake/CountLocationFinder'
import StickyScanBar from './StickyScanBar'
import { CountSheet } from './stocktake/CountSheet'

interface StocktakePageProps {
  currentUser: User
  products: Product[]
}

const StocktakePage: React.FC<StocktakePageProps> = ({ currentUser, products }) => {
  const { data: warehouses } = useWarehouses()
  const activeWarehouses = useMemo(
    () => (warehouses ?? []).filter((w) => w.isActive),
    [warehouses],
  )

  // Shares the app-wide warehouse scope, same rule as the putaway and
  // replenishment pages: merely opening this tab must not clobber a shared
  // 'all' scope, so under 'all' we display a local default without writing it
  // back. Choosing a site from the selector DOES write back.
  const { scope, setScope } = useWarehouseScope()
  const localFallback = useMemo(() => {
    if (currentUser.homeWarehouseId != null
        && activeWarehouses.some((w) => w.id === currentUser.homeWarehouseId)) {
      return currentUser.homeWarehouseId
    }
    return activeWarehouses[0]?.id ?? null
  }, [activeWarehouses, currentUser.homeWarehouseId])

  const effectiveWarehouseId = scope !== 'all' ? scope : localFallback

  const [selected, setSelected] = useState<InventoryLocation | null>(null)

  const { data: subtree } = useWarehouseLocations(effectiveWarehouseId)

  // `getWarehouseLocations` matches `materialized_path LIKE '<wh>/%'`, which
  // EXCLUDES the root itself. The root is exactly where a bulk site's stock
  // lives, so it is prepended here or bulk areas would be uncountable.
  const locations = useMemo<InventoryLocation[]>(() => {
    const root = activeWarehouses.find((w) => w.id === effectiveWarehouseId)
    const rest = subtree ?? []
    if (!root) return rest
    return [
      {
        id: root.id,
        kind: 'WAREHOUSE',
        code: root.code,
        name: root.name,
        materializedPath: '',
        isActive: true,
      } as InventoryLocation,
      ...rest,
    ]
  }, [activeWarehouses, effectiveWarehouseId, subtree])

  // Warehouse staff may only move stock at their own site — the same rule
  // count-bin enforces server-side, mirrored here so the Post button is
  // disabled rather than failing on tap.
  const canWorkHere =
    currentUser.role !== UserRole.WAREHOUSE ||
    currentUser.homeWarehouseId === effectiveWarehouseId

  // Switching site must drop the open sheet — its lines belong to a location in
  // the site we just left.
  const changeWarehouse = (id: number) => {
    setSelected(null)
    setScope(id)
  }

  return (
    <div className="min-h-svh bg-white">
      <div className="flex flex-wrap items-center gap-3 px-4 sm:px-6 lg:px-8 pt-4 sm:pt-6 lg:pt-8">
        {/* A native <select> sizes itself to its WIDEST OPTION, not to its box.
            At 360px that made this 267px starting at x=146 — 53px off the side
            of the screen — and it got worse with every warehouse added, since
            the culprit is whichever site has the longest name. Invisible on a
            desktop, which is why it survived until the 360px Playwright
            project existed to measure it. `min-w-0` is load-bearing: without
            it the flex item refuses to shrink below its content and
            `max-w-full` does nothing at all. */}
        <label className="inline-flex min-w-0 max-w-full items-center gap-2 text-sm text-stone-600">
          <span className="shrink-0 font-medium">Warehouse</span>
          <select
            value={effectiveWarehouseId ?? ''}
            onChange={(e) => e.target.value && changeWarehouse(Number(e.target.value))}
            className="min-w-0 max-w-full truncate rounded-lg border border-stone-200 bg-white px-2.5 py-1.5 text-sm text-stone-800 focus:outline-none focus:ring-2 focus:ring-nexgen-blue/30"
          >
            <option value="">Select a warehouse…</option>
            {activeWarehouses.map((w) => (
              <option key={w.id} value={w.id}>{w.name} ({w.code})</option>
            ))}
          </select>
        </label>
      </div>

      {effectiveWarehouseId != null ? (
        <div className="p-4 sm:p-6 lg:p-8">
          {selected ? (
            <CountSheet
              location={selected}
              products={products}
              canWork={canWorkHere}
              onDone={() => setSelected(null)}
            />
          ) : (
            <>
              <p className="mb-4 text-xs text-stone-500">
                Scan a bin to count it. Bulk and floor-stacked stock is counted on the site root.
              </p>
              <StickyScanBar>
                <CountLocationFinder locations={locations} onPick={setSelected} />
              </StickyScanBar>
            </>
          )}
        </div>
      ) : (
        <div className="px-4 py-16 sm:px-6 lg:px-8">
          <div className="glass-card rounded-xl p-10 text-center">
            <ClipboardList className="mx-auto mb-3 h-9 w-9 text-stone-300" />
            <p className="text-sm text-stone-600">Pick a warehouse to start a count</p>
            <p className="mt-1 text-xs text-stone-500">Choose a site from the selector above.</p>
          </div>
        </div>
      )}
    </div>
  )
}

export default StocktakePage
