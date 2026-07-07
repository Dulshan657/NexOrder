import { supabase } from '@/lib/supabase'
import type { PutawayExplanation } from '@/types'

/** Lightweight view of a pending putaway recommendation for the queue UI. */
export interface PendingPutawayRow {
  id: number
  productId: number
  quantity: number
  recommendedLocationId: number | null
  explanation: PutawayExplanation
}

/** Pending (status 'suggested') putaway recommendations for a warehouse, newest first. */
export async function getPendingPutaways(warehouseId: number): Promise<PendingPutawayRow[]> {
  const { data, error } = await supabase
    .from('wie_putaway_recommendations')
    .select('*')
    .eq('warehouse_id', warehouseId)
    .eq('status', 'suggested')
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []).map((row: any) => ({
    id: row.id,
    productId: row.product_id,
    quantity: row.quantity,
    recommendedLocationId: row.recommended_location_id ?? null,
    explanation: row.explanation as PutawayExplanation,
  }))
}
