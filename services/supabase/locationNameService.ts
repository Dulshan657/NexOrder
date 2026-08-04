// Names for a handful of locations, by id.
//
// For the ORDER-scoped screens. The pick queue routes by order, not by
// warehouse — `PickRoutePanel`'s stops carry no `warehouseId` at all — so it
// cannot use `useWarehouseLocations`, which is what every warehouse-scoped
// screen resolves names from.
//
// A read-only `locations` query rather than widening `wie_order_alloc_bins` /
// `wie_order_pick_stops`: those need a DROP FUNCTION plus a recreate with a
// changed RETURNS TABLE, which is the "CREATE OR REPLACE with a changed
// signature creates a second overload" hazard that has already silently
// duplicated inv_transfer_stock and inv_receive_stock in this repo.
//
// Works for Warehouse-role users on a phone: `locations_select_staff`
// (mig 00027) includes them.

import { supabase } from '@/lib/supabase'
import type { DisplayLocation } from '@/lib/locationDisplay'

/** supabase-js `.in()` list size; a big pick wave can span more bins than one
 *  request should carry. */
const CHUNK = 200

export async function getLocationNames(ids: readonly number[]): Promise<Map<number, DisplayLocation>> {
  const out = new Map<number, DisplayLocation>()
  const unique = [...new Set(ids.filter((id) => Number.isFinite(id) && id > 0))]
  for (let i = 0; i < unique.length; i += CHUNK) {
    const { data, error } = await supabase
      .from('locations')
      .select('id, code, name')
      .in('id', unique.slice(i, i + CHUNK))
    if (error) throw error
    for (const row of (data ?? []) as Array<{ id: number; code: string; name: string | null }>) {
      out.set(row.id, { code: row.code, name: row.name })
    }
  }
  return out
}
