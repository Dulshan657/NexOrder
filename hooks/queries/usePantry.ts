import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  getPantryItems,
  upsertPantryItem,
  deletePantryItem,
} from '@/services/supabase/pantryService'
import type { Database } from '@/lib/database.types'

type PantryItemInsert = Database['public']['Tables']['pantry_items']['Insert']

export const pantryKeys = {
  all: ['pantry'] as const,
  byHoReCa: (horecaId: number) => ['pantry', horecaId] as const,
} as const

export function usePantryItems(horecaId: number | null | undefined) {
  return useQuery({
    queryKey: pantryKeys.byHoReCa(horecaId ?? 0),
    queryFn: () => getPantryItems(horecaId!),
    enabled: !!horecaId,
  })
}

export function useUpsertPantryItem() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (item: PantryItemInsert) => upsertPantryItem(item),
    onSuccess: (_data, variables) => {
      // Invalidate only the specific HoReCa's pantry for targeted cache busting
      qc.invalidateQueries({
        queryKey: pantryKeys.byHoReCa(variables.horeca_id),
      })
    },
  })
}

export function useDeletePantryItem() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      horecaId,
      productId,
    }: {
      horecaId: number
      productId: number
    }) => deletePantryItem(horecaId, productId),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({
        queryKey: pantryKeys.byHoReCa(variables.horecaId),
      })
    },
  })
}
