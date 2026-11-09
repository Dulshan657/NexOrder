// Is a bin in a HOLD (quarantine) zone? (mig 00101)
//
// The nearest ZONE ancestor by materialized path decides, and its zone profile's
// `is_hold` is the answer. That is the rule wie_putaway_candidates applies and
// the one wie_home_block uses for a home's eligibility, so a bin putaway calls
// held is the bin these callers call held. The ancestors are read from the
// path's own prefixes, so no reversed LIKE is needed over PostgREST.
//
// Shared by decide-putaway (a redirect may not move a held line out of hold, or
// an ordinary line into it) and complete-putaway (a held line may not make a
// home, NX-0033 I1). Fails closed: a read error throws, it is never "not held".
//
// No Deno and no URL imports, so the browser-side tests can load it.

// deno-lint-ignore-file no-explicit-any

/** True when `locationId`'s nearest ZONE ancestor has a hold zone profile. */
export async function binIsHold(admin: any, locationId: number): Promise<boolean> {
  const { data: loc, error: locErr } = await admin.from('locations')
    .select('materialized_path').eq('id', locationId).maybeSingle()
  if (locErr) throw new Error(`hold check: location ${locationId}: ${locErr.message}`)
  const segments = String(loc?.materialized_path ?? '').split('/').filter(Boolean)
  const prefixes = segments.slice(0, -1).map((_, i) => segments.slice(0, i + 1).join('/'))
  if (prefixes.length === 0) return false
  const { data: zones, error: zoneErr } = await admin.from('locations')
    .select('materialized_path, zone_profiles(is_hold)').eq('kind', 'ZONE').in('materialized_path', prefixes)
  if (zoneErr) throw new Error(`hold check: zones of ${locationId}: ${zoneErr.message}`)
  const nearest = ((zones ?? []) as any[])
    .sort((a, b) => String(b.materialized_path).length - String(a.materialized_path).length)[0]
  return nearest?.zone_profiles?.is_hold === true
}

/** The bin a putaway line is headed for: the assigned bin, else the suggested one. */
export function lineBinId(rec: {
  assigned_location_id?: number | null
  recommended_location_id?: number | null
}): number | null {
  return rec.assigned_location_id ?? rec.recommended_location_id ?? null
}

/** Is any of these lines headed for a hold bin? Each distinct bin is read once. */
export async function anyLineHeld(
  admin: any,
  recs: ReadonlyArray<{ assigned_location_id?: number | null; recommended_location_id?: number | null }>,
): Promise<boolean> {
  const binIds = [...new Set(recs.map(lineBinId).filter((id): id is number => id != null))]
  const held = await Promise.all(binIds.map((id) => binIsHold(admin, id)))
  return held.some(Boolean)
}
