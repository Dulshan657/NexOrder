import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  getWarehouseLocations,
  createWarehouseLocation,
  updateWarehouseLocation,
  deactivateWarehouseLocation,
  type CreateLocationInput,
  type UpdateLocationInput,
} from '@/services/supabase/warehouseLocationService'

export const warehouseLocationKeys = {
  byWarehouse: (id: number) => ['warehouse-locations', id] as const,
}

export function useWarehouseLocations(warehouseId: number | null) {
  return useQuery({
    queryKey: warehouseLocationKeys.byWarehouse(warehouseId ?? 0),
    queryFn: () => getWarehouseLocations(warehouseId as number),
    enabled: warehouseId != null,
  })
}

export function useCreateWarehouseLocation(warehouseId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateLocationInput) => createWarehouseLocation(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: warehouseLocationKeys.byWarehouse(warehouseId) }),
  })
}

export function useUpdateWarehouseLocation(warehouseId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, updates }: { id: number; updates: UpdateLocationInput }) =>
      updateWarehouseLocation(id, updates),
    onSuccess: () => qc.invalidateQueries({ queryKey: warehouseLocationKeys.byWarehouse(warehouseId) }),
  })
}

export function useDeactivateWarehouseLocation(warehouseId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => deactivateWarehouseLocation(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: warehouseLocationKeys.byWarehouse(warehouseId) }),
  })
}
