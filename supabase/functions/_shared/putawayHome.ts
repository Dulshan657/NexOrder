// Home-bin reads for putaway (NX-0006, enforced by NX-0032).
//
// The I/O half of home-first putaway; the decision itself is the pure
// _shared/wie/homeFirst.ts. Kept out of putawayTasks.ts so that file stays the
// orchestration and this stays the three queries.
//
// Since NX-0032 a product's home bin is a RULE, not advice: off-home putaway is
// refused while the home has room (mig 00142). So every read here fails CLOSED,
// like the rule and slotting loads in putawayTasks.ts. A failed load used to
// mean "no home known" and the line got a plain engine suggestion; that would
// now send stock somewhere the rule refuses, or hide how full the home is. It
// throws instead, no task is created, and the floor is told to try again. The
// detail (warehouse, product, Supabase's own words) goes to the server log.

// deno-lint-ignore-file no-explicit-any
import { type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.103.0'
import { EdgeFunctionError } from './errors.ts'
import { HOME_UNAVAILABLE } from './putawayHomeBlock.ts'

export interface HomeBinRow {
  binId: number
  /** Replenishment max (mig 00082), base units. Null = fill to capacity. */
  maxQty: number | null
}

/** Statuses of a putaway task that still has stock on its way to a bin. */
const OPEN_STATUSES = ['suggested', 'assigned'] as const

/** Log what failed, then throw the one sentence the floor gets. */
function homeUnavailable(where: string, error: { message?: string }): never {
  console.error(`[putawayHome] ${where}: ${error.message ?? 'unknown error'}`)
  throw new EdgeFunctionError('INTERNAL', HOME_UNAVAILABLE)
}

/** product_id -> home bin, for one warehouse. Throws HOME_UNAVAILABLE if unread. */
export async function loadHomeBins(
  admin: SupabaseClient,
  warehouseId: number,
): Promise<Map<number, HomeBinRow>> {
  const homes = new Map<number, HomeBinRow>()
  const { data, error } = await admin.from('product_home_bins')
    .select('product_id, bin_id, max_qty')
    .eq('warehouse_id', warehouseId)
    // One SKU may have several slots (mig 00082: primary, chilled, each-pick…);
    // the home putaway fills is the PRIMARY one, the same row replenishment
    // tops up (00093 / 00118).
    .eq('purpose', 'primary')
  if (error) homeUnavailable(`product_home_bins, warehouse ${warehouseId}`, error)
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
 * Throws HOME_UNAVAILABLE if either read fails: a zero here would read as an
 * empty home and let stock past a bin that may be full.
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
  const where = `warehouse ${warehouseId}, product ${productId}, bin ${binId}`
  if (bErr) homeUnavailable(`inventory_balances, ${where}`, bErr)
  const onHand = ((balances ?? []) as any[]).reduce((sum, r) => sum + (Number(r.on_hand) || 0), 0)

  // A task's target is where the desk assigned it, else where the engine said.
  const { data: open, error: oErr } = await admin.from('wie_putaway_recommendations')
    .select('quantity, recommended_location_id, assigned_location_id')
    .eq('warehouse_id', warehouseId)
    .eq('product_id', productId)
    .in('status', OPEN_STATUSES as unknown as string[])
  if (oErr) homeUnavailable(`wie_putaway_recommendations, ${where}`, oErr)
  const pendingQty = ((open ?? []) as any[])
    .filter((r) => Number(r.assigned_location_id ?? r.recommended_location_id) === binId)
    .reduce((sum, r) => sum + (Number(r.quantity) || 0), 0)

  return { onHand, pendingQty }
}
