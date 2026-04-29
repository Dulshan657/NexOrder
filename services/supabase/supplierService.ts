import { supabase } from '@/lib/supabase'
import type { Database } from '@/lib/database.types'

type SupplierInsert = Database['public']['Tables']['suppliers']['Insert']
type SupplierUpdate = Database['public']['Tables']['suppliers']['Update']
type SupplierRow = Database['public']['Tables']['suppliers']['Row']

export async function getSuppliers() {
  const { data, error } = await supabase
    .from('suppliers')
    .select('*')
    .order('name')
  if (error) throw error
  return data
}

export async function createSupplier(supplier: SupplierInsert): Promise<SupplierRow> {
  const { data, error } = await supabase.functions.invoke<SupplierRow>(
    'mutate-supplier',
    { body: { action: 'create', data: supplier } }
  )
  if (error) throw error
  return data as SupplierRow
}

export async function updateSupplier(id: number, updates: SupplierUpdate): Promise<SupplierRow> {
  const { data, error } = await supabase.functions.invoke<SupplierRow>(
    'mutate-supplier',
    { body: { action: 'update', id, data: updates } }
  )
  if (error) throw error
  return data as SupplierRow
}

export async function deleteSupplier(id: number): Promise<void> {
  const { error } = await supabase.functions.invoke<{ ok: true }>(
    'mutate-supplier',
    { body: { action: 'delete', id } }
  )
  if (error) throw error
}
