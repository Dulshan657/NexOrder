import { useQuery } from '@tanstack/react-query'
import { getPoInboxStats, type PoInboxStats } from '@/services/supabase/poInboxStatsService'

export function usePoInboxStats() {
  return useQuery<PoInboxStats>({
    queryKey: ['po_inbox_stats'],
    queryFn: getPoInboxStats,
    staleTime: 60_000,
    refetchInterval: 60_000,
  })
}
