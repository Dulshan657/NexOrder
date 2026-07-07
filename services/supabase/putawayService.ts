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
): Promise<PutawayResponse> {
  const { data, error } = await supabase.functions.invoke<{
    ok: true
    mode: 'legacy' | 'engine'
    layout_id?: number
    recommendations?: PutawayLineRecommendation[]
  }>('recommend-putaway', {
    body: { warehouse_id: warehouseId, lines, goods_receipt_id: goodsReceiptId, dry_run: dryRun },
  })
  if (error) throw error
  if (!data || data.mode === 'legacy') return { mode: 'legacy' }
  return { mode: 'engine', layoutId: data.layout_id!, recommendations: data.recommendations ?? [] }
}

export interface DecidePutawayInput {
  recommendationId: number
  decision: 'accept' | 'override'
  chosenLocationId?: number
}

export async function decidePutaway(input: DecidePutawayInput): Promise<void> {
  const { error } = await supabase.functions.invoke('decide-putaway', {
    body: {
      recommendation_id: input.recommendationId,
      decision: input.decision,
      chosen_location_id: input.chosenLocationId,
    },
  })
  if (error) throw error
}
