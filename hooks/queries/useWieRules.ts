import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  getWieRules,
  upsertWieRule,
  deleteWieRule,
  getCompatibility,
  setCompatibility,
  deleteCompatibility,
  type UpsertRuleInput,
} from '@/services/supabase/wieRuleService'
import type { CompatibilityLevel } from '@/types'

export function useWieRules() {
  return useQuery({ queryKey: ['wie-rules'], queryFn: getWieRules })
}

export function useUpsertWieRule() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: UpsertRuleInput) => upsertWieRule(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['wie-rules'] }),
  })
}

export function useDeleteWieRule() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => deleteWieRule(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['wie-rules'] }),
  })
}

export function useCompatibility() {
  return useQuery({ queryKey: ['category-compatibility'], queryFn: getCompatibility })
}

export function useSetCompatibility() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ a, b, level, note }: { a: string; b: string; level: CompatibilityLevel; note?: string }) =>
      setCompatibility(a, b, level, note),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['category-compatibility'] }),
  })
}

export function useDeleteCompatibility() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ a, b }: { a: string; b: string }) => deleteCompatibility(a, b),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['category-compatibility'] }),
  })
}
