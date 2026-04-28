import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
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

export function usePromotions() {
  return useQuery({
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

export function useUpdatePromotion() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, updates }: { id: string; updates: PromotionUpdate }) =>
      updatePromotion(id, updates),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: promotionKeys.all })
    },
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
