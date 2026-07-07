import { supabase } from '@/lib/supabase'
import { toSlottingSuggestion } from '@/lib/adapters'
import type { SlottingSuggestion } from '@/types'

/** Open re-slotting suggestions (status 'suggested') for a warehouse, newest first. */
export async function getSlottingSuggestions(warehouseId: number): Promise<SlottingSuggestion[]> {
  const { data, error } = await supabase
    .from('wie_slotting_suggestions')
    .select('*')
    .eq('warehouse_id', warehouseId)
    .eq('status', 'suggested')
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []).map(toSlottingSuggestion)
}

export async function decideSlotting(suggestionId: number, decision: 'accept' | 'reject'): Promise<void> {
  const { error } = await supabase.functions.invoke<{ ok: true }>('decide-slotting-suggestion', {
    body: { suggestion_id: suggestionId, decision },
  })
  if (error) throw error
}

export interface ReoptimizeResult {
  considered: number
  suggested: number
}

/** Kick off a batch re-optimization pass; returns how many bins were considered
 * and how many new suggestions were produced. */
export async function runReoptimize(warehouseId: number): Promise<ReoptimizeResult> {
  const { data, error } = await supabase.functions.invoke<{ ok: true; considered: number; suggested: number }>(
    'wie-batch-reoptimize',
    { body: { warehouse_id: warehouseId } },
  )
  if (error) throw error
  return { considered: (data as any).considered ?? 0, suggested: (data as any).suggested ?? 0 }
}
