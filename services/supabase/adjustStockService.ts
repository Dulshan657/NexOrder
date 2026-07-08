import { supabase } from '@/lib/supabase'
import { extractFunctionErrorMessage } from '@/lib/functionError'
import type { AdjustStockPayload } from '@/lib/stockAdjustment'

export interface AdjustStockResult {
  productId: number
  locationId: number
  batchId: number | null
  movementType: 'adjustment' | 'stocktake_variance'
  qtyDelta: number
  beforeOnHand: number
  beforeAllocated: number
  afterOnHand: number
  afterAllocated: number
}

interface AdjustStockRpcResult {
  product_id: number
  location_id: number
  batch_id: number | null
  movement_type: 'adjustment' | 'stocktake_variance'
  qty_delta: number
  before_on_hand: number
  before_allocated: number
  after_on_hand: number
  after_allocated: number
}

// Records a stock adjustment (shrinkage/damage/found-stock or a stocktake
// variance) via the adjust-stock Edge Function, which calls the
// inv_adjust_stock RPC. See lib/stockAdjustment.ts for building the payload
// (delta vs set_count) and mapping ADJUSTMENT_BELOW_ALLOCATED to a friendly
// message.
export async function adjustStock(input: AdjustStockPayload): Promise<AdjustStockResult> {
  const { data, error } = await supabase.functions.invoke<{ ok: true; result: AdjustStockRpcResult }>(
    'adjust-stock',
    { body: input },
  )
  if (error) {
    throw new Error(await extractFunctionErrorMessage(error, 'Stock adjustment failed'))
  }
  if (!data?.result) throw new Error('Stock adjustment returned no data')

  const r = data.result
  return {
    productId: r.product_id,
    locationId: r.location_id,
    batchId: r.batch_id ?? null,
    movementType: r.movement_type,
    qtyDelta: Number(r.qty_delta),
    beforeOnHand: Number(r.before_on_hand),
    beforeAllocated: Number(r.before_allocated),
    afterOnHand: Number(r.after_on_hand),
    afterAllocated: Number(r.after_allocated),
  }
}
