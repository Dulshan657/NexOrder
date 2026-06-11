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
      qc.invalidateQueries({ queryKey: ['products'] })
      qc.invalidateQueries({ queryKey: warehouseKeys.all })
    },
  })
}
