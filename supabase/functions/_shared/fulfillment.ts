// Shared helpers for the per-warehouse order_fulfillments model (mig 00036).
//
// An order is split across the warehouses that hold a reservation for it; each
// gets an order_fulfillments row with its own picked->packed->dispatched->
// delivered lifecycle. orders.status is the DERIVED rollup (least-advanced site).
// These helpers are used by update-order-status and record-pick to keep the
// fulfilment state machine and the derived order status consistent.

// deno-lint-ignore-file no-explicit-any
import { type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.103.0'
import { rollupOrderStatus, type FulfillmentStatus } from './orderStatusRollup.ts'

export const FULFILLMENT_LADDER: FulfillmentStatus[] = [
  'processed',
  'picked',
  'packed',
  'dispatched',
  'delivered',
]

/** Distinct warehouse ids that hold (or held) a reservation for this order. */
export async function fulfillmentLocations(admin: SupabaseClient, orderId: string): Promise<number[]> {
  const { data } = await admin
    .from('inventory_movements')
    .select('location_id')
    .eq('ref_type', 'order')
    .eq('ref_id', orderId)
    .eq('movement_type', 'allocate')
  const set = new Set<number>()
  for (const m of (data ?? []) as any[]) set.add(m.location_id)
  return [...set]
}

/**
 * Ensure an order_fulfillments row exists (status 'processed') for each given
 * location. Idempotent — re-processing an order never duplicates rows.
 */
export async function ensureFulfillments(
  admin: SupabaseClient,
  orderId: string,
  locationIds: number[],
  actorId: string | null,
  stampIso: string,
): Promise<void> {
  if (locationIds.length === 0) return
  const rows = locationIds.map((locId) => ({
    order_id: orderId,
    location_id: locId,
    status: 'processed',
    status_history: [{ status: 'processed', timestamp: stampIso, actor: actorId }],
  }))
  // ON CONFLICT (order_id, location_id) DO NOTHING — keep existing lifecycle.
  await admin.from('order_fulfillments').upsert(rows as any, {
    onConflict: 'order_id,location_id',
    ignoreDuplicates: true,
  })
}

/**
 * Is the given warehouse's portion of the order fully picked? Compares the base
 * units reserved at that location (allocate − deallocate movements) against the
 * base units picked there (pick_progress LINE units × pack_size). A site with
 * nothing reserved is vacuously complete.
 */
export async function isLocationFullyPicked(
  admin: SupabaseClient,
  orderId: string,
  locationId: number,
): Promise<boolean> {
  const { data: moves } = await admin
    .from('inventory_movements')
    .select('product_id, qty_delta, movement_type')
    .eq('ref_type', 'order')
    .eq('ref_id', orderId)
    .eq('location_id', locationId)
    .in('movement_type', ['allocate', 'deallocate'])
  const reserved = new Map<number, number>()
  for (const m of (moves ?? []) as any[]) {
    reserved.set(m.product_id, (reserved.get(m.product_id) ?? 0) + Number(m.qty_delta))
  }

  const { data: picks } = await admin
    .from('pick_progress')
    .select('picked_qty, order_items!inner(product_id, pack_size)')
    .eq('order_id', orderId)
    .eq('location_id', locationId)
  const picked = new Map<number, number>()
  for (const p of (picks ?? []) as any[]) {
    const pid = p.order_items.product_id as number
    const factor = Number(p.order_items.pack_size ?? 1)
    picked.set(pid, (picked.get(pid) ?? 0) + Number(p.picked_qty) * factor)
  }

  for (const [pid, r] of reserved) {
    if (r > 1e-9 && (picked.get(pid) ?? 0) < r - 1e-9) return false
  }
  return true
}

/**
 * Recompute orders.status as the rollup of its fulfilment statuses and persist
 * it if changed. No-op (returns null) for legacy orders with no fulfilments.
 */
export async function recomputeOrderStatus(
  admin: SupabaseClient,
  orderId: string,
  actorId: string | null,
  stampIso: string,
): Promise<string | null> {
  const { data: fs } = await admin
    .from('order_fulfillments')
    .select('status')
    .eq('order_id', orderId)
  if (!fs || fs.length === 0) return null

  const rolled = rollupOrderStatus((fs as any[]).map((f) => f.status as FulfillmentStatus))

  const { data: order } = await admin
    .from('orders')
    .select('status, status_history')
    .eq('id', orderId)
    .single()
  if (!order) return null
  if ((order as any).status === rolled) return rolled

  const history = Array.isArray((order as any).status_history) ? (order as any).status_history : []
  await admin
    .from('orders')
    .update({
      status: rolled,
      status_history: [
        ...history,
        { status: rolled, timestamp: stampIso, actor: actorId, note: 'Derived from warehouse fulfilments' },
      ],
    })
    .eq('id', orderId)
  return rolled
}
