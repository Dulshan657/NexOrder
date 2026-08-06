// Server-side I/O for zone binding (mig 00096).
//
// Deliberately OUTSIDE _shared/wie/: that directory is under the purity contract
// (__tests__/wie/purity.test.ts) and may not perform I/O. The rule lives in the
// pure wie/zoneBinding.ts; this is only where the ZONE rows come from and where
// the re-parent goes back.
//
// Same shape as _shared/locationNamingWrite.ts beside _shared/wie/locationNaming.ts,
// and _shared/levelRoleLookup.ts beside _shared/wie/levelRoles.ts.

// deno-lint-ignore-file no-explicit-any
import { type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.103.0'
import { EdgeFunctionError } from './errors.ts'
import { type ReparentMove, type ZoneRow } from './wie/zoneBinding.ts'

/** supabase-js `.in()` list size. Matches locationNamingWrite's chunking. */
const CHUNK = 200

/**
 * Find-or-create a warehouse's ZONE location for a zone profile.
 *
 * Lifted VERBATIM out of mutate-layout's save_geometry, where it was the only
 * thing that had ever created a ZONE row. It is shared now because
 * mutate-warehouse-location binds too, and two find-or-create implementations
 * racing on the same (warehouse, profile) pair is exactly how you end up with two
 * ZONE rows and a LATERAL that picks whichever has the longer path.
 *
 * ONE ZONE PER (WAREHOUSE, PROFILE), not per area. Two areas both tagged Cold
 * share `<WH>-Z4 "Cold Storage"`. That keeps the zone's CODE derived and stable —
 * and a code is a materialized_path segment, so a per-area zone would make
 * renaming an area rewrite the zone's path and every descendant's with it, a
 * second and harder path rewrite on top of the one binding already performs.
 *
 * The returned closure caches per call, so a 189-bay warehouse resolves each
 * profile once rather than once per rack.
 */
export function makeZoneResolver(
  admin: SupabaseClient,
  warehouse: { id: number; path: string; code: string },
): (profileId: number) => Promise<ZoneRow> {
  const zoneCache = new Map<number, ZoneRow>()

  return async function resolveZone(profileId: number): Promise<ZoneRow> {
    const cached = zoneCache.get(profileId)
    if (cached) return cached
    // Scoped find — kind + profile + this warehouse's subtree (used for both the
    // initial lookup and the race-recovery re-read, so we never adopt a stray row).
    const findZone = () => admin.from('locations')
      .select('id, materialized_path')
      .eq('kind', 'ZONE').eq('zone_profile_id', profileId)
      .like('materialized_path', `${warehouse.path}/%`).limit(1).maybeSingle()

    const { data: existing } = await findZone()
    if (existing) {
      const z = { id: (existing as any).id, path: (existing as any).materialized_path }
      zoneCache.set(profileId, z)
      return z
    }
    const { data: profile, error: profErr } = await admin
      .from('zone_profiles').select('name').eq('id', profileId).single()
    if (profErr || !profile) {
      throw new EdgeFunctionError('INVALID_INPUT', `Unknown zone profile ${profileId}`)
    }
    const zoneCode = `${warehouse.code}-Z${profileId}`
    const { data: created, error } = await admin.from('locations').insert({
      parent_id: warehouse.id, kind: 'ZONE', code: zoneCode,
      name: (profile as any).name ?? `Zone ${profileId}`,
      materialized_path: `${warehouse.path}/${zoneCode}`, zone_profile_id: profileId, is_active: true,
    } as any).select('id, materialized_path').single()
    if (error || !created) {
      // Lost a race — re-run the SCOPED find (not a by-code read, which could
      // otherwise adopt an unrelated location that happens to share the code).
      const { data: reread } = await findZone()
      if (!reread) throw new EdgeFunctionError('INTERNAL', error?.message ?? 'Failed to create zone')
      const z = { id: (reread as any).id, path: (reread as any).materialized_path }
      zoneCache.set(profileId, z)
      return z
    }
    const z = { id: (created as any).id, path: (created as any).materialized_path }
    zoneCache.set(profileId, z)
    return z
  }
}

/** Resolve every profile a plan needs, in one pass. */
export async function resolveZones(
  resolveZone: (profileId: number) => Promise<ZoneRow>,
  profileIds: readonly number[],
): Promise<Map<number, ZoneRow>> {
  const out = new Map<number, ZoneRow>()
  for (const id of profileIds) out.set(id, await resolveZone(id))
  return out
}

/**
 * Apply a batch of re-parents atomically.
 *
 * One statement, not N updates, for the same two reasons applyNameWrites gives:
 * a 189-bay warehouse is 1134 rows, which does not fit inside the 20s fetch
 * ceiling as round trips — and, more importantly, a half-written path set is a
 * corrupt tree. Bins whose path no longer starts with the warehouse's fall out of
 * getWarehouseLocations' LIKE '<wh>/%' AND out of wie_putaway_candidates at the
 * same moment, which renders as an all-grey map over an empty Locations tree with
 * no loading flag to hide behind.
 *
 * `warehousePath` is the RPC's scope backstop. Every caller has already checked
 * its ids, but those ids came from client-supplied geometry and the UPDATE must
 * not be the first operation to take that on trust.
 */
export async function applyReparents(
  admin: SupabaseClient,
  warehousePath: string,
  rows: readonly ReparentMove[],
): Promise<number> {
  if (rows.length === 0) return 0
  const { data, error } = await admin.rpc('wie_reparent_locations_tx', {
    p_warehouse_path: warehousePath,
    p_rows: rows,
  })
  if (error) {
    throw new EdgeFunctionError('INTERNAL', `Could not bind the locations to their zones: ${error.message}`)
  }
  return Number(data ?? 0)
}

/**
 * `zone_profiles.allowed_categories` for the given profiles.
 *
 * NULL (or absent) means "any category" and can never conflict — see
 * zoneBinding.categoryConflicts, which treats an empty list the same way.
 */
export async function loadAllowedCategories(
  admin: SupabaseClient,
  profileIds: readonly number[],
): Promise<Map<number, string[] | null>> {
  const out = new Map<number, string[] | null>()
  if (profileIds.length === 0) return out
  const { data, error } = await admin
    .from('zone_profiles').select('id, allowed_categories').in('id', [...new Set(profileIds)])
  if (error) {
    throw new EdgeFunctionError('INTERNAL', `Could not read zone profiles: ${error.message}`)
  }
  for (const row of (data ?? []) as any[]) {
    const raw = (row as any).allowed_categories
    out.set(Number(row.id), Array.isArray(raw) ? raw.map((c: unknown) => String(c)) : null)
  }
  return out
}

/**
 * The product categories currently stocked in each of the given locations.
 *
 * Read-only, and only ever used to WARN. A levelled rack's stock sits on its
 * SHELF rows, so the caller passes the level ids alongside the rack ids and maps
 * the answer back — the rack itself holds no balance row.
 */
export async function loadStockedCategories(
  admin: SupabaseClient,
  locationIds: readonly number[],
): Promise<Map<number, string[]>> {
  const out = new Map<number, string[]>()
  const unique = [...new Set(locationIds.filter((id) => Number.isFinite(id) && id > 0))]
  for (let i = 0; i < unique.length; i += CHUNK) {
    const { data, error } = await admin
      .from('inventory_balances')
      .select('location_id, products(category)')
      .gt('on_hand', 0)
      .in('location_id', unique.slice(i, i + CHUNK))
    if (error) {
      throw new EdgeFunctionError('INTERNAL', `Could not read stocked categories: ${error.message}`)
    }
    for (const row of (data ?? []) as any[]) {
      const category = row.products?.category
      if (typeof category !== 'string' || !category) continue
      const id = Number(row.location_id)
      const bucket = out.get(id) ?? []
      if (!bucket.includes(category)) bucket.push(category)
      out.set(id, bucket)
    }
  }
  return out
}
