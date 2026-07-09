import { useQuery } from '@tanstack/react-query'
import { getPendingPutawayCounts } from '@/services/supabase/putawayQueueService'
import { putawayKeys } from './putawayKeys'

/** Pending ('suggested') putaway recommendation count per warehouse — feeds the
 *  Putaway picker's smart default + per-option labels, and the nav badge total.
 *  Modeled on usePoInboxStats (60s stale + poll). The RLS policy
 *  `wie_putaway_recommendations_select_ops` rejects everyone but
 *  Admin/Manager/Warehouse, so callers must gate with `enabled`. */
export function usePendingPutawayCounts(enabled: boolean) {
  return useQuery({
    queryKey: putawayKeys.counts,
    queryFn: getPendingPutawayCounts,
    enabled,
    staleTime: 60_000,
    refetchInterval: 60_000,
  })
}
