// Colours for zone regions on the map, keyed by `zone_profiles.zone_type`.
//
// WHY A CLIENT-SIDE TABLE. `zone_profiles` (mig 00047) has no colour column, and
// mig 00057 dropped the `zone_type` CHECK so operators can invent their own
// types. That leaves two options: add a column, or map the known vocabulary here
// and degrade gracefully for anything else. This is the second — a zone tint is
// pure decoration on a read-only map, so it does not justify a schema change or
// another field for an operator to fill in.
//
// These are UNDER-layer colours. They sit beneath the bins and must never
// compete with an overlay fill, which is the layer carrying the actual numbers —
// hence ZONE_FILL_OPACITY, applied by the renderer rather than baked in.

/** Zone fills are washes, not blocks: the bins on top must stay legible. */
export const ZONE_FILL_OPACITY = 0.12
/** The boundary is what makes the area readable; it can be far more present. */
export const ZONE_STROKE_OPACITY = 0.55

/** Neutral stone for an operator-invented zone type we have no colour for. */
const FALLBACK_TINT = '#78716c'

// Deliberately spread around the wheel so two adjacent zones never read as one
// at 12% opacity. `cold` matches the seeded COLD_ROOM storage form (#0ea5e9,
// mig 00061) so the room and its racks agree.
const ZONE_TYPE_TINT: Record<string, string> = {
  cold: '#0ea5e9', // sky-500
  fast_moving: '#f43f5e', // rose-500
  slow_moving: '#8b5cf6', // violet-500
  hazardous: '#f97316', // orange-500
  bulk: '#d97706', // amber-600
  returns: '#14b8a6', // teal-500
  quarantine: '#dc2626', // red-600
  overflow: '#65a30d', // lime-600
}

/** Tint for a `zone_profiles.zone_type`; neutral for unknown/absent types. */
export function zoneTint(zoneType: string | null | undefined): string {
  if (!zoneType) return FALLBACK_TINT
  return ZONE_TYPE_TINT[zoneType] ?? FALLBACK_TINT
}

/** Is this a type we have a real colour for? Lets the legend list only the
 *  zone types actually present, rather than all eight every time. */
export function hasZoneTint(zoneType: string | null | undefined): boolean {
  return !!zoneType && zoneType in ZONE_TYPE_TINT
}

/** `zone_type` → a human label, for the legend. Falls back to the raw type so an
 *  operator-invented one still reads as itself rather than "Unknown". */
export function zoneTypeLabel(zoneType: string | null | undefined): string {
  if (!zoneType) return 'Unzoned'
  const known: Record<string, string> = {
    cold: 'Cold',
    fast_moving: 'Fast movers',
    slow_moving: 'Slow movers',
    hazardous: 'Hazardous',
    bulk: 'Bulk',
    returns: 'Returns',
    quarantine: 'Quarantine',
    overflow: 'Overflow',
  }
  return known[zoneType] ?? zoneType
}
