import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  getRoutes,
  getRouteById,
  createRoute,
  updateRoute,
  deleteRoute,
} from '@/services/supabase/routeDbService'
import type { RouteFilters } from '@/services/supabase/routeDbService'
import type { Database } from '@/lib/database.types'

type RouteInsert = Database['public']['Tables']['routes']['Insert']
type RouteUpdate = Database['public']['Tables']['routes']['Update']

export const routeKeys = {
  all: ['routes'] as const,
  filtered: (filters: RouteFilters) => ['routes', filters] as const,
  detail: (id: string) => ['routes', id] as const,
} as const

export function useRoutes(filters: RouteFilters = {}) {
  return useQuery({
    queryKey: routeKeys.filtered(filters),
    queryFn: () => getRoutes(filters),
  })
}

export function useRouteById(id: string | null | undefined) {
  return useQuery({
    queryKey: routeKeys.detail(id ?? ''),
    queryFn: () => getRouteById(id!),
    enabled: !!id,
  })
}

export function useCreateRoute() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (route: RouteInsert) => createRoute(route),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: routeKeys.all })
    },
  })
}

export function useUpdateRoute() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, updates }: { id: string; updates: RouteUpdate }) =>
      updateRoute(id, updates),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: routeKeys.all })
    },
  })
}

export function useDeleteRoute() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => deleteRoute(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: routeKeys.all })
    },
  })
}
