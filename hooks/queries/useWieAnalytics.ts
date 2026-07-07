import { useQuery } from '@tanstack/react-query'
import { getProductVelocity, getLocationTraffic } from '@/services/supabase/wieAnalyticsService'

export const wieAnalyticsKeys = {
  velocity: (warehouseId: number) => ['wie-velocity', warehouseId] as const,
  traffic: (layoutId: number) => ['wie-traffic', layoutId] as const,
}

const FIVE_MIN = 5 * 60 * 1000

/** ABC velocity per product for a warehouse — disabled until a warehouse is chosen. */
export function useProductVelocity(warehouseId: number | null) {
  return useQuery({
    queryKey: wieAnalyticsKeys.velocity(warehouseId ?? 0),
    queryFn: () => getProductVelocity(warehouseId as number),
    enabled: warehouseId != null,
    staleTime: FIVE_MIN,
  })
}

/** Per-node pick traffic for a published layout — disabled for bulk / unpublished. */
export function useLocationTraffic(layoutId: number | null) {
  return useQuery({
    queryKey: wieAnalyticsKeys.traffic(layoutId ?? 0),
    queryFn: () => getLocationTraffic(layoutId as number),
    enabled: layoutId != null,
    staleTime: FIVE_MIN,
  })
}
