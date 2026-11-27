// "Not this product?" (NX-0050): a carton whose label (barcode) says one
// product but holds another.
//
// planWrongProduct is the decision, pure: may this putaway stop be re-recorded
// as the real product, and what are the two stock legs (the label product off
// the warehouse root, the real product on, on the same plate)? The SQL
// transaction wie_report_wrong_product_tx (mig 00152) makes the same checks
// again under its row lock and writes the legs; this copy lets the edge function
// answer in words before it asks, and is what the tests pin down.
//
// recordLabelMismatches writes the mismatch rows and the desk's notification,
// for both entry points (receive-stock and report-wrong-product).

import { type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.103.0'

export interface WrongProductTask {
  id: number
  productId: number
  quantity: number
  warehouseId: number
  handlingUnitId: number | null
  status: string
}

export interface StockLeg {
  productId: number
  /** The warehouse root: un-placed goods sit there until putaway. */
  locationId: number
  delta: number
  handlingUnitId: number | null
}

export type WrongProductPlan =
  | { ok: true; legs: StockLeg[] }
  | { ok: false; code: 'INVALID_INPUT' | 'CONFLICT'; message: string }

export const SAME_PRODUCT = 'That is the same product. Pick what is really in the carton.'
export const BAD_QUANTITY = 'Enter how many there are, as a whole number.'
export const MIXED_PLATE = 'Break this pallet down first.'
export const NOT_OPEN = 'This stop is already done.'

export function planWrongProduct(input: {
  task: WrongProductTask
  realProductId: number
  quantity: number
  /** Products with stock on the task's plate now (empty for a loose line). */
  plateProductIds: readonly number[]
}): WrongProductPlan {
  const { task, realProductId, quantity, plateProductIds } = input
  if (task.status !== 'suggested' && task.status !== 'assigned') {
    return { ok: false, code: 'CONFLICT', message: NOT_OPEN }
  }
  if (realProductId === task.productId) return { ok: false, code: 'INVALID_INPUT', message: SAME_PRODUCT }
  if (!Number.isInteger(quantity) || quantity <= 0) {
    return { ok: false, code: 'INVALID_INPUT', message: BAD_QUANTITY }
  }
  if (new Set(plateProductIds.filter((p) => p !== task.productId)).size > 0) {
    return { ok: false, code: 'CONFLICT', message: MIXED_PLATE }
  }
  return {
    ok: true,
    legs: [
      { productId: task.productId, locationId: task.warehouseId, delta: -task.quantity, handlingUnitId: task.handlingUnitId },
      { productId: realProductId, locationId: task.warehouseId, delta: quantity, handlingUnitId: task.handlingUnitId },
    ],
  }
}

/** What the desk reads in the bell. */
export function mismatchNotice(m: { scannedCode: string; labelSku: string; realSku: string }): string {
  return `Label mismatch: ${m.scannedCode} scanned as ${m.labelSku}, but the carton was ${m.realSku}. Check the barcode.`
}

export interface MismatchRow {
  scannedCode: string
  labelProductId: number
  realProductId: number
  quantity: number
  warehouseId: number
  goodsReceiptId: number | null
  putawayRecId: number | null
  reportedBy: string
}

/**
 * Write the mismatch rows (unless the transaction already did) and one
 * notification to Admin and Manager per row. Throws if a row cannot be written;
 * a notification that cannot be written is logged, not thrown: the row is the
 * record, the bell is a courtesy.
 */
export async function recordLabelMismatches(
  admin: SupabaseClient,
  rows: readonly MismatchRow[],
  opts: { alreadyInserted?: readonly number[]; notHeld?: boolean } = {},
): Promise<number[]> {
  if (rows.length === 0) return []
  let ids = [...(opts.alreadyInserted ?? [])]
  if (ids.length === 0) {
    const { data, error } = await admin.from('label_mismatches').insert(rows.map((r) => ({
      scanned_code: r.scannedCode,
      label_product_id: r.labelProductId,
      real_product_id: r.realProductId,
      quantity: r.quantity,
      warehouse_id: r.warehouseId,
      goods_receipt_id: r.goodsReceiptId,
      putaway_rec_id: r.putawayRecId,
      reported_by: r.reportedBy,
    }))).select('id')
    if (error) throw new Error(`label mismatch record failed: ${error.message}`)
    ids = ((data ?? []) as Array<{ id: number }>).map((d) => Number(d.id))
  }

  const productIds = [...new Set(rows.flatMap((r) => [r.labelProductId, r.realProductId]))]
  const { data: prods } = await admin.from('products').select('id, sku').in('id', productIds)
  const skuOf = new Map(((prods ?? []) as Array<{ id: number; sku: string }>).map((p) => [Number(p.id), p.sku]))
  const stamp = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`
  const notes = rows.map((r, i) => ({
    id: `notif-label_mismatch-${ids[i] ?? i}-${stamp}`,
    type: 'label_mismatch',
    message: mismatchNotice({
      scannedCode: r.scannedCode,
      labelSku: skuOf.get(r.labelProductId) ?? String(r.labelProductId),
      realSku: skuOf.get(r.realProductId) ?? String(r.realProductId),
    }) + (opts.notHeld ? ' It is NOT yet held: plan its putaway to a hold location.' : ''),
    target_roles: ['Admin', 'Manager'],
    user_id: null,
    metadata: { labelMismatchId: ids[i] ?? null, labelProductId: r.labelProductId, realProductId: r.realProductId },
  }))
  const { error: nErr } = await admin.from('notifications').insert(notes)
  if (nErr) console.error(`[labelMismatch] notification insert failed: ${nErr.message}`)
  return ids
}
