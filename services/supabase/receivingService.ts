import { supabase } from '@/lib/supabase'

export interface ReceiptLine {
  product_id: number
  quantity: number
  lot_code?: string
  expiry_date?: string
  barcode?: string
  supplier_id?: number // per-line supplier override (defaults to the header)
  po_id?: string
}

// Delivery header — records WHICH supplier supplied the goods. Either an
// existing supplier_id or a free-text supplier_name (resolved/created server
// side). received_by / received_date default to the actor / today when omitted.
export interface ReceiptHeader {
  supplier_id?: number
  supplier_name?: string
  reference?: string
  received_date?: string
  received_by?: string
}

export interface ReceiveStockResult {
  lines_received: number
  receipt_id?: number
  /** Destination warehouse the stock landed in (mig 00038) — drives putaway. */
  location_id?: number
}

// Records a goods receipt (stock IN) via the receive-stock Edge Function, which
// calls the inv_receive_stock RPC. Increments on_hand at the default warehouse,
// creating/updating tracked batches when a lot_code is supplied, and records the
// supplier (header default, overridable per line) on every receipt movement.
export async function receiveStock(
  header: ReceiptHeader,
  lines: ReceiptLine[],
): Promise<ReceiveStockResult> {
  const { data, error } = await supabase.functions.invoke<{ ok: true; result: ReceiveStockResult }>(
    'receive-stock',
    { body: { receipt: header, lines } },
  )
  if (error) throw error
  return data!.result
}
