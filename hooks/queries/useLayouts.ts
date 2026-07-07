import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  getLayouts,
  getLayoutDetail,
  createLayout,
  cloneLayout,
  archiveLayout,
  deleteLayout,
  saveGeometry,
  publishLayout,
  type CreateLayoutInput,
  type SavePlacementInput,
  type SaveObjectInput,
} from '@/services/supabase/layoutService'

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

export function useSaveGeometry(layoutId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ placements, objects }: { placements: SavePlacementInput[]; objects: SaveObjectInput[] }) =>
      saveGeometry(layoutId, placements, objects),
    onSuccess: () => qc.invalidateQueries({ queryKey: layoutKeys.detail(layoutId) }),
  })
}

export function usePublishLayout(warehouseId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (layoutId: number) => publishLayout(layoutId),
    onSuccess: () => qc.invalidateQueries({ queryKey: layoutKeys.byWarehouse(warehouseId) }),
  })
}
