import { useQuery } from '@tanstack/react-query'
import { getHomeBinHealth } from '@/services/supabase/homeBinHealthService'

export const homeBinHealthKeys = {
  all: ['homeBinHealth'] as const,
  warehouse: (warehouseId: number | null) => ['homeBinHealth', warehouseId] as const,
}

/** The home bins in one warehouse that putaway cannot use. */
export function useHomeBinHealth(warehouseId: number | null, enabled = true) {
  return useQuery({
    queryKey: homeBinHealthKeys.warehouse(warehouseId),
    queryFn: () => getHomeBinHealth(warehouseId as number),
    enabled: enabled && warehouseId != null,
    // It is a pre-release check and an occasional glance, not a live feed: a
    // wrong bin takes a person to fix, and the panel has a Check again button.
    staleTime: 60_000,
  })
}
