import { supabase } from '@/lib/supabase'
import type { Database } from '@/lib/database.types'

type SettingsRow = Database['public']['Tables']['app_settings']['Row']
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

export async function updateSettings(updates: SettingsUpdate): Promise<SettingsRow> {
  const { data, error } = await supabase.functions.invoke<{ ok: true; settings: SettingsRow }>(
    'mutate-app-settings',
    { body: { action: 'update', data: updates } },
  )
  if (error) throw error
  return data!.settings
}
