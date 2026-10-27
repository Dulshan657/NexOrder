// Home-bin reads for putaway (NX-0006).
//
// The I/O half of home-first putaway; the decision itself is the pure
// _shared/wie/homeFirst.ts. Kept out of putawayTasks.ts so that file stays the
// orchestration and this stays the three queries.
//
// Home bins are ADVISORY here, so every read fails OPEN: a failed load means
// "no home known", and the line gets the plain engine suggestion it would have
// had before NX-0006. Contrast the rule and slotting loads in putawayTasks.ts,
// which are safety gates and fail closed.

// deno-lint-ignore-file no-explicit-any
import { type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.103.0'

export interface HomeBinRow {
  binId: number
  /** Replenishment max (mig 00082), base units. Null = fill to capacity. */
  maxQty: number | null
}

/** Statuses of a putaway task that still has stock on its way to a bin. */
const OPEN_STATUSES = ['suggested', 'assigned'] as const

/** product_id -> home bin, for one warehouse. */
export async function loadHomeBins(
  admin: SupabaseClient,
  warehouseId: number,
): Promise<Map<number, HomeBinRow>> {
  const homes = new Map<number, HomeBinRow>()
  const { data, error } = await admin.from('product_home_bins')
    .select('product_id, bin_id, max_qty')
    .eq('warehouse_id', warehouseId)
  if (error) return homes
  for (const r of (data ?? []) as any[]) {
    homes.set(Number(r.product_id), {
      binId: Number(r.bin_id),
      maxQty: r.max_qty != null ? Number(r.max_qty) : null,
    })
  }
  return homes
}

/**
 * What the home bin already holds of this product, and what open tasks are
 * already bringing to it. Only needed when the slot has a max_qty; capacity is
 * charged from the candidate row instead (v_bin_fill + v_bin_pending_putaway).
 */
export async function loadHomeSlotUsage(
  admin: SupabaseClient,
  args: { warehouseId: number; productId: number; binId: number },
): Promise<{ onHand: number; pendingQty: number }> {
  const { warehouseId, productId, binId } = args

  const { data: balances, error: bErr } = await admin.from('inventory_balances')
    .select('on_hand')
    .eq('product_id', productId)
    .eq('location_id', binId)
  const onHand = bErr
    ? 0
    : ((balances ?? []) as any[]).reduce((sum, r) => sum + (Number(r.on_hand) || 0), 0)

  // A task's target is where the desk assigned it, else where the engine said.
  const { data: open, error: oErr } = await admin.from('wie_putaway_recommendations')
    .select('quantity, recommended_location_id, assigned_location_id')
    .eq('warehouse_id', warehouseId)
    .eq('product_id', productId)
    .in('status', OPEN_STATUSES as unknown as string[])
  const pendingQty = oErr
    ? 0
    : ((open ?? []) as any[])
      .filter((r) => Number(r.assigned_location_id ?? r.recommended_location_id) === binId)
      .reduce((sum, r) => sum + (Number(r.quantity) || 0), 0)

  return { onHand, pendingQty }
}
