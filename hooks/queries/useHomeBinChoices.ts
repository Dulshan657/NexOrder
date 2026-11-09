import { useQuery } from '@tanstack/react-query'
import { getHomeBinChoices } from '@/services/supabase/homeBinHealthService'

/**
 * The bins one product can be given as its home (NX-0033), for a Manager or
 * Admin giving a homeless product a home from the Walk. `enabled` keeps a
 * Warehouse user and a closed sheet from calling a function they may not use.
 * `recommendationId` is the line on the stop, whose own reservation must not
 * count against the bin it is going to.
 */
export function useHomeBinChoices(
  warehouseId: number,
  productId: number,
  enabled: boolean,
  recommendationId?: number,
) {
  return useQuery({
    queryKey: ['home-bin-choices', warehouseId, productId, recommendationId ?? null] as const,
    queryFn: () => getHomeBinChoices(warehouseId, productId, recommendationId),
    enabled,
    // A bin can become someone's home or fill up while the sheet is open; the
    // server checks again at completion either way, so never serve a stale list.
    staleTime: 0,
  })
}
