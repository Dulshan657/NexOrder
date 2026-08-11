// Ending a hold (mig 00101).

import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  releaseQuarantine,
  type ReleaseQuarantineInput,
  type ReleaseQuarantineResult,
} from '@/services/supabase/quarantineService'
import { inventoryKeys } from './useInventoryBalances'

export function useReleaseQuarantine() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: ReleaseQuarantineInput): Promise<ReleaseQuarantineResult> => releaseQuarantine(input),
    onSuccess: () => {
      // Stock moved between two bins, so every balance view is stale.
      qc.invalidateQueries({ queryKey: inventoryKeys.balances })
      // ...and `products.available` genuinely CHANGED, which is the whole point:
      // inv_recompute_product_cache excludes held stock, so leaving quarantine
      // is what makes these units sellable. A stale catalogue would keep
      // reporting them as unavailable.
      qc.invalidateQueries({ queryKey: ['products'] })
    },
  })
}
