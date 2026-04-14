import { supabase } from '@/lib/supabase'
import type { Database } from '@/lib/database.types'

type HoReCaInsert = Database['public']['Tables']['horecas']['Insert']
type HoReCaUpdate = Database['public']['Tables']['horecas']['Update']
type HoReCaPricingInsert = Database['public']['Tables']['horeca_pricing']['Insert']

export async function getHoReCas() {
  const { data, error } = await supabase
    .from('horecas')
    .select('*, horeca_pricing(*), horeca_payment_methods(*)')
    .order('name')
  if (error) throw error
  return data
}

export async function getHoReCaById(id: number) {
  const { data, error } = await supabase
    .from('horecas')
    .select('*, horeca_pricing(*), horeca_payment_methods(*)')
    .eq('id', id)
    .single()
  if (error) throw error
  return data
}

export async function createHoReCa(horeca: HoReCaInsert) {
  const { data, error } = await supabase
    .from('horecas')
    .insert(horeca)
    .select()
    .single()
  if (error) throw error
  return data
}

export async function updateHoReCa(id: number, updates: HoReCaUpdate) {
  const { data, error } = await supabase
    .from('horecas')
    .update(updates)
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return data
}

export async function deleteHoReCa(id: number) {
  const { error } = await supabase
    .from('horecas')
    .delete()
    .eq('id', id)
  if (error) throw error
}

export async function upsertHoReCaPricing(
  horecaId: number,
  productId: number,
  customPrice: number
) {
  const { data, error } = await supabase
    .from('horeca_pricing')
    .upsert(
      { horeca_id: horecaId, product_id: productId, custom_price: customPrice },
      { onConflict: 'horeca_id,product_id' }
    )
    .select()
    .single()
  if (error) throw error
  return data
}

export async function deleteHoReCaPricing(horecaId: number, productId: number) {
  const { error } = await supabase
    .from('horeca_pricing')
    .delete()
    .eq('horeca_id', horecaId)
    .eq('product_id', productId)
  if (error) throw error
}
