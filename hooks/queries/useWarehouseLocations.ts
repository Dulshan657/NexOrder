import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  getWarehouseLocations,
  createWarehouseLocation,
  updateWarehouseLocation,
  deactivateWarehouseLocation,
  renameArea,
  renameRack,
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

// ── Friendly names (mig 00094) ───────────────────────────────────────────────

/**
 * Rename an area and cascade to the bins inside it.
 *
 * Invalidates the LAYOUT detail as well as the locations: the area's own label
 * lives in `layout_objects.meta`, so the map would keep drawing the old name
 * over correctly-renamed bins.
 */
export function useRenameArea(warehouseId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (args: Omit<Parameters<typeof renameArea>[0], 'warehouseId'>) =>
      renameArea({ ...args, warehouseId }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: warehouseLocationKeys.byWarehouse(warehouseId) })
      qc.invalidateQueries({ queryKey: ['layout-detail'] })
      qc.invalidateQueries({ queryKey: ['layouts', warehouseId] })
    },
  })
}

/** Rename one rack, optionally restamping its levels in the same round trip. */
export function useRenameRack(warehouseId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, name, includeLevels }: { id: number; name: string; includeLevels?: boolean }) =>
      renameRack(id, name, includeLevels ?? false),
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
