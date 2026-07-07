import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  recommendPutaway,
  decidePutaway,
  type PutawayLineInput,
  type PutawayResponse,
  type DecidePutawayInput,
} from '@/services/supabase/putawayService'

/** Request engine putaway recommendations for a set of received lines.
 *  Pass dryRun for a read-only preview that never persists a queue task. */
export function useRecommendPutaway() {
  return useMutation<PutawayResponse, Error, { warehouseId: number; lines: PutawayLineInput[]; goodsReceiptId?: number; dryRun?: boolean }>({
    mutationFn: ({ warehouseId, lines, goodsReceiptId, dryRun }) => recommendPutaway(warehouseId, lines, goodsReceiptId, dryRun),
  })
}

/** Accept or override a recommendation; the stock move happens server-side. */
export function useDecidePutaway() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: DecidePutawayInput) => decidePutaway(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['inventory-balances'] })
      qc.invalidateQueries({ queryKey: ['inventoryBalances'] })
    },
  })
}
