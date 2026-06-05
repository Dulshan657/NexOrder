import { supabase } from '@/lib/supabase'

// Read-only access to the inventory ledger surface. All writes go through the
// inv_* RPCs invoked by Edge Functions (place-order, approve-po, receive-stock,
// record-pick); RLS lets staff SELECT but never write these tables directly.

export async function getInventoryBalances() {
  const { data, error } = await supabase
    .from('inventory_balances')
    .select('*')
    .order('product_id')
  if (error) throw error
  return data
}

/** Per-batch balance row for one product, with batch + location detail. */
export interface ProductBatchBalance {
  balanceId: number
  batchId: number | null
  lotCode: string | null
  expiryDate: string | null
  locationCode: string | null
  locationName: string | null
  onHand: number
  allocated: number
  available: number
}

export async function getBalancesByProduct(productId: number): Promise<ProductBatchBalance[]> {
  const { data, error } = await supabase
    .from('inventory_balances')
    .select('id, batch_id, on_hand, allocated, available, batches(lot_code, expiry_date), locations(code, name)')
    .eq('product_id', productId)
    .order('id')
  if (error) throw error
  return ((data ?? []) as any[]).map((r) => ({
    balanceId: r.id,
    batchId: r.batch_id ?? null,
    lotCode: r.batches?.lot_code ?? null,
    expiryDate: r.batches?.expiry_date ?? null,
    locationCode: r.locations?.code ?? null,
    locationName: r.locations?.name ?? null,
    onHand: Number(r.on_hand),
    allocated: Number(r.allocated),
    available: Number(r.available),
  }))
}

export async function getLocations() {
  const { data, error } = await supabase
    .from('locations')
    .select('*')
    .order('id')
  if (error) throw error
  return data
}

/** A recent goods-receipt movement, for the Receive Stock activity panel. */
export interface RecentReceipt {
  id: number
  productId: number
  productName: string
  productSku: string
  qty: number
  lotCode: string | null
  expiryDate: string | null
  createdAt: string
}

export async function getRecentReceipts(limit = 10): Promise<RecentReceipt[]> {
  const { data, error } = await supabase
    .from('inventory_movements')
    .select('id, qty_delta, created_at, product_id, products(name, sku), batches(lot_code, expiry_date)')
    .eq('movement_type', 'receipt')
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw error
  return ((data ?? []) as any[]).map((r) => ({
    id: r.id,
    productId: r.product_id,
    productName: r.products?.name ?? '—',
    productSku: r.products?.sku ?? '',
    qty: Number(r.qty_delta),
    lotCode: r.batches?.lot_code ?? null,
    expiryDate: r.batches?.expiry_date ?? null,
    createdAt: r.created_at,
  }))
}
