// The browser's copy of "is this bin held" (mig 00101/00102).
//
// v_held_locations is service_role-only, so the UI recomputes the rule. These
// pin the two things that must match the SQL: the prefix test's separator, and
// the fact that the flag comes from the PROFILE rather than from zone_type.

import { describe, expect, it } from 'vitest'
import { buildHeldLocationIds } from '../lib/heldLocations'
import type { InventoryLocation, ZoneProfile } from '../types'

const profile = (over: Partial<ZoneProfile> & { id: number }): ZoneProfile => ({
  name: 'Zone', zoneType: 'bulk', priorityWeight: 0.5, isActive: true, isHold: false, ...over,
})

const loc = (over: Partial<InventoryLocation> & { id: number; materializedPath: string }): InventoryLocation => ({
  code: `L${over.id}`, name: `L${over.id}`, kind: 'BIN', isActive: true, ...over,
} as InventoryLocation)

const HOLD = profile({ id: 8, name: 'Quarantine', zoneType: 'quarantine', isHold: true })
const OPEN = profile({ id: 3, name: 'Bulk Storage', zoneType: 'bulk' })

describe('buildHeldLocationIds', () => {
  it('holds a bin under a hold zone, and the zone itself', () => {
    const held = buildHeldLocationIds([
      loc({ id: 1, kind: 'ZONE', materializedPath: 'AMD/AMD-Z8', zoneProfileId: 8 }),
      loc({ id: 2, materializedPath: 'AMD/AMD-Z8/AMD-B-1-6' }),
    ], [HOLD])
    expect(held).toEqual(new Set([1, 2]))
  })

  it('leaves a bin under an ordinary zone alone', () => {
    const held = buildHeldLocationIds([
      loc({ id: 1, kind: 'ZONE', materializedPath: 'AMD/AMD-Z3', zoneProfileId: 3 }),
      loc({ id: 2, materializedPath: 'AMD/AMD-Z3/AMD-B-2-2' }),
    ], [OPEN, HOLD])
    expect(held.size).toBe(0)
  })

  // The reason the SQL appends '/' rather than matching a bare prefix.
  it('does not let one zone swallow another whose code extends it', () => {
    const held = buildHeldLocationIds([
      loc({ id: 1, kind: 'ZONE', materializedPath: 'AMD/COLD', zoneProfileId: 8 }),
      loc({ id: 2, materializedPath: 'AMD/COLDE/AMD-B-1-1' }),
    ], [HOLD])
    expect(held.has(2)).toBe(false)
  })

  // zone_type is free text an operator can invent (00057 dropped the CHECK), so
  // the word must never be the test.
  it('reads the profile flag, not the zone type', () => {
    const namedButOpen = profile({ id: 9, name: 'Quarantine', zoneType: 'quarantine', isHold: false })
    const held = buildHeldLocationIds([
      loc({ id: 1, kind: 'ZONE', materializedPath: 'AMD/AMD-Z9', zoneProfileId: 9 }),
      loc({ id: 2, materializedPath: 'AMD/AMD-Z9/AMD-B-9-9' }),
    ], [namedButOpen])
    expect(held.size).toBe(0)
  })

  it('is empty — and cheap — when no profile holds anything', () => {
    const held = buildHeldLocationIds([
      loc({ id: 1, kind: 'ZONE', materializedPath: 'AMD/AMD-Z3', zoneProfileId: 3 }),
      loc({ id: 2, materializedPath: 'AMD/AMD-Z3/AMD-B-2-2' }),
    ], [OPEN])
    expect(held.size).toBe(0)
  })

  it('ignores a zone with no profile at all', () => {
    const held = buildHeldLocationIds([
      loc({ id: 1, kind: 'ZONE', materializedPath: 'AMD/AMD-Z1' }),
      loc({ id: 2, materializedPath: 'AMD/AMD-Z1/AMD-B-1-1' }),
    ], [HOLD])
    expect(held.size).toBe(0)
  })
})
