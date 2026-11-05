import { useMutation, useQueryClient } from '@tanstack/react-query'
import { runImportPo, type ImportPoRequest } from '@/services/supabase/importPoService'
import { orderKeys } from './useOrders'
import { pickKeys } from './usePickQueue'
import { productKeys } from './useProducts'

/** Asks what a file would do. Writes nothing, so it refreshes nothing. */
export function useImportPoPreview() {
  return useMutation({
    mutationFn: (csvText: string) => runImportPo({ action: 'preview', csvText }),
  })
}

export function useImportPoCommit() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ csvText, applyChanges }: Required<Pick<ImportPoRequest, 'csvText' | 'applyChanges'>>) =>
      runImportPo({ action: 'commit', csvText, applyChanges }),
    // Some invoices may have landed even if the call then failed, so this runs
    // either way. A new order is pickable, and its reservation changes availability.
    onSettled: () => {
      qc.invalidateQueries({ queryKey: orderKeys.all })
      qc.invalidateQueries({ queryKey: pickKeys.queue })
      qc.invalidateQueries({ queryKey: productKeys.all })
    },
  })
}
