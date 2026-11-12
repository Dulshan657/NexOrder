// Find stock in the 3D map (NX-0036): pick a product, see where it is.
//
// Wraps the existing ProductSearchDropdown (SKU or name search) and offers only
// products in stock on this site. The counts line separates what can light up —
// placed locations — from stock on site but in no rack (received at the dock and
// not yet put away), which a highlight cannot show and an operator still needs to
// know about.

import { useMemo } from 'react'
import type { Product } from '@/types'
import type { BinContentRow } from '@/components/inventory/warehouse/useWarehouseViewerModel'
import ProductSearchDropdown from '@/components/admin/ProductSearchDropdown'
import { productOptionsInWarehouse, stockSummary } from '@/lib/warehouse3d/findStock'

export interface FindStockBarProps {
  products: readonly Product[]
  binContents: ReadonlyMap<number, readonly BinContentRow[]>
  /** Location ids with a placement on ANY floor of the layout. Stock elsewhere
   *  (root, staging) is "not in a rack". */
  placedIds: ReadonlySet<number>
  /** Location ids drawn right now — the active floor. Defaults to `placedIds`. */
  visibleIds?: ReadonlySet<number>
  productId: number | null
  onChange: (productId: number | null) => void
}

const plural = (n: number, one: string, many: string) => `${n.toLocaleString('en-AU')} ${n === 1 ? one : many}`

export function FindStockBar({ products, binContents, placedIds, visibleIds, productId, onChange }: FindStockBarProps) {
  const options = useMemo(() => productOptionsInWarehouse(binContents, products), [binContents, products])
  // Headline = what is lit up right now (this floor); "not in a rack" is judged
  // against every floor, so stock on another floor is never called unplaced.
  const shown = visibleIds ?? placedIds
  const summary = useMemo(
    () => (productId != null ? stockSummary(binContents, productId, shown) : null),
    [binContents, productId, shown],
  )
  const unplacedUnits = useMemo(
    () => (productId != null ? stockSummary(binContents, productId, placedIds).unplacedUnits : 0),
    [binContents, productId, placedIds],
  )
  /** Placed matches on another floor: lit up only when that floor is shown. */
  const otherFloors = useMemo(() => {
    if (productId == null || !visibleIds) return 0
    let n = 0
    for (const [id, rows] of binContents) {
      if (!placedIds.has(id) || visibleIds.has(id)) continue
      if (rows.some((r) => r.productId === productId && r.onHand > 0)) n++
    }
    return n
  }, [binContents, productId, placedIds, visibleIds])

  return (
    <div className="w-72 max-w-full rounded-lg border border-stone-200 bg-white/95 p-2 shadow-elevated backdrop-blur-sm">
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <ProductSearchDropdown
            products={options}
            selectedProductId={productId}
            onSelect={(id: number) => onChange(id)}
            placeholder="Find stock…"
          />
        </div>
        {productId != null && (
          <button
            type="button"
            onClick={() => onChange(null)}
            className="shrink-0 rounded-md px-2 py-1 text-xs font-semibold text-stone-600 transition-colors hover:bg-stone-100 hover:text-stone-900 btn-press"
          >
            Clear
          </button>
        )}
      </div>
      {/* Always mounted: a live region that appears WITH its text is usually
          not announced. */}
      <p className="mt-1.5 px-0.5 text-xs text-stone-600" aria-live="polite">
        {summary && (
          <>
            <span className="font-semibold text-stone-800">{plural(summary.placedLocations, 'location', 'locations')}</span>
            {summary.placedLocations > 0 && <> · {plural(summary.placedUnits, 'unit', 'units')}</>}
            {otherFloors > 0 && <> ({otherFloors} more on another floor)</>}
            {unplacedUnits > 0 && (
              <span className="block text-amber-800">
                + {plural(unplacedUnits, 'unit', 'units')} not in a rack (dock / unplaced)
              </span>
            )}
            {summary.placedLocations === 0 && otherFloors === 0 && unplacedUnits === 0 && <> — none on this site</>}
          </>
        )}
      </p>
    </div>
  )
}
