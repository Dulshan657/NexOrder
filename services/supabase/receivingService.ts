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
  /** Which plate in `plates` this line lands on (mig 00075). Omitted = the
   *  server mints a plate for the line, so every receipt line ends up on one. */
  plate_key?: string
  /** Hold this line (mig 00101): it is routed to a quarantine bin and cannot be
   *  allocated until it is released by moving it out. Per line, so one suspect
   *  product can be held while the rest of the delivery goes to ordinary stock;
   *  the header flag sets every line at once. */
  quarantine?: boolean
}

/** A pallet or carton built at the dock. The CODE is minted server-side; `key`
 *  is only a client-side token linking lines to the plate they sit on. */
export interface ReceiptPlate {
  key: string
  hu_type: 'pallet' | 'carton'
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
  /** Hold the WHOLE delivery (mig 00101). The server resolves this onto every
   *  line, so nothing downstream has to rank header against line: a line saying
   *  false for itself stays false. */
  quarantine?: boolean
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
  plates?: ReceiptPlate[],
): Promise<ReceiveStockResult> {
  const { data, error } = await supabase.functions.invoke<{
    ok: true
    result: ReceiveStockResult
    putaway?: ReceivePutaway | null
  }>('receive-stock', { body: { receipt: header, lines, ...(plates?.length ? { plates } : {}) } })
  if (error) throw error
  return { ...data!.result, putaway: data!.putaway ?? null }
}

/** Plates created by a receipt, so the operator can print their labels
 *  immediately — an unlabelled plate is just a database claim. */
export interface ReceiptPlateResult {
  id: number
  code: string
  huType: 'pallet' | 'carton'
}

/** The plates attached to a goods receipt, newest receipt first. */
export async function getReceiptPlates(goodsReceiptId: number): Promise<ReceiptPlateResult[]> {
  const { data, error } = await supabase
    .from('handling_units')
    .select('id, code, hu_type')
    .eq('goods_receipt_id', goodsReceiptId)
    .order('id')
  if (error) throw error
  return (data ?? []).map((r: Record<string, unknown>) => ({
    id: r.id as number,
    code: r.code as string,
    huType: r.hu_type as 'pallet' | 'carton',
  }))
}
