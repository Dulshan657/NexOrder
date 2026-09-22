// Which locations belong to a warehouse, for DISPLAY.
//
// ── READ THIS BEFORE REUSING IT ────────────────────────────────────────────
//
// A WAREHOUSE id is not a place stock sits. Once goods are put away a balance
// row's `location_id` is the BIN's; the root holds only what has not been
// placed. So anything that scopes stock "to a warehouse" has to expand the id
// into the root PLUS every descendant.
//
// The authoritative expansion is the `inv_warehouse_draw_locations` SQL
// function (mig 00040) — racked ⇒ root + descendants, bulk ⇒ root — and
// CLAUDE.md is explicit that it must not be rebuilt as a `materialized_path`
// prefix in TypeScript, because the two then drift. That rule is right, and
// this module does not obey it: it IS the prefix rebuild.
//
// It exists anyway because the rebuild was already here TWICE — inline in
// `components/stock/OpsStockRow.tsx` and as a SQL `LIKE` in
// `inventoryService.getBalancesByWarehouse` — and a third copy was about to be
// written for the Stock lookup. One named, tested, documented copy is strictly
// better than three anonymous ones, and makes the eventual replacement a single
// edit instead of a hunt.
//
// The exposure is bounded and worth stating plainly: every caller is READ-ONLY
// DISPLAY. If this disagrees with the RPC the cost is a bin listed on a lookup
// screen that should not have been, or missing from one that should. Nothing
// reserves, picks or transfers on the strength of it — those call the RPC.
// Do not widen it to a write path.

/** The minimum a location needs to be placed in a subtree. Structural rather
 *  than importing `InventoryLocation` so the pure scan/test paths can pass
 *  literals without building a whole location. */
export interface SubtreeLocation {
  id: number
  materializedPath: string | null
}

/**
 * The warehouse root's id plus every descendant's, or `null` when the answer is
 * "do not filter" — the scope is site-wide, the locations have not loaded, or
 * the named root is not among them.
 *
 * `null` and an empty Set mean opposite things and callers must not conflate
 * them: `null` is "show everything", an empty Set is "show nothing".
 */
export function subtreeLocationIds(
  locations: readonly SubtreeLocation[] | null | undefined,
  warehouseId: number | null | undefined,
): Set<number> | null {
  if (warehouseId == null || !locations) return null

  const root = locations.find((l) => l.id === warehouseId)
  if (!root) return null

  const ids = new Set<number>([root.id])

  // A root with no path can only vouch for itself. Without this guard the
  // prefix would be a bare '/', and while no real path starts with one today,
  // "happens not to match" is not the same as "cannot match".
  if (!root.materializedPath) return ids

  const prefix = `${root.materializedPath}/`
  for (const loc of locations) {
    if (loc.materializedPath?.startsWith(prefix)) ids.add(loc.id)
  }
  return ids
}
