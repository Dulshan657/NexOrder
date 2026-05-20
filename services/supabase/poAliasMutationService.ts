// Frontend service wrapping the mutate-po-alias Edge Function.
//
// Customer + product alias create/update/delete. The DB direct-write is
// locked down (no INSERT/UPDATE/DELETE granted to authenticated on
// po_*_aliases), so every mutation must route through this function.

import { supabase } from '@/lib/supabase'

export type CustomerAliasSourceType = 'sender_email' | 'sender_domain' | 'po_text'

export interface CreateCustomerAliasInput {
  source_type: CustomerAliasSourceType
  source_value: string
  horeca_id: number
}

export interface UpdateCustomerAliasInput {
  id: string
  source_type?: CustomerAliasSourceType
  source_value?: string
  horeca_id?: number
}

export interface CreateProductAliasInput {
  horeca_id: number
  source_code?: string | null
  source_description?: string | null
  product_id: number
  default_pack_size?: number | null
}

export interface UpdateProductAliasInput {
  id: string
  horeca_id?: number
  source_code?: string | null
  source_description?: string | null
  product_id?: number
  default_pack_size?: number | null
}

interface EdgeStructuredError {
  error: { code: string; message: string; details?: unknown }
}

function throwOnStructuredError(data: unknown, fallback: string): void {
  if (
    data &&
    typeof data === 'object' &&
    'error' in (data as Record<string, unknown>) &&
    (data as EdgeStructuredError).error
  ) {
    const err = (data as EdgeStructuredError).error
    const msg = err.message || fallback
    const annotated = new Error(msg) as Error & { code?: string; details?: unknown }
    annotated.code = err.code
    annotated.details = err.details
    throw annotated
  }
}

async function invoke(body: Record<string, unknown>, fallback: string): Promise<unknown> {
  const { data, error } = await supabase.functions.invoke('mutate-po-alias', { body })
  if (error) throw new Error(error.message || fallback)
  throwOnStructuredError(data, fallback)
  return data
}

// -----------------------------------------------------------------------
// Customer alias
// -----------------------------------------------------------------------

export async function createCustomerAlias(input: CreateCustomerAliasInput): Promise<void> {
  await invoke(
    { resource: 'customer_alias', action: 'create', ...input },
    'mutate-po-alias create customer_alias failed',
  )
}

export async function updateCustomerAlias(input: UpdateCustomerAliasInput): Promise<void> {
  await invoke(
    { resource: 'customer_alias', action: 'update', ...input },
    'mutate-po-alias update customer_alias failed',
  )
}

export async function deleteCustomerAlias(id: string): Promise<void> {
  await invoke(
    { resource: 'customer_alias', action: 'delete', id },
    'mutate-po-alias delete customer_alias failed',
  )
}

// -----------------------------------------------------------------------
// Product alias
// -----------------------------------------------------------------------

export async function createProductAlias(input: CreateProductAliasInput): Promise<void> {
  await invoke(
    { resource: 'product_alias', action: 'create', ...input },
    'mutate-po-alias create product_alias failed',
  )
}

export async function updateProductAlias(input: UpdateProductAliasInput): Promise<void> {
  await invoke(
    { resource: 'product_alias', action: 'update', ...input },
    'mutate-po-alias update product_alias failed',
  )
}

export async function deleteProductAlias(id: string): Promise<void> {
  await invoke(
    { resource: 'product_alias', action: 'delete', id },
    'mutate-po-alias delete product_alias failed',
  )
}
