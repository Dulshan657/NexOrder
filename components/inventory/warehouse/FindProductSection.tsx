// "Find a product" in Ask the engine (NX-0039): scan a product, see where it
// lives — highlighted on the map — and draw one walk: the putaway walk to where
// a new delivery would go, or the pick walk to the stock. One walk at a time,
// so the map's existing route drawing (NX-0037) is reused unchanged.

import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import type { PickRouteStop } from '@/types'
import { useProductWhereabouts } from '@/hooks/queries/useProductWhereabouts'
import { ProductScanBox } from '@/components/inventory/whereabouts/ProductScanBox'
import { WhereaboutsSummary } from '@/components/inventory/whereabouts/WhereaboutsSummary'
import { WalkSteps } from '@/components/inventory/whereabouts/WalkSteps'

type WalkKind = 'putaway' | 'pick'

/** The places to highlight on the map for a found product. */
export interface ProductHighlight {
  productId: number
  locationIds: number[]
}

export interface FindProductSectionProps {
  warehouseId: number
  /** The walk to draw on the map; null clears it. */
  onWalk: (stops: PickRouteStop[] | null) => void
  /** The places holding the found product; null clears the highlight. */
  onHighlight: (h: ProductHighlight | null) => void
}

const WALKS: { kind: WalkKind; label: string }[] = [
  { kind: 'putaway', label: 'Put away walk' },
  { kind: 'pick', label: 'Pick walk' },
]

export function FindProductSection({ warehouseId, onWalk, onHighlight }: FindProductSectionProps) {
  const [productId, setProductId] = useState<number | null>(null)
  const [kind, setKind] = useState<WalkKind | null>(null)
  const { data: answer, isLoading, isError } = useProductWhereabouts(warehouseId, productId)

  // A new product (or warehouse) clears the drawn walk until one is chosen.
  useEffect(() => {
    setKind(null)
    onWalk(null)
  }, [productId, warehouseId])

  // Highlight every place holding the product once the answer is in.
  const shown = productId != null && answer?.product.id === productId ? answer : undefined
  const highlightKey = shown ? shown.stock.map((s) => s.locationId).join(',') : ''
  useEffect(() => {
    onHighlight(shown ? { productId: shown.product.id, locationIds: shown.stock.map((s) => s.locationId) } : null)
  }, [shown?.product.id, highlightKey])

  // Collapsing or leaving the tab unmounts it: take the walk and highlight with it.
  useEffect(() => () => { onWalk(null); onHighlight(null) }, [])

  const walkOf = (k: WalkKind) => (k === 'putaway' ? shown?.putawayWalk : shown?.pickWalk) ?? null

  const choose = (k: WalkKind) => {
    const next = kind === k ? null : k
    setKind(next)
    onWalk(next ? walkOf(next)?.stops ?? [] : null)
  }

  return (
    <div className="space-y-3 text-xs">
      <ProductScanBox onProduct={setProductId} />
      {productId != null && isLoading && <p className="text-stone-600">Asking the engine…</p>}
      {isError && <p className="rounded-lg bg-red-50 px-3 py-2 text-red-700">Could not look that product up. Try again.</p>}

      {shown && (
        <>
          <WhereaboutsSummary answer={shown} />

          {shown.mode === 'engine' ? (
            <div className="flex items-center gap-2">
              <div role="group" aria-label="Walk to show on the map" className="inline-flex rounded-lg bg-stone-100 p-0.5">
                {WALKS.map((w) => (
                  <button
                    key={w.kind}
                    type="button"
                    aria-pressed={kind === w.kind}
                    onClick={() => choose(w.kind)}
                    className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors btn-press ${
                      kind === w.kind ? 'bg-white text-nexgen-blue shadow-sm' : 'text-stone-700 hover:text-stone-900'
                    }`}
                  >
                    {w.label}
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={() => setProductId(null)}
                className="ml-auto inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-stone-700 hover:bg-stone-100 btn-press"
              >
                <X className="h-3.5 w-3.5" aria-hidden="true" /> Clear
              </button>
            </div>
          ) : (
            <p className="text-stone-600">No published layout, so no walk to draw.</p>
          )}

          {kind === 'putaway' && (
            <WalkSteps title="Put away walk" walk={walkOf('putaway')} empty="Nowhere can take a new delivery." />
          )}
          {kind === 'pick' && <WalkSteps title="Pick walk" walk={walkOf('pick')} empty="No stock free to pick." />}
        </>
      )}
    </div>
  )
}
