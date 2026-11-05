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
import { ORDER_STATUS_LADDER, setOrderStatus, statusesUpTo } from './orderStatus.ts'

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
 * reserved is vacuously complete, except on an imported order, where an open line
 * also counts unless another warehouse still holds it (mig 00140).
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
 * May this move put an imported order at 'packed'? Nothing else leaves an order there with
 * a line open safely: dispatch is refused, inv_close_line_short refuses 'packed' (mig
 * 00140), cancelling refuses it and going backwards is refused, so the line could never be
 * finished. Answers null to allow, or what to tell the operator. Fails closed. Any other
 * status, and any order with no invoice number, is not asked about at all.
 *
 * warehouseId is the fulfilment moving. An order with no fulfilments has no warehouse to
 * ask about, so its lines are read: each must be fully picked or closed short.
 */
export async function importedPackRefusal(
  admin: Pick<SupabaseClient, 'from' | 'rpc'>,
  input: { orderId: string; status: string; qbInvoiceNumber: string | null; warehouseId: number | null },
): Promise<string | null> {
  const { orderId, status, qbInvoiceNumber, warehouseId } = input
  if (status !== 'packed' || qbInvoiceNumber == null) return null

  const refusal = 'This order still has lines to pick. Pick them or finish them short before packing.'
  if (warehouseId != null) {
    return (await isLocationFullyPicked(admin as SupabaseClient, orderId, warehouseId)) ? null : refusal
  }

  const { data, error } = await admin
    .from('order_items')
    .select('quantity, pick_progress(picked_qty), pick_differences(kind)')
    .eq('order_id', orderId)
  if (error || !data) return refusal
  const open = (data as any[]).some((l) => {
    const picked = (l.pick_progress ?? []).reduce((sum: number, p: any) => sum + Number(p.picked_qty), 0)
    const closed = (l.pick_differences ?? []).some((d: any) => d.kind === 'short')
    return picked < Number(l.quantity) && !closed
  })
  return open ? refusal : null
}

/**
 * Advance every 'processed' fulfilment of this order that is now fully picked, not only
 * the caller's. Closing a line, or picking the last of one at another warehouse, can leave
 * a site with nothing to pick and so no event of its own to advance it. Returns how many
 * fulfilments the order has, so a caller can tell a legacy order, which has none. The
 * caller recomputes the order status afterwards.
 */
export async function advanceCompletedFulfilments(
  admin: SupabaseClient,
  orderId: string,
  actorId: string | null,
  stampIso: string,
  note: string,
): Promise<number> {
  const { data } = await admin
    .from('order_fulfillments')
    .select('id, location_id, status, status_history')
    .eq('order_id', orderId)
  const rows = (data ?? []) as any[]
  for (const ful of rows) {
    if (ful.status !== 'processed') continue
    if (!(await isLocationFullyPicked(admin, orderId, ful.location_id))) continue
    const hist = Array.isArray(ful.status_history) ? ful.status_history : []
    await admin
      .from('order_fulfillments')
      .update({
        status: 'picked',
        status_history: [...hist, { status: 'picked', timestamp: stampIso, actor: actorId, note }],
      })
      .eq('id', ful.id)
      // A concurrent advance already moved it on; don't overwrite its history.
      .eq('status', 'processed')
  }
  return rows.length
}

/**
 * May a Warehouse-role caller close this line short? They act for their own warehouse
 * only, and closing a line gives back the line's units wherever the order holds them. So
 * the order must have a fulfilment at their warehouse, a bin they name must be under it,
 * and the order must hold none of this product elsewhere: that decision belongs to the
 * other site or to an Admin or Manager, who are not asked this. Fails closed.
 */
export async function closeShortRefusal(
  admin: Pick<SupabaseClient, 'from' | 'rpc'>,
  input: { orderId: string; productId: number; homeWarehouseId: number | null; locationId: number | null },
): Promise<{ code: 'FORBIDDEN' | 'CONFLICT'; reason: string; message: string } | null> {
  const { orderId, productId, homeWarehouseId, locationId } = input
  const notYours = {
    code: 'FORBIDDEN' as const,
    reason: 'NOT_YOUR_WAREHOUSE',
    message: 'You can only finish a line short at your own warehouse.',
  }
  if (homeWarehouseId == null) return notYours

  const { data: sites } = await admin
    .from('order_fulfillments')
    .select('location_id')
    .eq('order_id', orderId)
  if (!((sites ?? []) as any[]).some((s) => s.location_id === homeWarehouseId)) return notYours

  if (locationId != null) {
    const { data: root } = await admin.rpc('inv_root_warehouse', { p_location_id: locationId })
    if (root !== homeWarehouseId) return notYours
  }

  const { data: held, error } = await admin.rpc('inv_order_held_outside_warehouse', {
    p_order_id: orderId,
    p_product_id: productId,
    p_warehouse_id: homeWarehouseId,
  })
  if (error || !(Number(held) <= 0)) {
    return {
      code: 'CONFLICT',
      reason: 'HELD_AT_OTHER_WAREHOUSE',
      message: 'Another warehouse still holds stock for this line. Ask them to pick it, or ask a manager to finish the line short.',
    }
  }
  return null
}

/**
 * On a dispatch transition, release any residual reservation this warehouse
 * still holds for the order — deallocates only this order's own remainder, across
 * the warehouse's bins, via inv_release_reservation (mig 00140). A no-op for every
 * other status. A correctly-picked fulfilment has nothing left to release: the RPC
 * nets this order's ledger against its picks per bin and only deallocates what's
 * actually left, so calling it unconditionally on dispatch is always safe. This is what stops a
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

  // A cancelled order is terminal (mig 00111) and must not be rolled back to a
  // fulfilment status. `order_fulfillments.status` has no `cancelled` value on
  // purpose — a site cannot be cancelled independently of the order it serves —
  // so its rows keep whatever they last held, and without a guard the next
  // pick or status change anywhere would recompute the order back to
  // `processed` and quietly un-cancel it. order_set_status_tx (mig 00128) makes
  // that check under the row lock, so a cancel that commits mid-recompute is
  // still seen. Unchanged status is a no-op inside it (no history entry).
  //
  // Forward-only: the rollup was computed from a fulfilments read taken before
  // the lock, so when two sites advance at once the slower writer holds a
  // stale, lower rollup. Refusing a move backwards keeps the later one.
  const verdict = await setOrderStatus(admin, {
    orderId,
    from: statusesUpTo(ORDER_STATUS_LADDER, rolled as (typeof ORDER_STATUS_LADDER)[number]),
    to: rolled,
    entry: { status: rolled, timestamp: stampIso, actor: actorId, note: 'Derived from warehouse fulfilments' },
  })
  if (verdict.ok === true) return rolled
  return verdict.code === 'CANCELLED' ? 'cancelled' : null
}
