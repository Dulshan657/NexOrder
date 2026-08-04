import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  getLayouts,
  getLayoutDetail,
  createLayout,
  updateLayout,
  cloneLayout,
  archiveLayout,
  deleteLayout,
  saveGeometry,
  publishLayout,
  type CreateLayoutInput,
  type UpdateLayoutInput,
  type SavePlacementInput,
  type SaveObjectInput,
} from '@/services/supabase/layoutService'
import { warehouseLocationKeys } from './useWarehouseLocations'

export const layoutKeys = {
  byWarehouse: (warehouseId: number) => ['layouts', warehouseId] as const,
  detail: (layoutId: number) => ['layout-detail', layoutId] as const,
}

export function useLayouts(warehouseId: number | null) {
  return useQuery({
    queryKey: layoutKeys.byWarehouse(warehouseId ?? 0),
    queryFn: () => getLayouts(warehouseId as number),
    enabled: warehouseId != null,
  })
}

export function useLayoutDetail(layoutId: number | null) {
  return useQuery({
    queryKey: layoutKeys.detail(layoutId ?? 0),
    queryFn: () => getLayoutDetail(layoutId as number),
    enabled: layoutId != null,
  })
}

export function useCreateLayout(warehouseId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateLayoutInput) => createLayout(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: layoutKeys.byWarehouse(warehouseId) }),
  })
}

/** A rescale moves layout_placements / layout_objects rows, so the DETAIL cache
 *  is as stale as the list — invalidate both or the canvas keeps drawing the
 *  pre-rescale geometry on the post-rescale grid. */
export function useUpdateLayout(warehouseId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: UpdateLayoutInput) => updateLayout(input),
    onSuccess: (_layout, input) => {
      qc.invalidateQueries({ queryKey: layoutKeys.byWarehouse(warehouseId) })
      qc.invalidateQueries({ queryKey: layoutKeys.detail(input.layout_id) })
    },
  })
}

export function useCloneLayout(warehouseId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ layoutId, name }: { layoutId: number; name: string }) => cloneLayout(layoutId, name),
    onSuccess: () => qc.invalidateQueries({ queryKey: layoutKeys.byWarehouse(warehouseId) }),
  })
}

export function useArchiveLayout(warehouseId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (layoutId: number) => archiveLayout(layoutId),
    onSuccess: () => qc.invalidateQueries({ queryKey: layoutKeys.byWarehouse(warehouseId) }),
  })
}

export function useDeleteLayout(warehouseId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (layoutId: number) => deleteLayout(layoutId),
    onSuccess: () => qc.invalidateQueries({ queryKey: layoutKeys.byWarehouse(warehouseId) }),
  })
}

export function useSaveGeometry(layoutId: number, warehouseId?: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ placements, objects, areaRenames }: {
      placements: SavePlacementInput[]
      objects: SaveObjectInput[]
      areaRenames?: ReadonlyArray<{ from: string; to: string }>
    }) => saveGeometry(layoutId, placements, objects, areaRenames ?? []),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: layoutKeys.detail(layoutId) })
      // A save can now rewrite `locations.name` (mig 00094 — an area rename
      // cascades to every auto-named bin inside it), and the designer reads
      // names from the LOCATIONS query, not the layout detail. Without this the
      // renamed bins keep their old names until a hard reload.
      if (warehouseId) {
        qc.invalidateQueries({ queryKey: warehouseLocationKeys.byWarehouse(warehouseId) })
      }
    },
  })
}

export function usePublishLayout(warehouseId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (layoutId: number) => publishLayout(layoutId),
    onSuccess: () => qc.invalidateQueries({ queryKey: layoutKeys.byWarehouse(warehouseId) }),
  })
}
