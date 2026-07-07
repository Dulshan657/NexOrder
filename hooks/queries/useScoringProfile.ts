import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getScoringProfile, saveScoringProfile } from '@/services/supabase/scoringProfileService'
import type { WieScoringWeights } from '@/types'

export const scoringProfileKeys = {
  byWarehouse: (warehouseId: number) => ['scoring-profile', warehouseId] as const,
}

export function useScoringProfile(warehouseId: number | null) {
  return useQuery({
    queryKey: scoringProfileKeys.byWarehouse(warehouseId ?? 0),
    queryFn: () => getScoringProfile(warehouseId as number),
    enabled: warehouseId != null,
  })
}

export function useSaveScoringProfile(warehouseId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (weights: WieScoringWeights) => saveScoringProfile(warehouseId, weights),
    onSuccess: () => qc.invalidateQueries({ queryKey: scoringProfileKeys.byWarehouse(warehouseId) }),
  })
}
