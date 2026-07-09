import { useMutation, useQueryClient } from '@tanstack/react-query'
import { adjustStock } from '@/services/supabase/adjustStockService'
import type { AdjustStockPayload } from '@/lib/stockAdjustment'
import { inventoryKeys } from './useInventoryBalances'
import { putawayKeys } from './putawayKeys'

export function useAdjustStock() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: AdjustStockPayload) => adjustStock(input),
    onSuccess: (result) => {
      // on_hand (and possibly allocated, for a stocktake variance) changed at
      // this slot — refresh the aggregate ledger view, this product's
      // per-batch detail (StockView's expanded row), and the products.inventory
      // cache the RPC recomputes.
      qc.invalidateQueries({ queryKey: inventoryKeys.balances })
      qc.invalidateQueries({ queryKey: inventoryKeys.byProduct(result.productId) })
      qc.invalidateQueries({ queryKey: ['products'] })
      // adjust-stock also generates putaway tasks server-side (an upward
      // adjustment at a racked warehouse's root is stock that needs a bin).
      qc.invalidateQueries({ queryKey: putawayKeys.all })
      qc.invalidateQueries({ queryKey: putawayKeys.counts })
    },
  })
}
