import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import {
  deleteOrderDraft,
  listOrderDrafts,
  saveOrderDraft,
  type SaveOrderDraftInput,
} from '@/services/supabase/orderDraftService'

export const orderDraftKeys = {
  all: ['orderDrafts'] as const,
} as const

/** Shared drafts change under other people's hands, so refresh them often. */
const DRAFTS_STALE_MS = 30_000

export function useOrderDrafts() {
  return useQuery({ queryKey: orderDraftKeys.all, queryFn: listOrderDrafts, staleTime: DRAFTS_STALE_MS })
}

/** Auto-save fires every few seconds while an order is keyed, so only a
 *  CREATE refreshes the shared list; the list is refetched when it is opened. */
export function useSaveOrderDraft() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: SaveOrderDraftInput) => saveOrderDraft(input),
    onSuccess: (_saved, input) => {
      if (input.id === null) qc.invalidateQueries({ queryKey: orderDraftKeys.all })
    },
  })
}

export function useDeleteOrderDraft() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => deleteOrderDraft(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: orderDraftKeys.all }),
  })
}
