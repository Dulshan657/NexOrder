import { useQuery, keepPreviousData } from '@tanstack/react-query'
import {
  getAuditEvents,
  getClientErrors,
  type AuditFilters,
  type ClientErrorFilters,
} from '@/services/supabase/auditService'

export const auditKeys = {
  events: (filters: AuditFilters) => ['audit_events', filters] as const,
  errors: (filters: ClientErrorFilters) => ['client_errors', filters] as const,
} as const

const STALE_TIME = 30_000

export function useAuditEvents(filters: AuditFilters) {
  return useQuery({
    queryKey: auditKeys.events(filters),
    queryFn: () => getAuditEvents(filters),
    staleTime: STALE_TIME,
    placeholderData: keepPreviousData,
  })
}

export function useClientErrors(filters: ClientErrorFilters) {
  return useQuery({
    queryKey: auditKeys.errors(filters),
    queryFn: () => getClientErrors(filters),
    staleTime: STALE_TIME,
    placeholderData: keepPreviousData,
  })
}
