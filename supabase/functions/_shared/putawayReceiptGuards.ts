// Guards for a putaway request that names a goods receipt (NX-0032).
//
// recommend-putaway takes an optional goods_receipt_id, and the receive screen's
// Retry now sends one. Two things follow from that:
//
//   - The receipt must be one that landed in the warehouse the request names.
//     Otherwise a caller could file tasks in its own warehouse's queue against
//     another site's receipt, and the plate check (putawayPlateOwnership.ts)
//     would only prove the plates belong to THAT receipt.
//   - A Retry must not run twice. The first attempt may have worked after all (a
//     lost response, a second tab), and generatePutawayTasks has no idea which
//     tasks already exist, so a second run would queue the same stock again. A
//     receipt that still has tasks on their way to a bin is answered with a
//     CONFLICT carrying a stable reason, which the receive screen reads as
//     "done", not as an error.
//
// The queue's Re-run also names a receipt, and the row it replaces is itself an
// open task of that receipt, so the open-task check is skipped when
// replaces_recommendation_id is set. A dry run creates nothing, so it skips it
// too. Both still get the warehouse check.

import { type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.103.0'
import { EdgeFunctionError } from './errors.ts'

export const PUTAWAY_TASKS_EXIST_MESSAGE = 'Putaway tasks already exist for this receipt.'
/** Carried in the CONFLICT's `details`, for callers that must branch on it. */
export const PUTAWAY_TASKS_EXIST_REASON = 'putaway_tasks_exist'

/** Statuses of a task that still has stock on its way to a bin. */
const OPEN_STATUSES = ['suggested', 'assigned']

export interface ReceiptRequest {
  warehouseId: number
  goodsReceiptId?: number
  replacesRecommendationId?: number
  dryRun?: boolean
}

export async function assertReceiptRequestAllowed(
  admin: SupabaseClient,
  req: ReceiptRequest,
): Promise<void> {
  const { warehouseId, goodsReceiptId, replacesRecommendationId, dryRun } = req
  if (goodsReceiptId === undefined) return

  const { data: receipt, error: rErr } = await admin.from('goods_receipts')
    .select('id, location_id')
    .eq('id', goodsReceiptId)
    .maybeSingle()
  if (rErr) {
    console.error(`[putawayReceiptGuards] goods_receipts ${goodsReceiptId}: ${rErr.message}`)
    throw new EdgeFunctionError('INTERNAL', 'Could not check the receipt, try again.')
  }
  if (!receipt || Number((receipt as { location_id: number }).location_id) !== warehouseId) {
    throw new EdgeFunctionError('INVALID_INPUT', `Receipt ${goodsReceiptId} is not a receipt of this warehouse`)
  }

  if (replacesRecommendationId !== undefined || dryRun) return

  const { data: open, error: oErr } = await admin.from('wie_putaway_recommendations')
    .select('id')
    .eq('goods_receipt_id', goodsReceiptId)
    .in('status', OPEN_STATUSES)
    .limit(1)
  if (oErr) {
    console.error(`[putawayReceiptGuards] open tasks of receipt ${goodsReceiptId}: ${oErr.message}`)
    throw new EdgeFunctionError('INTERNAL', 'Could not check the receipt, try again.')
  }
  if (((open ?? []) as unknown[]).length > 0) {
    throw new EdgeFunctionError('CONFLICT', PUTAWAY_TASKS_EXIST_MESSAGE, { reason: PUTAWAY_TASKS_EXIST_REASON })
  }
}
