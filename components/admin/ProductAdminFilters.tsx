// Search and category for the Products tab.
//
// The tab had NEITHER until now — every product in the catalogue rendered, in
// one ten-column table, with the warehouse scope as the only way to narrow it.
// That is survivable at 200 SKUs on a desk and unusable at 360px.
//
// A controlled presenter on purpose: the state lives in `ProductAdmin`, and it
// has to. `selectedProducts` intersects the selection with what is VISIBLE
// (ProductAdmin.tsx's own comment: "a selection made before the operator
// narrowed the list must not quietly re-brand rows they can no longer see"), so
// a filter this component owned privately would be a filter that intersection
// cannot see — reintroducing exactly the bug that memo was written to prevent.

import React from 'react'
import { Search, X } from 'lucide-react'
import type { Category } from '../../types'

export interface ProductAdminFiltersProps {
  query: string
  onQueryChange: (v: string) => void
  category: Category | 'All'
  onCategoryChange: (v: Category | 'All') => void
  categories: readonly Category[]
  /** Count after filtering, and the total, for the result line. */
  shown: number
  total: number
}

export function ProductAdminFilters({
  query,
  onQueryChange,
  category,
  onCategoryChange,
  categories,
  shown,
  total,
}: ProductAdminFiltersProps) {
  return (
    <div className="space-y-2">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-600" aria-hidden="true" />
          {/* `aria-label`, not an sr-only <label htmlFor>: the jsx-a11y rule
              does not follow htmlFor to an id, and carrying both would leave a
              label element nothing ever announces. */}
          <input
            aria-label="Search products by name, SKU or barcode"
            type="text"
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder="Search by name, SKU, or barcode…"
            className="touch-target-y w-full rounded-lg border border-stone-200 bg-stone-50 py-2.5 pl-10 pr-9 text-sm text-stone-900 placeholder:text-stone-500 focus:border-nexgen-blue focus:outline-none focus:ring-2 focus:ring-nexgen-blue-dark"
          />
          {query && (
            <button
              type="button"
              onClick={() => onQueryChange('')}
              aria-label="Clear the search"
              className="touch-target absolute right-1 top-1/2 inline-flex -translate-y-1/2 items-center justify-center rounded-md text-stone-600 hover:text-stone-900"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          )}
        </div>

        {/* A <select>, not a chip row. A native select sizes itself to its
            WIDEST OPTION, so `min-w-0 max-w-full truncate` is load-bearing at
            360px — the same defect StocktakePage records for its warehouse
            picker. A horizontally scrolling chip strip would also put a second
            scroll axis next to the selection bar. */}
        <label className="inline-flex min-w-0 max-w-full items-center gap-2 text-sm text-stone-600">
          <span className="shrink-0 font-medium">Category</span>
          <select
            value={category}
            onChange={(e) => onCategoryChange(e.target.value as Category | 'All')}
            className="touch-target-y min-w-0 max-w-full truncate rounded-lg border border-stone-200 bg-stone-50 px-2.5 py-2 text-sm text-stone-800 focus:outline-none focus:ring-2 focus:ring-nexgen-blue-dark"
          >
            <option value="All">All categories</option>
            {categories.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
      </div>

      <p className="text-xs text-stone-600">
        {shown === total
          ? `${total} ${total === 1 ? 'product' : 'products'}`
          // A filtered-empty state has to name what is still there, or the
          // operator cannot tell a narrow filter from an empty catalogue.
          : `${shown} of ${total} products match`}
      </p>
    </div>
  )
}

export default ProductAdminFilters
