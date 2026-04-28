import { supabase } from '@/lib/supabase'
import type { Database } from '@/lib/database.types'

type SalesTargetInsert = Database['public']['Tables']['sales_targets']['Insert']
type SalesTargetUpdate = Database['public']['Tables']['sales_targets']['Update']

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

export async function createSalesTarget(target: SalesTargetInsert) {
  const { data, error } = await supabase
    .from('sales_targets')
    .insert(target)
    .select()
    .single()
  if (error) throw error
  return data
}

export async function updateSalesTarget(
  id: string,
  updates: SalesTargetUpdate
) {
  const { data, error } = await supabase
    .from('sales_targets')
    .update(updates)
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return data
}

export async function deleteSalesTarget(id: string) {
  const { error } = await supabase
    .from('sales_targets')
    .delete()
    .eq('id', id)
  if (error) throw error
}
