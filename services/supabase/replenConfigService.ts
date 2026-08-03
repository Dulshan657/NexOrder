// Replenishment configuration — the whole of one warehouse's min/max grid.
//
// Read is a single Postgres RPC (mig 00093); write is mutate-product-home-bin's
// `bulkSet` action. Both deliberately carry the whole grid rather than a row at
// a time: the thing this closes (onboarding H3) is that per-row configuration
// does not get finished for a 200-SKU site.

import { supabase } from '@/lib/supabase'
import { extractFunctionErrorMessage } from '@/lib/functionError'
import type { ReplenConfigPayload } from '@/lib/replenPolicy'

// `wie_replen_config_rows` is not in the generated database.types.ts Functions
// map (which this repo does not regenerate — see productHomeBinService), so the
// typed client would reject the name. Narrow the call instead of reaching for
// `any`. Same shape as warehouseReportService.
type ReplenConfigRpc = (
  fn: 'wie_replen_config_rows',
  args: { p_warehouse_id: number },
) => Promise<{ data: ReplenConfigPayload | null; error: { message: string } | null }>

/** Every candidate SKU for this warehouse plus the unclaimed pick bins. */
export async function getReplenConfig(warehouseId: number): Promise<ReplenConfigPayload> {
  // `supabase.rpc` reads `this.rest` internally: assigning it to a local without
  // `.bind` detaches the receiver and it throws a TypeError before any request
  // is sent. This exact bug shipped once already (wie_warehouse_report).
  const rpc = supabase.rpc.bind(supabase) as unknown as ReplenConfigRpc
  const { data, error } = await rpc('wie_replen_config_rows', { p_warehouse_id: warehouseId })
  if (error) throw new Error(error.message)
  if (!data) throw new Error('Replenishment configuration returned no data')
  return {
    warehouseId: data.warehouseId,
    layoutId: data.layoutId ?? null,
    productCount: data.productCount ?? 0,
    rows: data.rows ?? [],
    freeBins: data.freeBins ?? [],
  }
}

export interface BulkHomeBinRow {
  productId: number
  binId: number
  /** BASE units. null clears the figure. */
  minQty: number | null
  maxQty: number | null
}

export interface BulkHomeBinResult {
  applied: number
  failed: Array<{ productId: number; reason: string }>
}

/**
 * Save a batch of slots.
 *
 * `replenEnabled` is omitted for an ordinary save, which leaves the column
 * exactly as it was — arming is a separate, deliberate call. Pass `true` to arm
 * the batch and `false` to disarm it.
 */
export async function bulkSetHomeBins(
  warehouseId: number,
  rows: readonly BulkHomeBinRow[],
  replenEnabled?: boolean,
): Promise<BulkHomeBinResult> {
  const { data, error } = await supabase.functions.invoke<BulkHomeBinResult & { ok: true }>(
    'mutate-product-home-bin',
    {
      body: {
        action: 'bulkSet',
        warehouseId,
        rows,
        ...(replenEnabled === undefined ? {} : { replenEnabled }),
      },
    },
  )
  if (error) {
    throw new Error(await extractFunctionErrorMessage(error, 'Could not save the replenishment slots'))
  }
  return { applied: data?.applied ?? 0, failed: data?.failed ?? [] }
}
