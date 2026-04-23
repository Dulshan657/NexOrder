import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  getHoReCas,
  createHoReCa,
  updateHoReCa,
  deleteHoReCa,
  upsertHoReCaPricing,
  markHoReCaReviewed,
} from '@/services/supabase/horecaService'
import type { Database } from '@/lib/database.types'

type HoReCaInsert = Database['public']['Tables']['horecas']['Insert']
type HoReCaUpdate = Database['public']['Tables']['horecas']['Update']

export const horecaKeys = {
  all: ['horecas'] as const,
} as const

export function useHoReCas() {
  return useQuery({
    queryKey: horecaKeys.all,
    queryFn: getHoReCas,
  })
}

export function useCreateHoReCa() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (horeca: HoReCaInsert) => createHoReCa(horeca),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: horecaKeys.all })
    },
  })
}

export function useUpdateHoReCa() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, updates }: { id: number; updates: HoReCaUpdate }) =>
      updateHoReCa(id, updates),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: horecaKeys.all })
    },
  })
}

export function useDeleteHoReCa() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => deleteHoReCa(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: horecaKeys.all })
    },
  })
}

export function useMarkHoReCaReviewed() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, reviewerUuid }: { id: number; reviewerUuid: string }) =>
      markHoReCaReviewed(id, reviewerUuid),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: horecaKeys.all })
    },
    onError: (err) => console.error('[horecas] mark reviewed failed', err),
  })
}

export function useUpsertHoReCaPricing() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      horecaId,
      productId,
      customPrice,
    }: {
      horecaId: number
      productId: number
      customPrice: number
    }) => upsertHoReCaPricing(horecaId, productId, customPrice),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: horecaKeys.all })
    },
  })
}
