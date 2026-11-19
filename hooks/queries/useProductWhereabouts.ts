import { useQuery } from '@tanstack/react-query'
import { explainProductLocation, type ProductWhereabouts } from '@/services/supabase/productWhereaboutsService'

/** Where one product lives at one warehouse, and the walks to it (NX-0039). */
export function useProductWhereabouts(warehouseId: number | null, productId: number | null) {
  return useQuery<ProductWhereabouts>({
    queryKey: ['product-whereabouts', warehouseId, productId],
    enabled: warehouseId != null && productId != null,
    queryFn: () => explainProductLocation(warehouseId as number, productId as number),
    staleTime: 30_000,
  })
}
