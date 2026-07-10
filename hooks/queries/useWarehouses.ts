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
