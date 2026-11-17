// "Find a product" in Ask the engine (NX-0039): scan a product, see where it
// lives, and draw one walk on the map — the putaway walk to where a new
// delivery would go, or the pick walk to the stock. One at a time, so the map's
// existing route drawing (NX-0037) is reused unchanged.

import { useEffect, useState } from 'react'
import type { PickRouteStop } from '@/types'
import { useProductWhereabouts } from '@/hooks/queries/useProductWhereabouts'
import { ProductScanBox } from '@/components/inventory/whereabouts/ProductScanBox'
import { WhereaboutsSummary } from '@/components/inventory/whereabouts/WhereaboutsSummary'
import { WalkSteps } from '@/components/inventory/whereabouts/WalkSteps'

type WalkKind = 'putaway' | 'pick'

export interface FindProductSectionProps {
  warehouseId: number
  /** The walk to draw on the map; null clears it. */
  onWalk: (stops: PickRouteStop[] | null) => void
}

export function FindProductSection({ warehouseId, onWalk }: FindProductSectionProps) {
  const [productId, setProductId] = useState<number | null>(null)
  const [kind, setKind] = useState<WalkKind | null>(null)
  const { data: answer, isLoading, isError } = useProductWhereabouts(warehouseId, productId)

  // A new product (or warehouse) clears the drawn walk until one is chosen.
  useEffect(() => {
    setKind(null)
    onWalk(null)
  }, [productId, warehouseId])

  const walkOf = (k: WalkKind) => (k === 'putaway' ? answer?.putawayWalk : answer?.pickWalk) ?? null

  const choose = (k: WalkKind) => {
    const next = kind === k ? null : k
    setKind(next)
    onWalk(next ? walkOf(next)?.stops ?? [] : null)
  }

  const walkButton = (k: WalkKind, label: string) => (
    <button
      type="button"
      aria-pressed={kind === k}
      disabled={!answer || answer.mode !== 'engine'}
      onClick={() => choose(k)}
      className={`rounded-lg px-3 py-1.5 text-xs font-semibold btn-press disabled:opacity-40 ${
        kind === k ? 'bg-nexgen-blue text-white' : 'border border-stone-200 text-stone-700 hover:bg-stone-100'
      }`}
    >
      {label}
    </button>
  )

  return (
    <div className="space-y-2 text-xs">
      <ProductScanBox onProduct={setProductId} />
      {productId != null && isLoading && <p className="text-stone-600">Asking the engine…</p>}
      {isError && <p className="rounded bg-red-50 px-2 py-1.5 text-red-700">Could not look that product up. Try again.</p>}
      {answer && (
        <>
          <WhereaboutsSummary answer={answer} />
          {answer.mode === 'engine' ? (
            <div className="flex flex-wrap gap-2">
              {walkButton('putaway', 'Put away walk')}
              {walkButton('pick', 'Pick walk')}
            </div>
          ) : (
            <p className="text-stone-600">No published layout, so no walk to draw.</p>
          )}
          {kind === 'putaway' && (
            <WalkSteps title="Put away walk" walk={walkOf('putaway')} empty="No bin can take a new delivery." />
          )}
          {kind === 'pick' && <WalkSteps title="Pick walk" walk={walkOf('pick')} empty="No stock free to pick." />}
        </>
      )}
    </div>
  )
}
