import { supabase } from '@/lib/supabase'
import type { Database } from '@/lib/database.types'

type SettingsUpdate = Database['public']['Tables']['app_settings']['Update']

/**
 * Retrieve the single application settings row (id = 1).
 * The settings table is expected to always have exactly one row.
 */
export async function getSettings() {
  const { data, error } = await supabase
    .from('app_settings')
    .select('*')
    .eq('id', 1)
    .maybeSingle()
  if (error) throw error
  return data
}

export async function updateSettings(updates: SettingsUpdate) {
  const { data, error } = await supabase
    .from('app_settings')
    .update(updates)
    .eq('id', 1)
    .select()
    .single()
  if (error) throw error
  return data
}
