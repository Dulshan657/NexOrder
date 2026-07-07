import { useQuery } from '@tanstack/react-query'
import { getPickRoute, type PickRouteResult } from '@/services/supabase/pickRouteService'

export function usePickRoute(warehouseId: number | null, orderIds: string[]) {
  const sortedIds = [...orderIds].sort()
  return useQuery<PickRouteResult>({
    queryKey: ['pick-route', warehouseId, sortedIds],
    enabled: warehouseId != null && orderIds.length > 0,
    queryFn: () => getPickRoute(warehouseId as number, orderIds),
  })
}
