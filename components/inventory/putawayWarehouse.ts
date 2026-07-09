// Pure resolver for which warehouse the Putaway queue opens on. Extracted so it
// can be unit tested without mounting PutawayQueuePage. Mirrors
// resolveDefaultWarehouse (components/inventory/warehouse/WarehousePage.tsx),
// but prefers a warehouse with actual pending work over a merely-published one.

export interface ResolvePutawayWarehouseArgs {
  /** Warehouse id from the `?wh=` deep link (post-receipt navigation, or a
   *  shared/refreshed link), or null if absent. */
  deepLinkId: number | null
  /** The signed-in user's home warehouse, if any (profiles.home_warehouse_id). */
  homeWarehouseId: number | undefined
  /** Pending ('suggested') putaway recommendation count per warehouse id. */
  counts: Record<number, number>
  /** Active warehouses only — an inactive site is never a valid default. */
  activeWarehouses: readonly { id: number }[]
}

/**
 * Precedence: (1) `?wh=` deep link, (2) home warehouse, (3) first active
 * warehouse with a pending putaway count > 0, (4) first active warehouse,
 * (5) null when there are no active warehouses. A deep link or home warehouse
 * that isn't in `activeWarehouses` is ignored, not honoured.
 */
export function resolvePutawayWarehouse({
  deepLinkId,
  homeWarehouseId,
  counts,
  activeWarehouses,
}: ResolvePutawayWarehouseArgs): number | null {
  const isActive = (id: number | null | undefined): boolean =>
    id != null && activeWarehouses.some((w) => w.id === id)

  if (isActive(deepLinkId)) return deepLinkId as number
  if (isActive(homeWarehouseId)) return homeWarehouseId as number

  const firstWithPending = activeWarehouses.find((w) => (counts[w.id] ?? 0) > 0)
  if (firstWithPending) return firstWithPending.id

  return activeWarehouses[0]?.id ?? null
}
