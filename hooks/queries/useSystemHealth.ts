import { useQuery } from '@tanstack/react-query'
import {
  getLatestHealthCheck,
  getHealthChecks,
  getDeployments,
  getRecentClientErrorCount,
} from '@/services/supabase/systemHealthService'

export const systemHealthKeys = {
  latest: ['health_checks', 'latest'] as const,
  history: (sinceHours: number) => ['health_checks', 'history', sinceHours] as const,
  deployments: (limit: number) => ['deployments', limit] as const,
  errorCount: (minutes: number) => ['client_errors', 'count', minutes] as const,
} as const

/** Live banner — refetch every minute so a cron transition shows up quickly. */
export function useLatestHealthCheck() {
  return useQuery({
    queryKey: systemHealthKeys.latest,
    queryFn: getLatestHealthCheck,
    refetchInterval: 60_000,
    staleTime: 30_000,
  })
}

export function useHealthChecks(sinceHours: number, limit = 500) {
  return useQuery({
    queryKey: systemHealthKeys.history(sinceHours),
    queryFn: () => getHealthChecks(new Date(Date.now() - sinceHours * 3_600_000).toISOString(), limit),
    staleTime: 60_000,
  })
}

export function useDeployments(limit = 20) {
  return useQuery({
    queryKey: systemHealthKeys.deployments(limit),
    queryFn: () => getDeployments(limit),
    staleTime: 60_000,
  })
}

export function useRecentClientErrorCount(minutes = 60) {
  return useQuery({
    queryKey: systemHealthKeys.errorCount(minutes),
    queryFn: () => getRecentClientErrorCount(minutes),
    refetchInterval: 60_000,
    staleTime: 30_000,
  })
}
