import { supabase } from '@/lib/supabase'
import type { Database } from '@/lib/database.types'

type PromotionRow = Database['public']['Tables']['promotions']['Row']
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

export async function createPromotion(promo: PromotionInsert): Promise<PromotionRow> {
  const { data, error } = await supabase.functions.invoke<{ ok: true; promotion: PromotionRow }>(
    'mutate-promotion',
    { body: { action: 'create', data: promo } },
  )
  if (error) throw error
  return data!.promotion
}

export async function updatePromotion(id: string, updates: PromotionUpdate): Promise<PromotionRow> {
  const { data, error } = await supabase.functions.invoke<{ ok: true; promotion: PromotionRow }>(
    'mutate-promotion',
    { body: { action: 'update', id, data: updates } },
  )
  if (error) throw error
  return data!.promotion
}

export async function deletePromotion(id: string): Promise<void> {
  const { error } = await supabase.functions.invoke<{ ok: true }>(
    'mutate-promotion',
    { body: { action: 'delete', id } },
  )
  if (error) throw error
}
