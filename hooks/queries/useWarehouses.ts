import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  getWarehouses,
  createWarehouse,
  updateWarehouse,
  deactivateWarehouse,
  transferStock,
  type WarehouseCreateInput,
  type WarehouseUpdateInput,
  type TransferStockInput,
  getWarehouseCodePattern,
  setWarehouseCodePattern,
  type WarehouseCodePattern,
} from '@/services/supabase/warehouseService'
import { putawayKeys } from './putawayKeys'
import { inventoryKeys } from './useInventoryBalances'

export const warehouseKeys = {
  all: ['warehouses'] as const,
} as const

export function useWarehouses() {
  return useQuery({
    queryKey: warehouseKeys.all,
    queryFn: getWarehouses,
  })
}

export function useCreateWarehouse() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: WarehouseCreateInput) => createWarehouse(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: warehouseKeys.all }),
  })
}

export function useUpdateWarehouse() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, updates }: { id: number; updates: WarehouseUpdateInput }) =>
      updateWarehouse(id, updates),
    onSuccess: () => qc.invalidateQueries({ queryKey: warehouseKeys.all }),
  })
}

export function useDeactivateWarehouse() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => deactivateWarehouse(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: warehouseKeys.all }),
  })
}

export function useTransferStock() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: TransferStockInput) => transferStock(input),
    onSuccess: () => {
      // Balances + product caches shift on both sides of the move.
      qc.invalidateQueries({ queryKey: ['inventory'] })
      // The line above is a latent no-op: TanStack Query matches keys by
      // element-wise array prefix, and 'inventory' !== 'inventory_balances',
      // so it has never matched useInventoryBalances/useProductStockByWarehouse.
      // Without this, transfers only refreshed balances via the realtime
      // channel. Keep the line above too, in case something else relies on it.
      qc.invalidateQueries({ queryKey: inventoryKeys.balances })
      qc.invalidateQueries({ queryKey: ['products'] })
      qc.invalidateQueries({ queryKey: warehouseKeys.all })
      // transfer-stock also generates putaway tasks server-side at the
      // destination when it's a racked warehouse's root.
      qc.invalidateQueries({ queryKey: putawayKeys.all })
      qc.invalidateQueries({ queryKey: putawayKeys.counts })
    },
  })
}

// ─────────────────────────────────────── code patterns (migs 00107 / 00108) ──

export const codePatternKeys = {
  one: (warehouseId: number | null) => ['warehouse-code-pattern', warehouseId] as const,
}

/** This site's code pattern. `undefined` while loading, `null` once loaded and
 *  found to have no row — which is the built-in default, not an error. */
export function useWarehouseCodePattern(warehouseId: number | null) {
  return useQuery({
    queryKey: codePatternKeys.one(warehouseId),
    queryFn: () => getWarehouseCodePattern(warehouseId as number),
    enabled: warehouseId != null,
  })
}

export function useSetWarehouseCodePattern(warehouseId: number | null) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (pattern: WarehouseCodePattern | null) =>
      setWarehouseCodePattern({ warehouseId: warehouseId as number, pattern }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: codePatternKeys.one(warehouseId) })
    },
  })
}
