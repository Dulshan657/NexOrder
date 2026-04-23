import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  getScheduledVisits,
  getScheduledVisitById,
  createScheduledVisit,
  updateScheduledVisit,
  deleteScheduledVisit,
} from '@/services/supabase/scheduledVisitDbService'
import type { ScheduledVisitFilters } from '@/services/supabase/scheduledVisitDbService'
import type { Database } from '@/lib/database.types'

type ScheduledVisitInsert = Database['public']['Tables']['scheduled_visits']['Insert']
type ScheduledVisitUpdate = Database['public']['Tables']['scheduled_visits']['Update']

export const routeKeys = {
  all: ['scheduled_visits'] as const,
  filtered: (filters: ScheduledVisitFilters) => ['scheduled_visits', filters] as const,
  detail: (id: string) => ['scheduled_visits', id] as const,
} as const

export function useScheduledVisits(filters: ScheduledVisitFilters = {}) {
  return useQuery({
    queryKey: routeKeys.filtered(filters),
    queryFn: () => getScheduledVisits(filters),
  })
}

export function useScheduledVisitById(id: string | null | undefined) {
  return useQuery({
    queryKey: routeKeys.detail(id ?? ''),
    queryFn: () => getScheduledVisitById(id!),
    enabled: !!id,
  })
}

export function useCreateScheduledVisit() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (route: ScheduledVisitInsert) => createScheduledVisit(route),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: routeKeys.all })
    },
    onError: (err) => console.error('[scheduled_visits] create failed', err),
  })
}

export function useUpdateScheduledVisit() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, updates }: { id: string; updates: ScheduledVisitUpdate }) =>
      updateScheduledVisit(id, updates),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: routeKeys.all })
    },
    onError: (err) => console.error('[scheduled_visits] update failed', err),
  })
}

export function useDeleteScheduledVisit() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => deleteScheduledVisit(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: routeKeys.all })
    },
    onError: (err) => console.error('[scheduled_visits] delete failed', err),
  })
}
