import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  recommendPutaway,
  decidePutaway,
  type PutawayLineInput,
  type PutawayResponse,
  type DecidePutawayInput,
} from '@/services/supabase/putawayService'
import { putawayKeys } from './putawayKeys'
import { inventoryKeys } from './useInventoryBalances'

/** Request engine putaway recommendations for a set of received lines.
 *  Pass dryRun for a read-only preview that never persists a queue task. */
export function useRecommendPutaway() {
  return useMutation<PutawayResponse, Error, { warehouseId: number; lines: PutawayLineInput[]; goodsReceiptId?: number; dryRun?: boolean }>({
    mutationFn: ({ warehouseId, lines, goodsReceiptId, dryRun }) => recommendPutaway(warehouseId, lines, goodsReceiptId, dryRun),
  })
}

/** Put a receipt away again after receive-stock could not read a home bin
 *  (NX-0032). The receipt was booked and no task exists, so this is a real run,
 *  not a preview: it creates the tasks the first attempt would have. `lines` are
 *  the ones receive-stock returned as `putaway_lines`. */
export function useRetryReceiptPutaway() {
  const qc = useQueryClient()
  return useMutation<PutawayResponse, Error, { warehouseId: number; lines: PutawayLineInput[]; goodsReceiptId?: number }>({
    mutationFn: ({ warehouseId, lines, goodsReceiptId }) => recommendPutaway(warehouseId, lines, goodsReceiptId),
    onSuccess: () => {
      // The queue and its nav badge gained tasks.
      qc.invalidateQueries({ queryKey: putawayKeys.all })
      qc.invalidateQueries({ queryKey: putawayKeys.counts })
    },
  })
}

/** Accept or override a recommendation; the stock move happens server-side.
 *  Pass `quantity` to put away part of the line — the remainder stays queued. */
export function useDecidePutaway() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: DecidePutawayInput) => decidePutaway(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: inventoryKeys.balances })
      // The decided row leaves 'suggested' — refresh the queue + counts so the
      // accepted/overridden row disappears without a manual refetch. A partial
      // putaway rides the same invalidation: the remainder row comes back with
      // its reduced quantity.
      qc.invalidateQueries({ queryKey: putawayKeys.all })
      qc.invalidateQueries({ queryKey: putawayKeys.counts })
      // Assigning adds a stop to the walk; placing one-step removes nothing
      // from it but costs a single cheap refetch to stay honest either way.
      qc.invalidateQueries({ queryKey: ['putaway-route'] })
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
