import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  getOffHomeTasks,
  detectOffHome,
  acceptOffHome,
  dismissOffHome,
} from '@/services/supabase/offHomeService'

export const offHomeKeys = {
  all: ['offhome'] as const,
  forWarehouse: (warehouseId: number) => ['offhome', warehouseId] as const,
}

export function useOffHomeTasks(warehouseId: number | null | undefined) {
  return useQuery({
    queryKey: offHomeKeys.forWarehouse(warehouseId ?? 0),
    queryFn: () => getOffHomeTasks(warehouseId as number),
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
