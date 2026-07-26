import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  getLevelRoles,
  getLevelRoleUsage,
  createLevelRole,
  updateLevelRole,
  deleteLevelRole,
  type LevelRoleInput,
} from '@/services/supabase/levelRoleService'
import { FALLBACK_LEVEL_ROLES } from '@/lib/levelRoles'

export const levelRoleKeys = {
  all: ['level-roles'] as const,
  usage: (key: string) => ['level-roles', 'usage', key] as const,
}

/**
 * The level-role vocabulary (mig 00081).
 *
 * A dedicated query key rather than seeding these into useSettings or
 * useWarehouses: every consumer — the rack level editor, both canvases, the bin
 * picker, Storage Forms, Product WMS attributes — calls this and TanStack
 * dedupes to a single request, whereas piggybacking on another query would
 * couple unrelated invalidations.
 *
 * placeholderData means a canvas never renders a level in neutral grey while the
 * fetch is in flight, and an erroring fetch degrades to today's exact behaviour
 * instead of to empty dropdowns.
 */
export function useLevelRoles() {
  return useQuery({
    queryKey: levelRoleKeys.all,
    queryFn: getLevelRoles,
    staleTime: 5 * 60_000, // roles change about as often as the warehouse is rebuilt
    placeholderData: FALLBACK_LEVEL_ROLES,
  })
}

/** What still references a role — drives the "in use by N locations" refusal. */
export function useLevelRoleUsage(key: string | null) {
  return useQuery({
    queryKey: levelRoleKeys.usage(key ?? ''),
    queryFn: () => getLevelRoleUsage(key as string),
    enabled: Boolean(key),
    staleTime: 30_000,
  })
}

export function useCreateLevelRole() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: LevelRoleInput) => createLevelRole(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: levelRoleKeys.all }),
  })
}

export function useUpdateLevelRole() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ key, patch }: { key: string; patch: LevelRoleInput }) =>
      updateLevelRole(key, patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: levelRoleKeys.all }),
  })
}

export function useDeleteLevelRole() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (key: string) => deleteLevelRole(key),
    onSuccess: () => qc.invalidateQueries({ queryKey: levelRoleKeys.all }),
  })
}
