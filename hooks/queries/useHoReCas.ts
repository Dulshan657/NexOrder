import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { optimisticUpdate, patchRowById } from '@/lib/optimistic'
import {
  getHoReCas,
  createHoReCa,
  updateHoReCa,
  deleteHoReCa,
  markHoReCaReviewed,
  listHorecaReps,
  setHorecaReps,
} from '@/services/supabase/horecaService'
import type { Database } from '@/lib/database.types'

type HoReCaInsert = Database['public']['Tables']['horecas']['Insert']
type HoReCaUpdate = Database['public']['Tables']['horecas']['Update']

export const horecaKeys = {
  all: ['horecas'] as const,
  /** The reps assigned to one venue (profile ids). */
  reps: (horecaId: number) => ['horeca-reps', horecaId] as const,
} as const

export function useHoReCas({ enabled = true }: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: horecaKeys.all,
    queryFn: getHoReCas,
    enabled,
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

/** Profile ids of the reps assigned to a venue. Staff only (RLS); pass `enabled: false` to keep it idle. */
export function useHorecaReps(horecaId: number | null | undefined, { enabled = true }: { enabled?: boolean } = {}) {
  return useQuery<string[]>({
    queryKey: horecaKeys.reps(horecaId ?? 0),
    queryFn: () => listHorecaReps(horecaId as number),
    enabled: enabled && horecaId != null,
  })
}

/** `mutate({ horecaId, repIds, reason? })`: the COMPLETE set; an empty array unassigns everyone. */
export function useSetHorecaReps() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ horecaId, repIds, reason }: { horecaId: number; repIds: string[]; reason?: string }) =>
      setHorecaReps(horecaId, repIds, reason),
    onSuccess: (_stored, { horecaId }) => {
      qc.invalidateQueries({ queryKey: horecaKeys.reps(horecaId) })
    },
  })
}
