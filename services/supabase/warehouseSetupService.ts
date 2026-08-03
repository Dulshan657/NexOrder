// Reads and writes for the warehouse setup checklist (mig 00092).
//
// Everything the checklist needs is already cached by hooks the Warehouse tab
// mounts anyway — layouts, label status, products, balances, level roles. Only
// three things are not, and they live here: the acknowledgement rows, and two
// COUNTS that would otherwise mean pulling thousands of rows to call `.length`
// on them.

import { supabase } from '@/lib/supabase'
import { toWarehouseSetupAck } from '@/lib/adapters'
import {
  describeValidationIssues,
  extractFunctionErrorDetails,
  extractFunctionErrorMessage,
} from '@/lib/functionError'
import type { WarehouseSetupAck } from '@/types'

/** Rethrow a functions.invoke failure carrying the message the server actually
 *  sent. Without this every failure reads "Edge Function returned a non-2xx
 *  status code" — see the same helper in layoutService.ts. */
async function rethrowWithServerMessage(error: unknown, fallback: string): Promise<never> {
  const message = await extractFunctionErrorMessage(error, fallback)
  const issues = describeValidationIssues(await extractFunctionErrorDetails(error))
  throw new Error(issues ? `${message} — ${issues}` : message)
}

/** Sign-offs recorded for one warehouse. */
export async function getSetupAcks(warehouseId: number): Promise<WarehouseSetupAck[]> {
  const { data, error } = await supabase
    .from('warehouse_setup_acknowledgements')
    .select('*')
    .eq('warehouse_id', warehouseId)
  if (error) throw error
  return (data ?? []).map(toWarehouseSetupAck)
}

/**
 * How many products have replenishment min/max enabled at this warehouse.
 *
 * A head-count, not a fetch: the checklist only asks "any?" and the answer
 * would otherwise cost one row per configured product. Replenishment is opt-in
 * and starts at zero (mig 00082's own verify block says so), which is what
 * makes this a meaningful step rather than an always-green one.
 */
export async function countReplenConfigured(warehouseId: number): Promise<number> {
  const { count, error } = await supabase
    .from('product_home_bins')
    .select('product_id', { count: 'exact', head: true })
    .eq('warehouse_id', warehouseId)
    // Cast: lib/database.types.ts predates mig 00082 and has not been
    // regenerated, so the typed client does not know `replen_enabled` exists.
    // Same documented workaround as productHomeBinService.ts:19-25.
    .eq('replen_enabled' as 'warehouse_id', true as unknown as number)
  if (error) throw error
  return count ?? 0
}

/**
 * How many placements a published layout carries.
 *
 * Feeds the putaway-candidate ceiling warning. `wie_putaway_candidates` is
 * ordered by dock distance with its limit as a HARD cutoff, so a layout with
 * more placements than that silently hides its farthest bays from the engine —
 * stock is simply never recommended there.
 */
export async function countLayoutPlacements(layoutId: number): Promise<number> {
  const { count, error } = await supabase
    .from('layout_placements')
    .select('id', { count: 'exact', head: true })
    .eq('layout_id', layoutId)
  if (error) throw error
  return count ?? 0
}

export interface AcknowledgeInput {
  warehouseId: number
  stepKey: string
  note?: string | null
}

export async function acknowledgeSetupStep(input: AcknowledgeInput): Promise<WarehouseSetupAck> {
  const { data, error } = await supabase.functions.invoke<{ ok: true; acknowledgement: unknown }>(
    'mutate-warehouse-setup-ack',
    {
      body: {
        action: 'acknowledge',
        warehouse_id: input.warehouseId,
        step_key: input.stepKey,
        note: input.note ?? null,
      },
    },
  )
  if (error) await rethrowWithServerMessage(error, 'Could not record that sign-off')
  return toWarehouseSetupAck((data as any).acknowledgement)
}

export async function revokeSetupStep(warehouseId: number, stepKey: string): Promise<void> {
  const { error } = await supabase.functions.invoke('mutate-warehouse-setup-ack', {
    body: { action: 'revoke', warehouse_id: warehouseId, step_key: stepKey },
  })
  if (error) await rethrowWithServerMessage(error, 'Could not undo that sign-off')
}
