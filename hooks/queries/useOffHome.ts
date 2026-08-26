import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  getOffHomeTasks,
  detectOffHome,
  acceptOffHome,
  dismissOffHome,
  restoreOffHome,
  type OffHomeListStatus,
} from '@/services/supabase/offHomeService'

export const offHomeKeys = {
  all: ['offhome'] as const,
  /** Deliberately still the two-element key, and deliberately a PREFIX of
   *  `list`. Invalidating it refreshes both the To do and Left alone lists,
   *  which is what every mutation here needs — a task always leaves one of them
   *  and joins the other. */
  forWarehouse: (warehouseId: number) => ['offhome', warehouseId] as const,
  list: (warehouseId: number, status: OffHomeListStatus) =>
    ['offhome', warehouseId, status] as const,
}

export function useOffHomeTasks(
  warehouseId: number | null | undefined,
  status: OffHomeListStatus = 'suggested',
) {
  return useQuery({
    queryKey: offHomeKeys.list(warehouseId ?? 0, status),
    queryFn: () => getOffHomeTasks(warehouseId as number, status),
    enabled: typeof warehouseId === 'number' && warehouseId > 0,
    // Short, unlike the slotting rules: this list changes as stock moves, and a
    // walker on the floor must not be shown work somebody else just did.
    staleTime: 30_000,
  })
}

export function useDetectOffHome() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ warehouseId, dryRun }: { warehouseId: number; dryRun?: boolean }) =>
      detectOffHome(warehouseId, dryRun),
    onSuccess: (_r, { warehouseId, dryRun }) => {
      if (!dryRun) qc.invalidateQueries({ queryKey: offHomeKeys.forWarehouse(warehouseId) })
    },
  })
}

export function useAcceptOffHome() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ taskId, toLocationId, quantity }:
      { warehouseId: number; taskId: number; toLocationId?: number | null; quantity?: number | null }) =>
      acceptOffHome(taskId, { toLocationId, quantity }),
    onSuccess: (_r, { warehouseId }) => {
      qc.invalidateQueries({ queryKey: offHomeKeys.forWarehouse(warehouseId) })
      // The stock actually moved, so every balance-derived view is now stale.
      qc.invalidateQueries({ queryKey: ['inventory-balances'] })
      qc.invalidateQueries({ queryKey: ['products'] })
    },
  })
}

export function useDismissOffHome() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ taskId, reason }: { warehouseId: number; taskId: number; reason: string }) =>
      dismissOffHome(taskId, reason),
    onSuccess: (_r, { warehouseId }) =>
      qc.invalidateQueries({ queryKey: offHomeKeys.forWarehouse(warehouseId) }),
  })
}

export function useRestoreOffHome() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ taskId }: { warehouseId: number; taskId: number }) => restoreOffHome(taskId),
    onSuccess: (_r, { warehouseId }) =>
      // The prefix, so both lists refresh. NOT the balance or product keys the
      // accept path invalidates: a restore moves no stock, and invalidating a
      // key it cannot have changed only costs the floor a refetch.
      qc.invalidateQueries({ queryKey: offHomeKeys.forWarehouse(warehouseId) }),
  })
}
