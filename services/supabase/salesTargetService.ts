import { supabase } from '@/lib/supabase'
import type { Database } from '@/lib/database.types'

type SalesTargetInsert = Database['public']['Tables']['sales_targets']['Insert']
type SalesTargetUpdate = Database['public']['Tables']['sales_targets']['Update']
type SalesTargetRow = Database['public']['Tables']['sales_targets']['Row']

export async function getSalesTargets(userId?: string) {
  let query = supabase
    .from('sales_targets')
    .select('*')
    .order('start_date', { ascending: false })

  if (userId !== undefined) {
    query = query.eq('user_id', userId)
  }

  const { data, error } = await query
  if (error) throw error
  return data
}

export async function createSalesTarget(target: SalesTargetInsert): Promise<SalesTargetRow> {
  const { data, error } = await supabase.functions.invoke<SalesTargetRow>(
    'mutate-sales-target',
    { body: { action: 'create', data: target } }
  )
  if (error) throw error
  return data as SalesTargetRow
}

export async function updateSalesTarget(
  id: string,
  updates: SalesTargetUpdate
): Promise<SalesTargetRow> {
  const { data, error } = await supabase.functions.invoke<SalesTargetRow>(
    'mutate-sales-target',
    { body: { action: 'update', id, data: updates } }
  )
  if (error) throw error
  return data as SalesTargetRow
}

export async function deleteSalesTarget(id: string): Promise<void> {
  const { error } = await supabase.functions.invoke<{ ok: true }>(
    'mutate-sales-target',
    { body: { action: 'delete', id } }
  )
  if (error) throw error
}
