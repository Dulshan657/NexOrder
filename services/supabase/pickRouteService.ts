import { supabase } from '@/lib/supabase'
import type { PickRoute } from '@/types'

export type PickRouteResult =
  | { mode: 'legacy' }
  | { mode: 'engine'; route: PickRoute }

// Ask the engine for a suggested pick walk order for one or more orders at a
// warehouse. Warehouses without a published layout return mode 'legacy' (no
// route) — callers should treat that as "no routing available".
export async function getPickRoute(
  warehouseId: number,
  orderIds: string[],
): Promise<PickRouteResult> {
  const { data, error } = await supabase.functions.invoke<
    | { ok: true; mode: 'legacy' }
    | { ok: true; mode: 'engine'; route: PickRoute }
  >('recommend-pick-route', {
    body: { warehouse_id: warehouseId, order_ids: orderIds },
  })
  if (error) throw error
  if (!data) throw new Error('No response from recommend-pick-route')
  if (data.mode === 'legacy') return { mode: 'legacy' }
  return { mode: 'engine', route: data.route }
}
