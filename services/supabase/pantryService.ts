import { supabase } from '@/lib/supabase'
import type { Database } from '@/lib/database.types'

type PantryItemInsert = Database['public']['Tables']['pantry_items']['Insert']
type PantryItemRow = Database['public']['Tables']['pantry_items']['Row']

export async function getPantryItems(horecaId: number) {
  const { data, error } = await supabase
    .from('pantry_items')
    .select('*, products(name, unit, image_url)')
    .eq('horeca_id', horecaId)
    .order('product_id')
  if (error) throw error
  return data
}

export async function upsertPantryItem(item: PantryItemInsert): Promise<PantryItemRow> {
  const { data, error } = await supabase.functions.invoke<PantryItemRow>(
    'mutate-pantry-item',
    {
      body: {
        action: 'upsert',
        data: {
          horeca_id: item.horeca_id,
          product_id: item.product_id,
          preferred_pack_size: item.preferred_pack_size ?? null,
          default_quantity: item.default_quantity,
        },
      },
    }
  )
  if (error) throw error
  return data as PantryItemRow
}

export async function deletePantryItem(horecaId: number, productId: number): Promise<void> {
  const { error } = await supabase.functions.invoke<{ ok: true }>(
    'mutate-pantry-item',
    { body: { action: 'delete', horeca_id: horecaId, product_id: productId } }
  )
  if (error) throw error
}
