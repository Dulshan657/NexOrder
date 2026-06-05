import { supabase } from '@/lib/supabase'

export interface ReceiptLine {
  product_id: number
  quantity: number
  lot_code?: string
  expiry_date?: string
  barcode?: string
  supplier_id?: number
  po_id?: string
}

export interface ReceiveStockResult {
  lines_received: number
}

// Records a goods receipt (stock IN) via the receive-stock Edge Function, which
// calls the inv_receive_stock RPC. Increments on_hand at the default warehouse,
// creating/updating tracked batches when a lot_code is supplied.
export async function receiveStock(lines: ReceiptLine[]): Promise<ReceiveStockResult> {
  const { data, error } = await supabase.functions.invoke<{ ok: true; result: ReceiveStockResult }>(
    'receive-stock',
    { body: { lines } },
  )
  if (error) throw error
  return data!.result
}
