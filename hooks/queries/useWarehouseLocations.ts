import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  bindZones,
  getWarehouseLocations,
  createWarehouseLocation,
  updateWarehouseLocation,
  deactivateWarehouseLocation,
  paintAreas,
  renameArea,
  renameRack,
  type CreateLocationInput,
  type PaintAreasArgs,
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

// ── Live area painting (mig 00095) ───────────────────────────────────────────

/**
 * Replace every named area on a live site, optionally cascading the bin names.
 *
 * Invalidates the same three keys as useRenameArea, and for the same reason: the
 * area's own geometry and label live in `layout_objects`, so the map would keep
 * drawing the old picture over correctly-renamed bins.
 */
export function usePaintAreas(warehouseId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (args: Omit<PaintAreasArgs, 'warehouseId'>) => paintAreas({ ...args, warehouseId }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: warehouseLocationKeys.byWarehouse(warehouseId) })
      qc.invalidateQueries({ queryKey: ['layout-detail'] })
      qc.invalidateQueries({ queryKey: ['layouts', warehouseId] })
    },
  })
}

// ── Zone binding (mig 00096) ─────────────────────────────────────────────────

/**
 * Bind every drawn bin to the ZONE its area names.
 *
 * Invalidates the locations (their parent and path just changed, which is what
 * the tree renders from) AND the layout keys — the map derives its zone washes
 * from the bins' ancestry, so a site that just gained zones draws them for the
 * first time and a stale layout would keep drawing none.
 */
export function useBindZones(warehouseId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => bindZones(warehouseId),
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
