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

// One row's outcome from a bulk-create invoke, mirrored from
// supabase/functions/_shared/productBulk.ts `BulkCreateResult` — kept as a
// separate type here (rather than imported) since client code can't import
// across the `supabase/functions/` boundary.
export interface BulkRowOutcome {
  index: number
  ok: boolean
  id?: number
  sku: string
  error?: string
  code?: string
}

// mutate-product's `bulk-create` action caps a single invoke at 100 rows
// (see the zod schema in supabase/functions/mutate-product/index.ts), so
// larger imports are chunked client-side. Each chunk's `results` come back
// with chunk-local indices (0-based per invoke) — remap them to the row's
// position in the original `rows` array so callers can zip results back to
// what they submitted regardless of chunk size.
const BULK_CREATE_CHUNK_SIZE = 100

export async function bulkCreateProducts(
  rows: Record<string, unknown>[],
): Promise<BulkRowOutcome[]> {
  const allResults: BulkRowOutcome[] = []

  for (let chunkStart = 0; chunkStart < rows.length; chunkStart += BULK_CREATE_CHUNK_SIZE) {
    const chunk = rows.slice(chunkStart, chunkStart + BULK_CREATE_CHUNK_SIZE)

    // A transport error on THIS chunk must not discard results from chunks
    // that already succeeded (rows already created in the DB). Catch per
    // chunk and synthesize failed outcomes for its rows instead of throwing,
    // so the caller gets a complete, index-aligned array covering every
    // input row and can retry just the failed ones instead of blindly
    // re-submitting the whole file (which would re-create the rows that
    // already landed).
    try {
      const { data, error } = await supabase.functions.invoke<{ ok: true; results: BulkRowOutcome[] }>(
        'mutate-product',
        { body: { action: 'bulk-create', data: chunk } },
      )
      if (error) throw new Error(await extractFunctionErrorMessage(error, 'Bulk product import failed'))

      const chunkResults = (data?.results ?? []).map(result => ({
        ...result,
        index: chunkStart + result.index,
      }))
      allResults.push(...chunkResults)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Bulk product import failed for this batch.'
      chunk.forEach((row, localIndex) => {
        allResults.push({
          index: chunkStart + localIndex,
          ok: false,
          sku: String(row.sku ?? ''),
          error: message,
          code: 'REQUEST_FAILED',
        })
      })
    }
  }

  return allResults
}
