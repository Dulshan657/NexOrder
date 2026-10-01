import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { optimisticUpdate, patchRowById } from '@/lib/optimistic'
import {
  getPromotions,
  getActivePromotions,
  createPromotion,
  updatePromotion,
  deletePromotion,
} from '@/services/supabase/promotionDbService'
import type { Database } from '@/lib/database.types'

type PromotionInsert = Database['public']['Tables']['promotions']['Insert']
type PromotionUpdate = Database['public']['Tables']['promotions']['Update']

export const promotionKeys = {
  all: ['promotions'] as const,
  active: ['promotions', 'active'] as const,
} as const

export function usePromotions({ enabled = true }: { enabled?: boolean } = {}) {
  return useQuery({
    enabled,
    queryKey: promotionKeys.all,
    queryFn: getPromotions,
  })
}

export function useActivePromotions() {
  return useQuery({
    queryKey: promotionKeys.active,
    queryFn: getActivePromotions,
  })
}

export function useCreatePromotion() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (promo: PromotionInsert) => createPromotion(promo),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: promotionKeys.all })
    },
  })
}

// Optimistic, so the on/off toggle flips on click. The server's role gate is
// the only thing that refuses it, and a refusal rolls the toggle back.
export function useUpdatePromotion() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, updates }: { id: string; updates: PromotionUpdate }) =>
      updatePromotion(id, updates),
    ...optimisticUpdate<{ id: string; updates: PromotionUpdate }>(
      qc, promotionKeys.all, (data, { id, updates }) => patchRowById(data, id, updates),
    ),
  })
}

export function useDeletePromotion() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => deletePromotion(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: promotionKeys.all })
    },
  })
}
