import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  getSalesTargets,
  createSalesTarget,
  updateSalesTarget,
  deleteSalesTarget,
} from '@/services/supabase/salesTargetService'
import type { Database } from '@/lib/database.types'

type SalesTargetInsert = Database['public']['Tables']['sales_targets']['Insert']
type SalesTargetUpdate = Database['public']['Tables']['sales_targets']['Update']

export const salesTargetKeys = {
  all: ['salesTargets'] as const,
  byUser: (userId: string) => ['salesTargets', 'user', userId] as const,
} as const

export function useSalesTargets(userId?: string | null) {
  return useQuery({
    queryKey: userId ? salesTargetKeys.byUser(userId) : salesTargetKeys.all,
    queryFn: () => getSalesTargets(userId ?? undefined),
  })
}

export function useCreateSalesTarget() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (target: SalesTargetInsert) => createSalesTarget(target),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: salesTargetKeys.all })
    },
  })
}

export function useUpdateSalesTarget() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, updates }: { id: number; updates: SalesTargetUpdate }) =>
      updateSalesTarget(id, updates),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: salesTargetKeys.all })
    },
  })
}

export function useDeleteSalesTarget() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => deleteSalesTarget(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: salesTargetKeys.all })
    },
  })
}
