import { supabase } from '@/lib/supabase'
import type { Database } from '@/lib/database.types'

type PantryItemInsert = Database['public']['Tables']['pantry_items']['Insert']

export async function getPantryItems(horecaId: number) {
  const { data, error } = await supabase
    .from('pantry_items')
    .select('*, products(name, unit, image_url)')
    .eq('horeca_id', horecaId)
    .order('product_id')
  if (error) throw error
  return data
}

export async function upsertPantryItem(item: PantryItemInsert) {
  const { data, error } = await supabase
    .from('pantry_items')
    .upsert(item, { onConflict: 'horeca_id,product_id' })
    .select()
    .single()
  if (error) throw error
  return data
}

export async function deletePantryItem(horecaId: number, productId: number) {
  const { error } = await supabase
    .from('pantry_items')
    .delete()
    .eq('horeca_id', horecaId)
    .eq('product_id', productId)
  if (error) throw error
}
