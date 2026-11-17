// Ask the engine → Put away: where would this product go? A dry run of the
// normal putaway rules (recommend-putaway, dry_run) — nothing is queued and no
// stock moves. Scan or type the product (NX-0039), as on every floor screen.

import { useEffect, useState } from 'react'
import type { PutawayResponse } from '@/services/supabase/putawayService'
import { useProducts } from '@/hooks/queries/useProducts'
import { useRecommendPutaway } from '@/hooks/queries/usePutawayRecommendation'
import { PutawayExplanationCard } from '@/components/inventory/PutawayExplanationCard'
import { ProductScanBox } from '@/components/inventory/whereabouts/ProductScanBox'

export interface PutawayTabProps {
  warehouseId: number
  onResult: (r: PutawayResponse | null) => void
}

export function PutawayTab({ warehouseId, onResult }: PutawayTabProps) {
  const { data: products } = useProducts()
  const [productId, setProductId] = useState<number | null>(null)
  const [qty, setQty] = useState(5)
  const recommend = useRecommendPutaway()
  const product = (products ?? []).find((p: { id: number }) => p.id === productId) as { name: string } | undefined

  // Leaving the tab takes its target off the map.
  useEffect(() => () => onResult(null), [])

  const pick = (id: number) => {
    setProductId(id)
    onResult(null)
  }

  const run = async () => {
    if (productId == null) return
    try {
      const result = await recommend.mutateAsync({
        warehouseId, lines: [{ product_id: productId, quantity: qty }], dryRun: true,
      })
      onResult(result)
    } catch {
      onResult(null) // shown via recommend.isError below
    }
  }

  const rec = recommend.data?.mode === 'engine' ? recommend.data.recommendations[0] : null

  return (
    <div className="space-y-3 text-xs">
      <ProductScanBox onProduct={pick} />
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-stone-600">Product</p>
          <p className="truncate text-sm text-stone-900">{product?.name ?? 'Scan or type one above'}</p>
        </div>
        <label className="flex flex-col text-[11px] font-semibold uppercase tracking-wide text-stone-600">
          Quantity
          <input
            type="number" min={1} value={qty}
            aria-label="Quantity"
            onChange={(e) => setQty(Math.max(1, Number(e.target.value) || 1))}
            className="mt-0.5 w-20 rounded-lg border border-stone-200 px-2 py-1.5 text-sm font-normal normal-case tracking-normal text-stone-900"
          />
        </label>
        <button
          type="button"
          onClick={run}
          disabled={productId == null || recommend.isPending}
          className="rounded-lg bg-nexgen-blue px-3 py-2 text-xs font-semibold text-white btn-press disabled:opacity-40"
        >
          {recommend.isPending ? 'Asking…' : 'Where would it go?'}
        </button>
      </div>
      {recommend.isError && <p className="rounded-lg bg-red-50 px-3 py-2 text-red-700">Recommendation failed. Try again.</p>}
      {recommend.data?.mode === 'legacy' && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-amber-800">
          This warehouse has no published layout, so the engine has no place to suggest.
        </p>
      )}
      {rec && (rec.recommendedLocationId != null
        ? <PutawayExplanationCard explanation={rec.explanation} />
        : <p className="rounded-lg bg-stone-50 px-3 py-2 text-stone-700">Nowhere can take it under the putaway rules.</p>)}
    </div>
  )
}
