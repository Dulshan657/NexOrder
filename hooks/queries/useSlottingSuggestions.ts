import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  getSlottingSuggestions,
  decideSlotting,
  runReoptimize,
  type ReoptimizeResult,
} from '@/services/supabase/slottingService'

export const slottingKeys = {
  byWarehouse: (warehouseId: number) => ['slotting', warehouseId] as const,
}

export function useSlottingSuggestions(warehouseId: number | null) {
  return useQuery({
    queryKey: slottingKeys.byWarehouse(warehouseId ?? 0),
    queryFn: () => getSlottingSuggestions(warehouseId as number),
    enabled: warehouseId != null,
  })
}

export function useDecideSlotting(warehouseId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ suggestionId, decision }: { suggestionId: number; decision: 'accept' | 'reject' }) =>
      decideSlotting(suggestionId, decision),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: slottingKeys.byWarehouse(warehouseId) })
      qc.invalidateQueries({ queryKey: ['inventory-balances'] })
    },
  })
}

export function useRunReoptimize(warehouseId: number) {
  const qc = useQueryClient()
  return useMutation<ReoptimizeResult, Error, void>({
    mutationFn: () => runReoptimize(warehouseId),
    onSuccess: () => qc.invalidateQueries({ queryKey: slottingKeys.byWarehouse(warehouseId) }),
  })
}
