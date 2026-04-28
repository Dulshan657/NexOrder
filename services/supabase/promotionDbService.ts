import { supabase } from '@/lib/supabase'
import type { Database } from '@/lib/database.types'

type PromotionInsert = Database['public']['Tables']['promotions']['Insert']
type PromotionUpdate = Database['public']['Tables']['promotions']['Update']

export async function getPromotions() {
  const { data, error } = await supabase
    .from('promotions')
    .select('*')
    .order('priority')
  if (error) throw error
  return data
}

export async function getActivePromotions() {
  const now = new Date().toISOString()

  // Fetch is_active rows; filter dates in JS so null bounds (no start/no end) work correctly.
  const { data, error } = await supabase
    .from('promotions')
    .select('*')
    .eq('is_active', true)
    .order('priority')
  if (error) throw error
  return (data ?? []).filter(p => {
    const startOk = !p.start_date || p.start_date <= now
    const endOk = !p.end_date || p.end_date >= now
    return startOk && endOk
  })
}

export async function createPromotion(promo: PromotionInsert) {
  const { data, error } = await supabase
    .from('promotions')
    .insert(promo)
    .select()
    .single()
  if (error) throw error
  return data
}

export async function updatePromotion(id: string, updates: PromotionUpdate) {
  const { data, error } = await supabase
    .from('promotions')
    .update(updates)
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return data
}

export async function deletePromotion(id: string) {
  const { error } = await supabase
    .from('promotions')
    .delete()
    .eq('id', id)
  if (error) throw error
}
