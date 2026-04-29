import { supabase } from '@/lib/supabase'
import type { Database } from '@/lib/database.types'

type HoReCaRow = Database['public']['Tables']['horecas']['Row']
type HoReCaInsert = Database['public']['Tables']['horecas']['Insert']
type HoReCaUpdate = Database['public']['Tables']['horecas']['Update']

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

export async function createHoReCa(horeca: HoReCaInsert, reason?: string): Promise<HoReCaRow> {
  const { data, error } = await supabase.functions.invoke<{ ok: true; horeca: HoReCaRow }>(
    'mutate-horeca',
    { body: { action: 'create', data: horeca, reason } },
  )
  if (error) throw error
  return data!.horeca
}

export async function updateHoReCa(id: number, updates: HoReCaUpdate, reason?: string): Promise<HoReCaRow> {
  const { data, error } = await supabase.functions.invoke<{ ok: true; horeca: HoReCaRow }>(
    'mutate-horeca',
    { body: { action: 'update', id, data: updates, reason } },
  )
  if (error) throw error
  return data!.horeca
}

export async function deleteHoReCa(id: number, reason?: string): Promise<void> {
  const { error } = await supabase.functions.invoke<{ ok: true }>(
    'mutate-horeca',
    { body: { action: 'delete', id, reason } },
  )
  if (error) throw error
}

export async function markHoReCaReviewed(id: number, reviewerUuid: string) {
  const { data, error } = await supabase
    .from('horecas')
    .update({
      reviewed_at: new Date().toISOString(),
      reviewed_by: reviewerUuid,
      is_temporary: false,
    })
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return data
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
