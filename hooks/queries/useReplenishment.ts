import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  getReplenTasks,
  getPendingReplenCounts,
  detectReplenishment,
  assignReplenishment,
  completeReplenishment,
  unassignReplenishment,
} from '@/services/supabase/replenService'
import { getReplenRoute } from '@/services/supabase/replenRouteService'

export const replenKeys = {
  all: ['replenishment'] as const,
  tasks: (warehouseId: number | null) => ['replenishment', 'tasks', warehouseId] as const,
  route: (warehouseId: number | null) => ['replenishment', 'route', warehouseId] as const,
  counts: ['replenishment', 'counts'] as const,
}

/** Everything open at this warehouse: the desk queue and the floor run. */
export function useReplenTasks(warehouseId: number | null) {
  return useQuery({
    queryKey: replenKeys.tasks(warehouseId),
    queryFn: () => getReplenTasks(warehouseId as number),
    enabled: warehouseId != null,
    staleTime: 15_000,
  })
}

export function useReplenRoute(warehouseId: number | null) {
  return useQuery({
    queryKey: replenKeys.route(warehouseId),
    queryFn: () => getReplenRoute(warehouseId as number),
    enabled: warehouseId != null,
    staleTime: 30_000,
  })
}

export function usePendingReplenCounts(enabled: boolean) {
  return useQuery({
    queryKey: replenKeys.counts,
    queryFn: getPendingReplenCounts,
    enabled,
    staleTime: 60_000,
  })
}

/** Invalidate every replenishment surface at once. The queue, the route and the
 *  badge all describe the same rows, so any mutation moves all three. */
function useInvalidateReplen() {
  const qc = useQueryClient()
  return () => {
    qc.invalidateQueries({ queryKey: replenKeys.all })
  }
}

export function useDetectReplenishment() {
  const invalidate = useInvalidateReplen()
  return useMutation({
    mutationFn: ({ warehouseId, productId }: { warehouseId: number; productId?: number }) =>
      detectReplenishment(warehouseId, productId),
    onSuccess: invalidate,
  })
}

export function useAssignReplenishment() {
  const invalidate = useInvalidateReplen()
  return useMutation({
    mutationFn: assignReplenishment,
    onSuccess: invalidate,
  })
}

export function useCompleteReplenishment() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: completeReplenishment,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: replenKeys.all })
      // Stock moved between two bins, so anything showing per-bin quantities is
      // now stale: the warehouse map's fill colours, the stock tables, and the
      // putaway bin picker's capacity badges.
      qc.invalidateQueries({ queryKey: ['inventory'] })
      qc.invalidateQueries({ queryKey: ['warehouse'] })
    },
  })
}

export function useUnassignReplenishment() {
  const invalidate = useInvalidateReplen()
  return useMutation({
    mutationFn: ({ taskId, action, reason }: { taskId: number; action?: 'unassign' | 'cancel'; reason?: string }) =>
      unassignReplenishment(taskId, action ?? 'unassign', reason),
    onSuccess: invalidate,
  })
}
