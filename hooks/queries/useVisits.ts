import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  getVisits,
  createVisit,
  updateVisit,
} from '@/services/supabase/visitService'
import type { VisitFilters } from '@/services/supabase/visitService'
import type { Database } from '@/lib/database.types'

type VisitInsert = Database['public']['Tables']['visits']['Insert']
type VisitUpdate = Database['public']['Tables']['visits']['Update']

export const visitKeys = {
  all: ['visits'] as const,
  filtered: (filters: VisitFilters) => ['visits', filters] as const,
} as const

export function useVisits(filters: VisitFilters = {}) {
  return useQuery({
    queryKey: visitKeys.filtered(filters),
    queryFn: () => getVisits(filters),
  })
}

export function useCreateVisit() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (visit: VisitInsert) => createVisit(visit),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: visitKeys.all })
    },
  })
}

export function useUpdateVisit() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, updates }: { id: string; updates: VisitUpdate }) =>
      updateVisit(id, updates),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: visitKeys.all })
    },
  })
}
