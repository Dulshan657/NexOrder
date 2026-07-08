import { supabase } from '@/lib/supabase'
import { extractFunctionErrorMessage } from '@/lib/functionError'
import type { Database } from '@/lib/database.types'

type ProductRow = Database['public']['Tables']['products']['Row']
type ProductInsert = Database['public']['Tables']['products']['Insert']
type ProductUpdate = Database['public']['Tables']['products']['Update']

// The pinned-FK embed (suppliers!..fkey) can't be inferred from the generated
// types (empty Relationships[]), so PostgREST types it as SelectQueryError.
// Re-assert the real runtime shape that the `toProduct` adapter expects.
type ProductRowWithSupplier = ProductRow & { suppliers: { name: string } | null }

export async function getProducts() {
  const { data, error } = await supabase
    .from('products')
    // products now has two FKs to suppliers (supplier_id + preferred_supplier_id),
    // so the embed must pin the relationship or PostgREST errors with PGRST201.
    .select('*, suppliers!products_supplier_id_fkey(name)')
    .order('name')
  if (error) throw error
  return (data ?? []) as unknown as ProductRowWithSupplier[]
}

export async function getProductById(id: number) {
  const { data, error } = await supabase
    .from('products')
    .select('*, suppliers!products_supplier_id_fkey(name)')
    .eq('id', id)
    .single()
  if (error) throw error
  return data as unknown as ProductRowWithSupplier
}

export async function createProduct(product: ProductInsert): Promise<ProductRow> {
  const { data, error } = await supabase.functions.invoke<{ ok: true; product: ProductRow }>(
    'mutate-product',
    { body: { action: 'create', data: product } },
  )
  if (error) throw new Error(await extractFunctionErrorMessage(error, 'Failed to create product'))
  return data!.product
}

export async function updateProduct(id: number, updates: ProductUpdate): Promise<ProductRow> {
  const { data, error } = await supabase.functions.invoke<{ ok: true; product: ProductRow }>(
    'mutate-product',
    { body: { action: 'update', id, data: updates } },
  )
  if (error) throw new Error(await extractFunctionErrorMessage(error, 'Failed to update product'))
  return data!.product
}

export async function deleteProduct(id: number): Promise<void> {
  const { error } = await supabase.functions.invoke<{ ok: true }>(
    'mutate-product',
    { body: { action: 'delete', id } },
  )
  if (error) throw new Error(await extractFunctionErrorMessage(error, 'Failed to delete product'))
}
