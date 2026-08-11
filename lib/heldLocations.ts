// Which locations are HELD (mig 00101), client-side.
//
// The authority is `v_held_locations`, which allocation and the putaway
// candidate loader both read — but that view is service_role-only (00102), so
// the browser cannot query it. This recomputes the SAME rule from data the
// warehouse views already hold: a location is held when a `kind: 'ZONE'`
// ancestor's zone profile says `isHold`.
//
// Deliberately the same test the server uses — prefix-matching
// `materializedPath` with an explicit separator, so `/MAIN/COLDE` cannot swallow
// `/MAIN/COLD` — because a bin the UI calls held and allocation does not is
// worse than either answer alone.
//
// Pure, no React, no I/O.

import type { InventoryLocation, ZoneProfile } from '@/types'

/**
 * The ids of every location standing under a hold zone.
 *
 * A Set rather than a predicate: the map, the tree and the detail panel all ask
 * this about many locations per render, and the alternative is an O(zones) walk
 * per bin per frame.
 *
 * Note the ZONE row itself is included. Nothing puts stock directly on a zone
 * today, but if anything ever does, it is held — the same reason the server's
 * view matches the zone's own path as well as its descendants.
 */
export function buildHeldLocationIds(
  locations: readonly InventoryLocation[],
  zoneProfiles: readonly ZoneProfile[],
): Set<number> {
  const holdProfileIds = new Set<number>()
  for (const p of zoneProfiles) if (p.isHold) holdProfileIds.add(p.id)
  if (holdProfileIds.size === 0) return new Set()

  const holdZonePaths: string[] = []
  for (const l of locations) {
    if (l.kind !== 'ZONE') continue
    if (l.zoneProfileId != null && holdProfileIds.has(l.zoneProfileId)) {
      holdZonePaths.push(l.materializedPath)
    }
  }
  if (holdZonePaths.length === 0) return new Set()

  const held = new Set<number>()
  for (const l of locations) {
    const path = l.materializedPath ?? ''
    for (const zonePath of holdZonePaths) {
      if (path === zonePath || path.startsWith(`${zonePath}/`)) {
        held.add(l.id)
        break
      }
    }
  }
  return held
}
