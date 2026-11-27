// What is already in each location of a warehouse, for the one-product-per-
// location rule (NX-0049, _shared/wie/locationMix.ts).
//
// Two things occupy a location: stock on hand there, and open putaway lines
// (suggested or assigned) already headed there. wie_location_occupants (mig
// 00151) returns both, for the whole warehouse, in one read -- so the planner
// reads it once, before it inserts its first task (as with the home reads,
// NX-0032: a read that fails mid-receipt would leave the earlier lines' tasks
// behind, and the Retry would put them in twice).
//
// A SAFETY gate, so it fails CLOSED: reading "empty" on a failed read would
// send a second product into a location the floor would then be refused.

import { type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.103.0'
import type { LocationOccupant } from './wie/locationMix.ts'

export interface OccupantRow {
  location_id: number
  product_id: number
  sku: string | null
  name: string | null
  brand: string | null
  handling_unit_id: number | null
  /** The open putaway line, when the row is one; null for stock on hand. */
  rec_id: number | null
}

/** Occupants by location id. Throws on a read failure. */
export async function loadWarehouseOccupants(
  admin: SupabaseClient,
  warehouseId: number,
): Promise<Map<number, LocationOccupant[]>> {
  const { data, error } = await admin.rpc('wie_location_occupants', { p_warehouse_id: warehouseId })
  if (error) throw new Error(`location contents load failed: ${error.message}`)
  return groupOccupants((data ?? []) as OccupantRow[])
}

/** Group rows by location, leaving out the named putaway lines (the ones being placed). */
export function groupOccupants(
  rows: readonly OccupantRow[],
  excludeRecIds: readonly number[] = [],
): Map<number, LocationOccupant[]> {
  const skip = new Set(excludeRecIds)
  const out = new Map<number, LocationOccupant[]>()
  for (const r of rows) {
    if (r.rec_id != null && skip.has(Number(r.rec_id))) continue
    const loc = Number(r.location_id)
    const o: LocationOccupant = {
      productId: Number(r.product_id),
      sku: r.sku ?? String(r.product_id),
      name: r.name ?? '',
      brand: r.brand ?? null,
      handlingUnitId: r.handling_unit_id != null ? Number(r.handling_unit_id) : null,
    }
    out.set(loc, [...(out.get(loc) ?? []), o])
  }
  return out
}
