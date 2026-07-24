// The walk half of two-stage putaway (mig 00080): the assigned tasks, the route
// through them, and the mutations that complete or abandon one.
//
// Every mutation invalidates `putawayKeys.all` + `.counts` for the same reason
// useDecidePutaway does — the queue key is written in one place and would
// otherwise serve a stale list forever (see __tests__/putawayInvalidation).
// Completing also invalidates inventory balances, because completing is the
// moment stock actually moves.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getAssignedPutaways, type PendingPutawayRow } from '@/services/supabase/putawayQueueService'
import { getPutawayRoute, type PutawayRouteResult } from '@/services/supabase/putawayRouteService'
import {
  completePutaway,
  unassignPutaway,
  type CompletePutawayInput,
  type CompletePutawayResult,
} from '@/services/supabase/putawayService'
import { putawayKeys } from './putawayKeys'

/** Tasks assigned to a bin but not yet carried there. */
export function useAssignedPutaways(warehouseId: number | null) {
  return useQuery<PendingPutawayRow[]>({
    queryKey: [...putawayKeys.all, 'assigned', warehouseId],
    enabled: warehouseId != null,
    queryFn: () => getAssignedPutaways(warehouseId as number),
    // Same reasoning as the Assign queue: a walker returning to this tab must
    // never be shown a task someone else already placed.
    staleTime: 0,
    refetchOnMount: 'always',
  })
}

/** Dock-anchored walk order for those tasks. `legacy` for non-racked sites. */
export function usePutawayRoute(warehouseId: number | null) {
  return useQuery<PutawayRouteResult>({
    queryKey: ['putaway-route', warehouseId],
    enabled: warehouseId != null,
    queryFn: () => getPutawayRoute(warehouseId as number),
    staleTime: 0,
  })
}

/** Record a task as physically placed. THIS is what moves the stock. */
export function useCompletePutaway() {
  const qc = useQueryClient()
  return useMutation<CompletePutawayResult, Error, CompletePutawayInput>({
    mutationFn: (input) => completePutaway(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['inventory-balances'] })
      qc.invalidateQueries({ queryKey: ['inventoryBalances'] })
      qc.invalidateQueries({ queryKey: putawayKeys.all })
      qc.invalidateQueries({ queryKey: putawayKeys.counts })
      qc.invalidateQueries({ queryKey: ['putaway-route'] })
    },
  })
}

/** Send an assigned task back to the Assign queue. No stock has moved. */
export function useUnassignPutaway() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (recommendationId: number) => unassignPutaway(recommendationId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: putawayKeys.all })
      qc.invalidateQueries({ queryKey: putawayKeys.counts })
      qc.invalidateQueries({ queryKey: ['putaway-route'] })
    },
  })
}
