// Find stock in the 3D map (NX-0036). Pure: no three, no React.
//
// Reads `binContents` — the warehouse-scoped balances the live map already loads
// and the realtime subscription already refreshes — so finding is free: no new
// query, no server round trip, and the answer can never disagree with what Bin
// detail shows for the same location.
//
// "Holding" means ON HAND, allocated included: reserved stock is physically on
// the shelf, and "where is it" is a question about the shelf.

import type { Product } from '@/types'
import type { BinContentRow } from '@/components/inventory/warehouse/useWarehouseViewerModel'

type Contents = ReadonlyMap<number, readonly BinContentRow[]>

/** Every location id holding on-hand stock of `productId`. */
export function locationsHoldingProduct(binContents: Contents, productId: number): Set<number> {
  const out = new Set<number>()
  for (const [locationId, rows] of binContents) {
    if (rows.some((r) => r.productId === productId && r.onHand > 0)) out.add(locationId)
  }
  return out
}

/** Products in stock somewhere on this site, by name — a search for anything
 *  else would light up nothing. */
export function productOptionsInWarehouse(binContents: Contents, products: readonly Product[]): Product[] {
  const inStock = new Set<number>()
  for (const rows of binContents.values()) {
    for (const r of rows) if (r.onHand > 0) inStock.add(r.productId)
  }
  return products
    .filter((p) => inStock.has(p.id))
    .sort((a, b) => a.name.localeCompare(b.name, 'en-AU'))
}

export interface StockSummary {
  /** Rack levels / bins drawn in 3D that hold the product. */
  placedLocations: number
  placedUnits: number
  /** On site but in no drawn location: the warehouse root (received, not put
   *  away) or staging. Reported separately because it cannot light up. */
  unplacedUnits: number
}

export function stockSummary(binContents: Contents, productId: number, placedIds: ReadonlySet<number>): StockSummary {
  let placedLocations = 0
  let placedUnits = 0
  let unplacedUnits = 0
  for (const [locationId, rows] of binContents) {
    const units = rows.reduce((sum, r) => (r.productId === productId && r.onHand > 0 ? sum + r.onHand : sum), 0)
    if (units <= 0) continue
    if (placedIds.has(locationId)) {
      placedLocations += 1
      placedUnits += units
    } else {
      unplacedUnits += units
    }
  }
  return { placedLocations, placedUnits, unplacedUnits }
}
