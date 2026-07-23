import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  recommendPutaway,
  decidePutaway,
  type PutawayLineInput,
  type PutawayResponse,
  type DecidePutawayInput,
} from '@/services/supabase/putawayService'
import { putawayKeys } from './putawayKeys'

/** Request engine putaway recommendations for a set of received lines.
 *  Pass dryRun for a read-only preview that never persists a queue task. */
export function useRecommendPutaway() {
  return useMutation<PutawayResponse, Error, { warehouseId: number; lines: PutawayLineInput[]; goodsReceiptId?: number; dryRun?: boolean }>({
    mutationFn: ({ warehouseId, lines, goodsReceiptId, dryRun }) => recommendPutaway(warehouseId, lines, goodsReceiptId, dryRun),
  })
}

/** Accept or override a recommendation; the stock move happens server-side.
 *  Pass `quantity` to put away part of the line — the remainder stays queued. */
export function useDecidePutaway() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: DecidePutawayInput) => decidePutaway(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['inventory-balances'] })
      qc.invalidateQueries({ queryKey: ['inventoryBalances'] })
      // The decided row leaves 'suggested' — refresh the queue + counts so the
      // accepted/overridden row disappears without a manual refetch. A partial
      // putaway rides the same invalidation: the remainder row comes back with
      // its reduced quantity.
      qc.invalidateQueries({ queryKey: putawayKeys.all })
      qc.invalidateQueries({ queryKey: putawayKeys.counts })
    },
  })
}

/** Ask the engine to score a queued line again, expiring the row it replaces.
 *  Used by the queue's per-row "Re-run" — the way out of a `no eligible bin`
 *  row after the layout or the bin's contents changed. */
export function useRerunPutaway() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ warehouseId, recommendationId, productId, quantity, goodsReceiptId }: {
      warehouseId: number
      recommendationId: number
      productId: number
      quantity: number
      goodsReceiptId?: number
    }) =>
      recommendPutaway(
        warehouseId,
        [{ product_id: productId, quantity }],
        goodsReceiptId,
        false,
        recommendationId,
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: putawayKeys.all })
      qc.invalidateQueries({ queryKey: putawayKeys.counts })
    },
  })
}
