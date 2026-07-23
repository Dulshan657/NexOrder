import { supabase } from '@/lib/supabase'
import type { PutawayLineRecommendation } from '@/types'

export interface ReceiptLine {
  product_id: number
  quantity: number // in the chosen UOM (or base units when uom_id is absent)
  uom_id?: number  // received UOM (mig 00067); server converts to base units
  lot_code?: string
  expiry_date?: string
  barcode?: string
  supplier_id?: number // per-line supplier override (defaults to the header)
  po_id?: string
}

// Delivery header — records WHICH supplier supplied the goods. Either an
// existing supplier_id or a free-text supplier_name (resolved/created server
// side). received_by / received_date default to the actor / today when omitted.
// location_id is the destination warehouse; when omitted the server defaults to
// the actor's home warehouse, then the system default location.
export interface ReceiptHeader {
  supplier_id?: number
  supplier_name?: string
  reference?: string
  received_date?: string
  received_by?: string
  location_id?: number
}

/** Putaway tasks the server generated for this receipt. Racked, published
 *  warehouses return 'engine' with a recommendation per placed portion (a line
 *  too big for one bin is split, so a line may map to several); everything else
 *  returns 'legacy'. */
export type ReceivePutaway =
  | { mode: 'legacy'; recommendations: [] }
  | { mode: 'engine'; layoutId: number; recommendations: PutawayLineRecommendation[] }

export interface ReceiveStockResult {
  lines_received: number
  receipt_id?: number
  /** Destination warehouse the stock landed in (mig 00038) — drives putaway. */
  location_id?: number
  /** Server-generated putaway tasks for this receipt; null when unavailable. */
  putaway?: ReceivePutaway | null
}

// Records a goods receipt (stock IN) via the receive-stock Edge Function, which
// calls the inv_receive_stock RPC. Increments on_hand at the default warehouse,
// creating/updating tracked batches when a lot_code is supplied, and records the
// supplier (header default, overridable per line) on every receipt movement.
export async function receiveStock(
  header: ReceiptHeader,
  lines: ReceiptLine[],
): Promise<ReceiveStockResult> {
  const { data, error } = await supabase.functions.invoke<{
    ok: true
    result: ReceiveStockResult
    putaway?: ReceivePutaway | null
  }>('receive-stock', { body: { receipt: header, lines } })
  if (error) throw error
  return { ...data!.result, putaway: data!.putaway ?? null }
}
