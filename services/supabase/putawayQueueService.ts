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
  /** 'suggested' | 'assigned' | 'accepted' | 'overridden' | 'short' | ... The
   *  Walk needs it (NX-0033): it lists assigned lines AND suggested overflow
   *  lines awaiting confirmation, and the two read differently. */
  status: string
  /** Where the desk sent it, once assigned (mig 00080). NULL while the line is
   *  still `suggested`. Distinct from `recommendedLocationId` (what the engine
   *  said) — an operator can assign somewhere else entirely. */
  assignedLocationId: number | null
  assignedAt: string | null
  /** Why this bin (NX-0006, mig 00135): the product's home, near its home, the
   *  plain engine (no home yet), or a desk redirect. NULL before 00135. */
  suggestionSource?: PutawaySuggestionSource | null
  /** The planner made this a single-product pallet (mig 00142 unit_load), which
   *  is never held to the product's home and so never waits for an overflow
   *  confirmation (NX-0033, C5). Absent means false. */
  unitLoad?: boolean
  /** The product's CURRENT home bin in this warehouse (`product_home_bins`,
   *  purpose 'primary'), read with the Walk and refreshed with it (NX-0033).
   *  `null`: the product has no home right now. Absent: not read (the Assign
   *  queue does not need it), which must be taken as "unknown", never as "none".
   *
   *  Distinct from `suggestionSource`, which is a snapshot of the planner's
   *  reasoning when the line was made: 'engine' said "no home THEN". A home set
   *  since (from this very Walk, from the desk's editor) is only visible here. */
  homeLocationId?: number | null
}

export type PutawaySuggestionSource = 'home' | 'overflow' | 'engine' | 'desk'

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
    status: row.status,
    assignedLocationId: row.assigned_location_id ?? null,
    assignedAt: row.assigned_at ?? null,
    suggestionSource: row.suggestion_source ?? null,
    unitLoad: Boolean(row.unit_load),
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

/** The Walk's stops (mig 00080, NX-0033): what a person can carry to a bin now.
 *
 *    * assigned lines: a bin has been decided, by the system when the line was
 *      received (NX-0033) or by the desk, and nobody has carried the stock there
 *      yet. The stock they describe is still sitting at the warehouse root;
 *    * overflow lines awaiting confirmation: the home was full, the engine
 *      suggested another bin, and nobody has confirmed it. The walker confirms it
 *      by scanning that bin, or the desk does from the Assign queue, and the
 *      first wins. A single-product pallet (unit_load) never waits: it is not
 *      held to a home, so it is not "home full". The same predicate as
 *      wie_putaway_stops (mig 00143, 00145) and `isOverflowConfirmStop`.
 *
 *  Oldest first, the opposite of the Assign queue: this is a work list, and the
 *  thing that has been waiting on the dock longest should be placed first. */
export async function getWalkPutaways(warehouseId: number): Promise<PendingPutawayRow[]> {
  const { data, error } = await supabase
    .from('wie_putaway_recommendations')
    .select(QUEUE_SELECT)
    .eq('warehouse_id', warehouseId)
    .or('status.eq.assigned,and(status.eq.suggested,suggestion_source.eq.overflow,recommended_location_id.not.is.null,unit_load.eq.false)')
    .order('created_at', { ascending: true })
  if (error) throw error
  const rows = (data ?? []).map(toQueueRow)
  // Whether a stop may offer to give its product a home depends on whether the
  // product has one NOW, so it is read with the walk and refreshed with it.
  const homes = await getLiveHomeBins(warehouseId, rows.map((r) => r.productId))
  return rows.map((r) => ({ ...r, homeLocationId: homes.get(r.productId) ?? null }))
}

/** The current primary home bin of each product in a warehouse, by product id.
 *  One read for all of them, not one per row. A product with no home is simply
 *  absent from the map. `product_home_bins` is readable by every role that can
 *  open the Putaway tab. */
async function getLiveHomeBins(warehouseId: number, productIds: number[]): Promise<Map<number, number>> {
  const ids = [...new Set(productIds)]
  if (ids.length === 0) return new Map()
  const { data, error } = await supabase
    .from('product_home_bins')
    .select('product_id, bin_id')
    .eq('warehouse_id', warehouseId)
    // Cast: lib/database.types.ts predates mig 00082 and does not know `purpose`.
    // Same documented workaround as warehouseSetupService.countReplenConfigured.
    .eq('purpose' as 'warehouse_id', 'primary' as unknown as number)
    .in('product_id', ids)
  if (error) throw error
  return new Map((data ?? []).map((h) => [h.product_id, h.bin_id] as const))
}

/** Shortages (NX-0006): a count came up short and the operator flagged it.
 *  The missing units are still on record at the warehouse root until an
 *  Admin/Manager marks them found or writes them off. Oldest first. */
export async function getShortPutaways(warehouseId: number): Promise<PendingPutawayRow[]> {
  const { data, error } = await supabase
    .from('wie_putaway_recommendations')
    .select(QUEUE_SELECT)
    .eq('warehouse_id', warehouseId)
    .eq('status', 'short')
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
