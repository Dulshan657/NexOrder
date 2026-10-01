import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { optimisticUpdate, patchRowById } from '@/lib/optimistic'
import {
  getHoReCas,
  createHoReCa,
  updateHoReCa,
  deleteHoReCa,
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
    mutationFn: ({ horeca, reason }: { horeca: HoReCaInsert; reason?: string }) =>
      createHoReCa(horeca, reason),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: horecaKeys.all })
    },
  })
}

export function useUpdateHoReCa() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, updates, reason }: { id: number; updates: HoReCaUpdate; reason?: string }) =>
      updateHoReCa(id, updates, reason),
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
  // Mirrors what markHoReCaReviewed writes, so the review flag clears on click.
  const optimistic = optimisticUpdate<number>(qc, horecaKeys.all, (data, id) =>
    patchRowById(data, id, { reviewed_at: new Date().toISOString(), is_temporary: false }),
  )
  return useMutation({
    mutationFn: (id: number) => markHoReCaReviewed(id),
    ...optimistic,
    onError: (err, id, context) => {
      optimistic.onError(err, id, context)
      console.error('[horecas] mark reviewed failed', err)
    },
  })
}
