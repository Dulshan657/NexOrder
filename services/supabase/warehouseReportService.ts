import { supabase } from '@/lib/supabase'
import type { WarehouseReport } from '@/types'

// `wie_warehouse_report` lives in the DB but isn't in the generated
// database.types.ts Functions map (which we don't own here), so the typed
// client would reject the name. Narrow the rpc call to just what we need
// instead of reaching for `any`.
type WarehouseReportRpc = (
  fn: 'wie_warehouse_report',
  args: { p_warehouse_id: number },
) => Promise<{ data: WarehouseReport | null; error: { message: string } | null }>

/**
 * Fetch the Warehouse Intelligence reporting rollup for one warehouse via the
 * `wie_warehouse_report` Postgres RPC. Returns putaway/slotting/velocity mixes,
 * bin utilization, top congested nodes, and the latest simulation KPIs.
 */
export async function getWarehouseReport(warehouseId: number): Promise<WarehouseReport> {
  // `supabase.rpc` is a class method that reads `this.rest` internally —
  // assigning it to a local const without `.bind` detaches it from its
  // receiver, so `this` is undefined and the call throws a TypeError
  // ("Cannot read properties of undefined (reading 'rest')") before any
  // request is sent. Must stay bound.
  const rpc = supabase.rpc.bind(supabase) as unknown as WarehouseReportRpc
  const { data, error } = await rpc('wie_warehouse_report', { p_warehouse_id: warehouseId })
  if (error) throw new Error(error.message)
  if (!data) throw new Error('Warehouse report returned no data')
  return data
}
