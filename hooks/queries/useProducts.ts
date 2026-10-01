import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { optimisticUpdate, patchRowById } from '@/lib/optimistic'
import {
  getProducts,
  createProduct,
  updateProduct,
  deleteProduct,
  bulkCreateProducts,
  type BulkRowOutcome,
} from '@/services/supabase/productService'
import type { Database } from '@/lib/database.types'

type ProductInsert = Database['public']['Tables']['products']['Insert']
type ProductUpdate = Database['public']['Tables']['products']['Update']

export const productKeys = {
  all: ['products'] as const,
} as const

export function useProducts() {
  return useQuery({
    queryKey: productKeys.all,
    queryFn: getProducts,
  })
}

export function useCreateProduct() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (product: ProductInsert) => createProduct(product),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: productKeys.all })
    },
  })
}

// Optimistic: a field edit shows at once and rolls back if refused. The
// catalogue is still refetched once settled (stock caches, derived columns).
export function useUpdateProduct() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, updates }: { id: number; updates: ProductUpdate }) =>
      updateProduct(id, updates),
    ...optimisticUpdate<{ id: number; updates: ProductUpdate }>(
      qc, productKeys.all, (data, { id, updates }) =>
        // Supplier links and UOMs are embeds the cached row holds in another
        // shape (with joined supplier names); patching them in would blank
        // those names until the refetch. Leave such edits to the refetch.
        'product_suppliers' in updates || 'uoms' in updates ? data : patchRowById(data, id, updates),
    ),
  })
}

export function useDeleteProduct() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => deleteProduct(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: productKeys.all })
    },
  })
}

export function useBulkCreateProducts() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (rows: Record<string, unknown>[]): Promise<BulkRowOutcome[]> =>
      bulkCreateProducts(rows),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: productKeys.all })
    },
  })
}
