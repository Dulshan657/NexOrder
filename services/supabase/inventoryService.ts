import { supabase } from '@/lib/supabase'
import { positionsUsed } from '@/supabase/functions/_shared/wie/capacity'
import type { HuType, SlotKind } from '@/supabase/functions/_shared/wie/capacity'

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

/** Capacity currently used at a location, in the unit its capacity_slots is
 *  denominated in: one position per pallet plate in a pallet-slot bin,
 *  Σ(on_hand × size_factor) everywhere else (mig 00078). Same rule the engine
 *  and SQL apply — see _shared/wie/capacity.ts. */
export async function getBinFillSlots(locationId: number): Promise<number> {
  const { data: loc, error: locErr } = await supabase
    .from('locations')
    .select('slot_kind')
    .eq('id', locationId)
    .maybeSingle()
  if (locErr) throw locErr

  const { data, error } = await supabase
    .from('inventory_balances')
    .select('on_hand, handling_unit_id, products(size_factor), handling_units(hu_type)')
    .eq('location_id', locationId)
    .gt('on_hand', 0)
  if (error) throw error

  return positionsUsed(
    (loc as { slot_kind?: SlotKind } | null)?.slot_kind ?? null,
    ((data ?? []) as any[]).map((r) => ({
      onHand: Number(r.on_hand),
      sizeFactor: Number(r.products?.size_factor ?? 1),
      huId: r.handling_unit_id != null ? Number(r.handling_unit_id) : null,
      huType: r.handling_units?.hu_type ?? null,
    })),
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
  /** The plate this quantity sits on (mig 00075); null = loose stock. Carried
   *  so fill can be counted per PLATE in a pallet-slot bin (mig 00078). */
  huId: number | null
  huType: HuType
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
    .select('location_id, product_id, on_hand, allocated, handling_unit_id, products(name, size_factor), handling_units(hu_type)')
    .in('location_id', locationIds)
  if (error) throw error
  return ((data ?? []) as any[]).map((r) => ({
    locationId: Number(r.location_id),
    productId: Number(r.product_id),
    productName: r.products?.name ?? null,
    sizeFactor: Number(r.products?.size_factor ?? 1),
    onHand: Number(r.on_hand),
    allocated: Number(r.allocated),
    huId: r.handling_unit_id != null ? Number(r.handling_unit_id) : null,
    huType: r.handling_units?.hu_type ?? null,
  }))
}

/** One row per product with ANY balance row in a warehouse's subtree (root +
 * descendants), via the `inv_product_stock_by_warehouse` RPC. A product with a
 * zero-quantity row IS returned (onHand 0); a product with NO row is ABSENT —
 * that distinction is load-bearing for the Products "not stocked here" badge,
 * so callers must never default an absent product to 0. */
export interface ProductStockRow {
  productId: number
  onHand: number
  allocated: number
  available: number
}

// `inv_product_stock_by_warehouse` lives in the DB but isn't in the generated
// database.types.ts Functions map (which we don't own here), so the typed
// client would reject the name. Narrow the rpc call to just what we need
// instead of reaching for `any` (mirrors warehouseReportService.ts).
type ProductStockByWarehouseRpcRow = {
  product_id: number
  on_hand: number | string
  allocated: number | string
  available: number | string
}
type ProductStockByWarehouseRpc = (
  fn: 'inv_product_stock_by_warehouse',
  args: { p_warehouse_id: number },
) => Promise<{ data: ProductStockByWarehouseRpcRow[] | null; error: { message: string } | null }>

export async function getProductStockByWarehouse(warehouseId: number): Promise<ProductStockRow[]> {
  // `supabase.rpc` is a class method that reads `this.rest` internally —
  // assigning it to a local const without `.bind` detaches it from its
  // receiver, so `this` is undefined and the call throws a TypeError
  // ("Cannot read properties of undefined (reading 'rest')") before any
  // request is sent. Must stay bound.
  const rpc = supabase.rpc.bind(supabase) as unknown as ProductStockByWarehouseRpc
  const { data, error } = await rpc('inv_product_stock_by_warehouse', { p_warehouse_id: warehouseId })
  if (error) throw new Error(error.message)
  // NUMERIC columns surface as strings over the wire (e.g. "120.000") — coerce.
  return (data ?? []).map((r) => ({
    productId: Number(r.product_id),
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
