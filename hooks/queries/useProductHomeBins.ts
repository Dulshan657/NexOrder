import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  getProductHomeBins,
  setProductHomeBin,
  clearProductHomeBin,
  type HomeBinReplenInput,
} from '@/services/supabase/productHomeBinService'

export const productHomeBinKeys = {
  byProduct: (id: number) => ['product-home-bins', id] as const,
}

export function useProductHomeBins(productId: number | null) {
  return useQuery({
    queryKey: productHomeBinKeys.byProduct(productId ?? 0),
    queryFn: () => getProductHomeBins(productId as number),
    enabled: productId != null,
  })
}

export function useSetProductHomeBin(productId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ warehouseId, binId, replen }: { warehouseId: number; binId: number; replen?: HomeBinReplenInput }) =>
      setProductHomeBin(productId, warehouseId, binId, replen),
    onSuccess: () => qc.invalidateQueries({ queryKey: productHomeBinKeys.byProduct(productId) }),
  })
}

export function useClearProductHomeBin(productId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (warehouseId: number) => clearProductHomeBin(productId, warehouseId),
    onSuccess: () => qc.invalidateQueries({ queryKey: productHomeBinKeys.byProduct(productId) }),
  })
}
