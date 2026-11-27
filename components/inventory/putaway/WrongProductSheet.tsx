// "Not this product?" on a Walk stop (NX-0050).
//
// The carton's label says the stop's product, but it holds another. The walker
// picks the real product and counts it (carton sizes differ, so the count is
// theirs to give). report-wrong-product records the real product held, closes
// this stop and plans a held one to a hold location, and tells the desk.

import React, { useMemo, useState } from 'react'
import { useProducts } from '@/hooks/queries/useProducts'
import { useReportWrongProduct } from '@/hooks/queries/usePutawayWalk'
import LineProductPicker from '@/components/inventory/receive/LineProductPicker'
import type { PendingPutawayRow } from '@/services/supabase/putawayQueueService'
import type { Product } from '@/types'
import { toProduct } from '@/lib/adapters'

interface WrongProductSheetProps {
  row: PendingPutawayRow
  onClose: () => void
  onRecorded: (realSku: string) => void
}

export function WrongProductSheet({ row, onClose, onRecorded }: WrongProductSheetProps) {
  const { data: products } = useProducts()
  const report = useReportWrongProduct()
  const [real, setReal] = useState<Product | null>(null)
  const [qty, setQty] = useState('')
  const [error, setError] = useState<string | null>(null)

  const pool = useMemo(
    () => (products ?? []).map(toProduct).filter((p) => p.id !== row.productId),
    [products, row.productId],
  )
  const count = Number(qty)
  const ready = real !== null && Number.isInteger(count) && count > 0 && !report.isPending

  const submit = async () => {
    if (!real || !ready) return
    setError(null)
    try {
      await report.mutateAsync({ recommendationId: row.id, realProductId: real.id, quantity: count })
      onRecorded(real.sku)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not record it, try again.')
    }
  }

  return (
    <div className="mt-3 space-y-3 rounded-lg border border-amber-200 bg-amber-50/60 p-3" role="group" aria-label="Not this product">
      <p className="text-sm text-stone-800">
        The label says <span className="font-mono">{row.product?.sku}</span>. What is really in the carton?
      </p>
      {real ? (
        <p className="text-sm font-medium text-stone-900">
          {real.name} <span className="font-mono text-xs text-stone-500">{real.sku}</span>{' '}
          <button type="button" className="text-xs underline touch-target-y" onClick={() => setReal(null)}>Change</button>
        </p>
      ) : (
        <LineProductPicker pool={pool} supplierId={null} onChoose={setReal} label="What is really in the carton" />
      )}
      <label className="block text-sm text-stone-700">
        How many are there?
        <input
          aria-label="How many are there?"
          type="number"
          inputMode="numeric"
          min={1}
          step={1}
          value={qty}
          onChange={(e) => setQty(e.target.value)}
          className="mt-1 block w-full min-h-[44px] rounded-md border border-stone-300 px-2"
        />
      </label>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      <div className="flex gap-2">
        <button
          type="button"
          disabled={!ready}
          onClick={submit}
          className="min-h-[44px] rounded-md bg-nexgen-blue-dark px-3 text-sm font-medium text-white disabled:opacity-50"
        >
          {report.isPending ? 'Recording…' : 'Record and hold'}
        </button>
        <button type="button" onClick={onClose} className="min-h-[44px] rounded-md border border-stone-300 px-3 text-sm">
          Cancel
        </button>
      </div>
      <p className="text-xs text-stone-600">
        The stock is recorded as the real product and held for quarantine. The desk is told to check the barcode.
      </p>
    </div>
  )
}

export default WrongProductSheet
