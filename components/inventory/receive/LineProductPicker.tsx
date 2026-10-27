// The product cell of a line that has no product yet — a line added by hand.
//
// Such a line used to render "—" with nothing to choose a product with, so it
// could only be deleted. This is a small search over the same pool and the
// same matching as the scan bar (`matchesProductQuery`, the supplier's own part
// number included), so a product found one way is found the other.
//
// Options are `role="option"` buttons inside a listbox, NOT plain buttons:
// tests and the mobile suite find the SCAN BAR's results as buttons by product
// name, and two sets of identically-named buttons would make both ambiguous.

import React, { useMemo, useState } from 'react'
import type { Product } from '../../../types'
import { matchesProductQuery, supplierSkuFor } from '../../../lib/productSuppliers'

const MAX_RESULTS = 8

interface LineProductPickerProps {
  /** Products this delivery can contain — the scan bar's current pool. */
  pool: readonly Product[]
  supplierId: number | null
  onChoose: (product: Product) => void
}

export function LineProductPicker({ pool, supplierId, onChoose }: LineProductPickerProps) {
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)

  const results = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return []
    return pool.filter((p) => matchesProductQuery(p, q, supplierId)).slice(0, MAX_RESULTS)
  }, [pool, query, supplierId])

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' && results.length > 0) {
      e.preventDefault()
      setActive((i) => Math.min(i + 1, results.length - 1))
    } else if (e.key === 'ArrowUp' && results.length > 0) {
      e.preventDefault()
      setActive((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter' && results[active]) {
      e.preventDefault()
      onChoose(results[active])
    }
  }

  return (
    <div className="relative">
      <input
        type="text"
        value={query}
        onChange={(e) => { setQuery(e.target.value); setActive(0) }}
        onKeyDown={onKeyDown}
        placeholder="Type a product name or SKU…"
        aria-label="Product for new line"
        // eslint-disable-next-line jsx-a11y/no-autofocus -- the operator just asked for this line
        autoFocus
        className="w-full min-h-[44px] rounded-md border border-stone-300 bg-white px-2 py-1.5 text-sm focus:border-nexgen-blue focus:outline-none focus:ring-2 focus:ring-nexgen-blue-dark"
      />
      {results.length > 0 && (
        <div
          role="listbox"
          aria-label="Matching products"
          className="absolute z-30 mt-1 w-full overflow-hidden rounded-lg border border-stone-200 bg-white shadow-card"
        >
          {results.map((p, i) => {
            const theirSku = supplierSkuFor(p, supplierId)
            return (
              <button
                key={p.id}
                type="button"
                role="option"
                aria-selected={i === active}
                onClick={() => onChoose(p)}
                className={`flex min-h-[44px] w-full items-center justify-between gap-3 px-3 py-2 text-left btn-press ${
                  i === active ? 'bg-nexgen-blue/10' : 'hover:bg-stone-50'
                }`}
              >
                <span className="truncate text-sm text-stone-800">{p.name}</span>
                <span className="shrink-0 font-mono text-xs text-stone-600">
                  {theirSku ? `${theirSku} · ` : ''}{p.sku}
                </span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

export default LineProductPicker
