import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
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

export function useUpdateProduct() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, updates }: { id: number; updates: ProductUpdate }) =>
      updateProduct(id, updates),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: productKeys.all })
    },
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
