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

/**
 * Distinct ROOT WAREHOUSE ids that hold (or held) a reservation for this order.
 * Resolves allocation bins back to their warehouse (mig 00040), so a racked
 * warehouse — whose allocations land on bins — still yields one fulfilment.
 */
export async function fulfillmentLocations(admin: SupabaseClient, orderId: string): Promise<number[]> {
  const { data, error } = await admin.rpc('inv_order_fulfilment_warehouses', { p_order_id: orderId })
  if (error || !data) return []
  const set = new Set<number>()
  for (const r of data as any[]) {
    if (r.warehouse_id != null) set.add(r.warehouse_id)
  }
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
 * Delete unadvanced ('processed') fulfilment rows whose warehouse is no longer in
 * keepLocationIds. Used after an operator re-route: the origin warehouse, now
 * net-zero reserved, would otherwise leave a phantom 'processed' fulfilment that
 * freezes the order's rollup at 'processed' forever. Only 'processed' rows are
 * removed — a picked/packed/dispatched row represents real physical work and is
 * preserved. No-op when keepLocationIds is empty (never strip an order to zero).
 */
export async function pruneFulfillments(
  admin: SupabaseClient,
  orderId: string,
  keepLocationIds: number[],
): Promise<void> {
  if (keepLocationIds.length === 0) return
  await admin
    .from('order_fulfillments')
    .delete()
    .eq('order_id', orderId)
    .eq('status', 'processed')
    .not('location_id', 'in', `(${keepLocationIds.join(',')})`)
}

/**
 * Is the given WAREHOUSE's portion of the order fully picked? Compares base units
 * reserved at that warehouse (allocate − deallocate, resolved bin→warehouse)
 * against base units picked there. Delegated to inv_warehouse_pick_complete
 * (mig 00040) so the bin→warehouse resolution is consistent. A site with nothing
 * reserved is vacuously complete.
 */
export async function isLocationFullyPicked(
  admin: SupabaseClient,
  orderId: string,
  warehouseId: number,
): Promise<boolean> {
  const { data, error } = await admin.rpc('inv_warehouse_pick_complete', {
    p_order_id: orderId,
    p_warehouse_id: warehouseId,
  })
  if (error) return false
  return data === true
}

/**
 * On a dispatch transition, release any residual reservation this warehouse
 * still holds for the order — deallocates only the un-picked remainder via
 * inv_release_reservation (mig 00036). A no-op for every other status. A
 * correctly-picked fulfilment has nothing left to release: the RPC nets
 * ordered-vs-picked internally and only deallocates what's actually left, so
 * calling it unconditionally on dispatch is always safe. This is what stops a
 * short-picked-then-dispatched fulfilment from leaving `allocated` units
 * stranded at this location, unreachable to `inv_transfer_stock` (which moves
 * available stock only) and therefore un-puttable-away forever.
 *
 * Dispatch has already been persisted by the time we get here, so a failure
 * must not fail the request — but it must not vanish either: a silent failure
 * here is exactly how stock gets stranded. Log and continue.
 */
export async function releaseResidualOnDispatch(
  admin: SupabaseClient,
  orderId: string,
  locationId: number,
  actorId: string | null,
  status: FulfillmentStatus,
): Promise<void> {
  if (status !== 'dispatched') return
  const { error } = await admin.rpc('inv_release_reservation', {
    p_order_id: orderId,
    p_location_id: locationId,
    p_actor: actorId,
  })
  if (error) {
    console.error(
      `inv_release_reservation failed for order ${orderId} at location ${locationId}: ${error.message}`,
    )
  }
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

  // A cancelled order is terminal (mig 00111) and must not be rolled back to a
  // fulfilment status. `order_fulfillments.status` has no `cancelled` value on
  // purpose — a site cannot be cancelled independently of the order it serves —
  // so its rows keep whatever they last held, and without this guard the next
  // pick or status change anywhere would recompute the order back to `processed`
  // and quietly un-cancel it. The fulfilments are left as they are: they are the
  // record of what each warehouse had done when the order was cancelled.
  if ((order as any).status === 'cancelled') return 'cancelled'

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
