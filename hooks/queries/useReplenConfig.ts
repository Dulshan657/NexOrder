import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  bulkSetHomeBins,
  getReplenConfig,
  type BulkHomeBinRow,
} from '@/services/supabase/replenConfigService'
import { detectReplenishment } from '@/services/supabase/replenService'
import { replenKeys } from '@/hooks/queries/useReplenishment'
import { productHomeBinKeys } from '@/hooks/queries/useProductHomeBins'
import { warehouseSetupKeys } from '@/hooks/queries/useWarehouseSetup'

export const replenConfigKeys = {
  all: ['replenConfig'] as const,
  warehouse: (warehouseId: number | null) => ['replenConfig', warehouseId] as const,
}

/** The whole grid for one warehouse. */
export function useReplenConfig(warehouseId: number | null, enabled = true) {
  return useQuery({
    queryKey: replenConfigKeys.warehouse(warehouseId),
    queryFn: () => getReplenConfig(warehouseId as number),
    enabled: enabled && warehouseId != null,
    staleTime: 30_000,
  })
}

export interface BulkSetInput {
  warehouseId: number
  rows: BulkHomeBinRow[]
  /** Omit to leave replen_enabled alone; true arms the batch, false disarms it. */
  replenEnabled?: boolean
}

export function useBulkSetHomeBins() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ warehouseId, rows, replenEnabled }: BulkSetInput) =>
      bulkSetHomeBins(warehouseId, rows, replenEnabled),
    onSuccess: (_result, variables) => {
      qc.invalidateQueries({ queryKey: replenConfigKeys.warehouse(variables.warehouseId) })
      // A slot's min/max is also what ProductHomeBinsSection shows on the product
      // form, what the replenishment queue is generated from, and the evidence
      // behind the warehouse setup checklist's `replen_min_max` step. All three
      // are now stale.
      qc.invalidateQueries({ queryKey: productHomeBinKeys.all })
      qc.invalidateQueries({ queryKey: replenKeys.all })
      qc.invalidateQueries({ queryKey: warehouseSetupKeys.all })
    },
  })
}

/** Count what arming would put in the queue, without writing anything. */
export function useReplenDryRun() {
  return useMutation({
    mutationFn: ({ warehouseId }: { warehouseId: number }) =>
      detectReplenishment(warehouseId, undefined, true),
  })
}
