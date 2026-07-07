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
  locationId: number
  locationCode: string | null
  locationName: string | null
  onHand: number
  allocated: number
  available: number
}

export async function getBalancesByProduct(productId: number): Promise<ProductBatchBalance[]> {
  const { data, error } = await supabase
    .from('inventory_balances')
    .select('id, location_id, batch_id, on_hand, allocated, available, batches(lot_code, expiry_date), locations(code, name)')
    .eq('product_id', productId)
    .order('id')
  if (error) throw error
  return ((data ?? []) as any[]).map((r) => ({
    balanceId: r.id,
    batchId: r.batch_id ?? null,
    lotCode: r.batches?.lot_code ?? null,
    expiryDate: r.batches?.expiry_date ?? null,
    locationId: Number(r.location_id),
    locationCode: r.locations?.code ?? null,
    locationName: r.locations?.name ?? null,
    onHand: Number(r.on_hand),
    allocated: Number(r.allocated),
    available: Number(r.available),
  }))
}

/** Capacity slots currently used at a location = Σ(on_hand × product.size_factor). */
export async function getBinFillSlots(locationId: number): Promise<number> {
  const { data, error } = await supabase
    .from('inventory_balances')
    .select('on_hand, products(size_factor)')
    .eq('location_id', locationId)
    .gt('on_hand', 0)
  if (error) throw error
  return ((data ?? []) as any[]).reduce(
    (s, r) => s + Number(r.on_hand) * Number(r.products?.size_factor ?? 1),
    0,
  )
}

/** One stock row per (bin, product, batch) under a warehouse, with the product's
 * name + size_factor so the viewer can compute fill without the full product list.
 * Scoped by the warehouse's materialized_path subtree. */
export interface WarehouseBinBalance {
  locationId: number
  productId: number
  productName: string | null
  sizeFactor: number
  onHand: number
  allocated: number
}

/** Escape LIKE metacharacters so a code containing `_`/`%` can't widen a subtree
 * match into a sibling warehouse (e.g. path `WH_1` matching `WHX1/...`). */
function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`)
}

export async function getBalancesByWarehouse(warehouseId: number): Promise<WarehouseBinBalance[]> {
  const { data: wh, error: whErr } = await supabase
    .from('locations')
    .select('materialized_path')
    .eq('id', warehouseId)
    .single()
  if (whErr) throw whErr
  const path = (wh as { materialized_path: string | null } | null)?.materialized_path
  if (!path) return []

  // The warehouse root itself PLUS every descendant. Bulk warehouses and racked
  // staging keep stock on the root location, so it must be included.
  const { data: locRows, error: locErr } = await supabase
    .from('locations')
    .select('id')
    .like('materialized_path', `${escapeLike(path)}/%`)
  if (locErr) throw locErr
  const locationIds = [warehouseId, ...((locRows ?? []) as { id: number }[]).map((l) => l.id)]

  const { data, error } = await supabase
    .from('inventory_balances')
    .select('location_id, product_id, on_hand, allocated, products(name, size_factor)')
    .in('location_id', locationIds)
  if (error) throw error
  return ((data ?? []) as any[]).map((r) => ({
    locationId: Number(r.location_id),
    productId: Number(r.product_id),
    productName: r.products?.name ?? null,
    sizeFactor: Number(r.products?.size_factor ?? 1),
    onHand: Number(r.on_hand),
    allocated: Number(r.allocated),
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
  supplierName: string | null
  createdAt: string
}

export async function getRecentReceipts(limit = 10): Promise<RecentReceipt[]> {
  const { data, error } = await supabase
    .from('inventory_movements')
    .select('id, qty_delta, created_at, product_id, products(name, sku), batches(lot_code, expiry_date), suppliers(name)')
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
    supplierName: r.suppliers?.name ?? null,
    createdAt: r.created_at,
  }))
}
