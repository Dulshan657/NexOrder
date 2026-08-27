import { supabase } from '@/lib/supabase'
import { toProduct } from '@/lib/adapters'
import type { Product, PutawayExplanation } from '@/types'
import type { HuType } from '@/supabase/functions/_shared/wie/capacity'

/** The goods receipt a queued line arrived on, when it was created by a receipt
 *  (adjustments and transfer-ins have none). */
export interface PutawayReceiptRef {
  id: number
  reference: string | null
  receivedDate: string | null
  supplierName: string | null
}

/** A pending putaway recommendation, enriched enough for the queue UI to name
 *  what's on the dock without the caller passing the product catalogue in.
 *  `product` is null only if the join failed or the product was hard-deleted —
 *  the UI falls back to `Product #<id>` for that case. */
export interface PendingPutawayRow {
  id: number
  productId: number
  quantity: number
  recommendedLocationId: number | null
  explanation: PutawayExplanation
  createdAt: string
  product: Product | null
  receipt: PutawayReceiptRef | null
  /** The plate this line is on (mig 00078), when known. Drives the manual bin
   *  picker's capacity unit — a pallet takes ONE position in a pallet bay — and
   *  the plate badge. NULL for every pre-00078 row and for arrival paths that
   *  don't name a plate. */
  huId: number | null
  huType: HuType
  huCode: string | null
  /** Has a sticker for this plate ever been rendered? `generate-labels` flips it
   *  the moment the PDF exists (see confirm-label-print's header for why that is
   *  right for a plate and wrong for a rack).
   *
   *  Load-bearing on the walk: a plate with no label is a database claim and
   *  nothing more, so demanding the operator scan it is demanding the
   *  impossible. `putawayIdentity` reads this to decide what to ask for. */
  huLabelPrinted: boolean
  /** 'open' | 'stored' | 'empty' | 'cancelled' (mig 00075). A task can outlive
   *  its plate — a count or an adjustment at the warehouse root consumes the
   *  balance rows with no plate named, `hu_recompute` marks the plate 'empty',
   *  and nothing touches this task. The stop warns rather than hiding the work. */
  huStatus: string | null
  /** Where the desk sent it, once assigned (mig 00080). NULL while the line is
   *  still `suggested`. Distinct from `recommendedLocationId` (what the engine
   *  said) — an operator can assign somewhere else entirely. */
  assignedLocationId: number | null
  assignedAt: string | null
}

// products is readable by every authenticated user; goods_receipts is readable
// by Admin/Manager/Warehouse (goods_receipts_select_ops, mig 00037) — exactly
// the roles that can open the Putaway tab, so this join never trips RLS here.
const QUEUE_SELECT =
  '*, products(*, product_uoms(*)), goods_receipts(id, reference, received_date, suppliers(name)), handling_units(id, code, hu_type, label_printed, status)'

function toReceiptRef(row: any): PutawayReceiptRef | null {
  if (!row) return null
  return {
    id: row.id,
    reference: row.reference ?? null,
    receivedDate: row.received_date ?? null,
    supplierName: row.suppliers?.name ?? null,
  }
}

function toQueueRow(row: any): PendingPutawayRow {
  return {
    id: row.id,
    productId: row.product_id,
    quantity: Number(row.quantity),
    recommendedLocationId: row.recommended_location_id ?? null,
    explanation: row.explanation as PutawayExplanation,
    createdAt: row.created_at,
    product: row.products ? toProduct(row.products) : null,
    receipt: toReceiptRef(row.goods_receipts),
    huId: row.handling_units?.id ?? null,
    huType: row.handling_units?.hu_type ?? null,
    huCode: row.handling_units?.code ?? null,
    huLabelPrinted: Boolean(row.handling_units?.label_printed),
    huStatus: row.handling_units?.status ?? null,
    assignedLocationId: row.assigned_location_id ?? null,
    assignedAt: row.assigned_at ?? null,
  }
}

/** Pending (status 'suggested') putaway recommendations for a warehouse, newest first. */
export async function getPendingPutaways(warehouseId: number): Promise<PendingPutawayRow[]> {
  const { data, error } = await supabase
    .from('wie_putaway_recommendations')
    .select(QUEUE_SELECT)
    .eq('warehouse_id', warehouseId)
    .eq('status', 'suggested')
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []).map(toQueueRow)
}

/** Assigned tasks — a bin has been decided but nobody has carried the stock
 *  there yet (mig 00080). These are the stops on the Walk run, and the stock
 *  they describe is still sitting at the warehouse root.
 *
 *  Oldest first, the opposite of the Assign queue: this is a work list, and the
 *  thing that has been waiting on the dock longest should be placed first. */
export async function getAssignedPutaways(warehouseId: number): Promise<PendingPutawayRow[]> {
  const { data, error } = await supabase
    .from('wie_putaway_recommendations')
    .select(QUEUE_SELECT)
    .eq('warehouse_id', warehouseId)
    .eq('status', 'assigned')
    .order('created_at', { ascending: true })
  if (error) throw error
  return (data ?? []).map(toQueueRow)
}

/** Outstanding putaway work per warehouse — powers the Putaway picker's smart
 *  default + per-option labels, and the nav badge total.
 *
 *  Counts 'assigned' alongside 'suggested' (mig 00080): a line that has been
 *  sent to the Walk run is still work nobody has done, and the stock is still
 *  sitting on the dock. Counting only 'suggested' would make the badge empty
 *  the moment someone assigned a receipt, which reads as "all done".
 *
 *  PostgREST has no group-by, so this reduces the row set client-side. */
export async function getPendingPutawayCounts(): Promise<Record<number, number>> {
  const { data, error } = await supabase
    .from('wie_putaway_recommendations')
    .select('warehouse_id')
    .in('status', ['suggested', 'assigned'])
  if (error) throw error
  const counts: Record<number, number> = {}
  for (const row of (data ?? []) as { warehouse_id: number }[]) {
    counts[row.warehouse_id] = (counts[row.warehouse_id] ?? 0) + 1
  }
  return counts
}
