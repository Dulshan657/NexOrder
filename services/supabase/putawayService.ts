import { supabase } from '@/lib/supabase'
import type { PutawayLineRecommendation } from '@/types'

export interface PutawayLineInput {
  product_id: number
  quantity: number
}

export type PutawayResponse =
  | { mode: 'legacy' }
  | { mode: 'engine'; layoutId: number; recommendations: PutawayLineRecommendation[] }

/** Ask the engine for putaway recommendations for freshly-received lines. A
 *  warehouse without a published layout returns { mode: 'legacy' } and the caller
 *  keeps today's home-bin behavior. */
export async function recommendPutaway(
  warehouseId: number,
  lines: PutawayLineInput[],
  goodsReceiptId?: number,
  dryRun?: boolean,
  /** Re-run: the pending recommendation these lines replace. The server expires
   *  it in the same request, so the queue never shows two live rows for the
   *  same stock. */
  replacesRecommendationId?: number,
): Promise<PutawayResponse> {
  const { data, error } = await supabase.functions.invoke<{
    ok: true
    mode: 'legacy' | 'engine'
    layout_id?: number
    recommendations?: PutawayLineRecommendation[]
  }>('recommend-putaway', {
    body: {
      warehouse_id: warehouseId,
      lines,
      goods_receipt_id: goodsReceiptId,
      dry_run: dryRun,
      replaces_recommendation_id: replacesRecommendationId,
    },
  })
  if (error) throw error
  if (!data || data.mode === 'legacy') return { mode: 'legacy' }
  return { mode: 'engine', layoutId: data.layout_id!, recommendations: data.recommendations ?? [] }
}

export interface DecidePutawayInput {
  recommendationId: number
  decision: 'accept' | 'override'
  chosenLocationId?: number
  /** Base units to put away. Omitted = the whole remaining quantity; anything
   *  less leaves the remainder queued (mig 00071). */
  quantity?: number
  /** Place into a level whose role this SKU isn't allowed on (mig 00072).
   *  The hard never-mix rule can wedge the queue when every compatible level is
   *  full; this is the operator's escape hatch, and the server audits it. */
  roleOverride?: boolean
}

export interface DecidePutawayResult {
  /** Base units still queued on the original recommendation after a partial. */
  remainderQty: number
}

export async function decidePutaway(input: DecidePutawayInput): Promise<DecidePutawayResult> {
  const { data, error } = await supabase.functions.invoke<{
    ok: true
    remainder_qty?: number
  }>('decide-putaway', {
    body: {
      recommendation_id: input.recommendationId,
      decision: input.decision,
      chosen_location_id: input.chosenLocationId,
      quantity: input.quantity,
      role_override: input.roleOverride,
    },
  })
  if (error) throw error
  return { remainderQty: Number(data?.remainder_qty ?? 0) }
}
