// Queries and the mutation for the stocktake count sheet.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getLocationCountSheet } from '@/services/supabase/inventoryService'
import { postCountBin, type CountBinPayload } from '@/services/supabase/countBinService'
import type { CountPostResult, CountSheetLine } from '@/lib/binCount'
import { inventoryKeys } from './useInventoryBalances'
import { putawayKeys } from './putawayKeys'

export const countKeys = {
  // Nested under the `['inventory_balances']` prefix on purpose: useAdjustStock,
  // the realtime subscription and useCountBin all invalidate by prefix, so a
  // count sheet refreshes for free when stock moves by any other route.
  sheet: (locationId: number) => ['inventory_balances', 'count_sheet', locationId] as const,
} as const

/** Everything the system believes is at one location. Disabled until a location
 *  is chosen. `staleTime: 0` — a count sheet must never be read from cache after
 *  the count that just changed it. */
export function useLocationCountSheet(locationId: number | null) {
  return useQuery({
    queryKey: countKeys.sheet(locationId ?? 0),
    queryFn: async (): Promise<CountSheetLine[]> => {
      const rows = await getLocationCountSheet(locationId as number)
      return rows.map((r) => ({
        productId: r.productId,
        sku: r.sku,
        name: r.name,
        barcode: r.barcode,
        slots: r.slots,
      }))
    },
    enabled: locationId != null,
    staleTime: 0,
  })
}

export function useCountBin() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: CountBinPayload): Promise<CountPostResult> => postCountBin(input),
    onSuccess: (result) => {
      // Same invalidation set as useAdjustStock — this moves stock by the same
      // RPC. `inventoryKeys.balances` is a PREFIX match, so it also covers
      // `countKeys.sheet`, and refused lines redraw against the quantities
      // actually there now rather than the ones the plan was built on.
      qc.invalidateQueries({ queryKey: inventoryKeys.balances })
      for (const line of result.results) {
        if (line.delta !== 0) {
          qc.invalidateQueries({ queryKey: inventoryKeys.byProduct(line.productId) })
        }
      }
      qc.invalidateQueries({ queryKey: ['products'] })
      // An upward count at a racked warehouse ROOT raises putaway tasks, exactly
      // as a found-stock adjustment does.
      qc.invalidateQueries({ queryKey: putawayKeys.all })
      qc.invalidateQueries({ queryKey: putawayKeys.counts })
    },
  })
}
