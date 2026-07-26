import { describe, it, expect } from 'vitest'
import { resolvePutawayRoles } from '@/supabase/functions/_shared/putawayTasks'
import { FALLBACK_LEVEL_ROLES } from '@/lib/levelRoles'
import type { LevelRoleRecord } from '@/lib/levelRoles'

// Level-role routing by handling-unit type (mig 00072 roles + 00075 plates,
// operator-managed since 00081). The SKU rule is HARD (enforced in
// wie_putaway_candidates' WHERE clause); the plate type is a preference layered
// on top, and which roles claim which plate type is now DATA rather than the old
// hardcoded ROLES_BY_HU_TYPE map.
//
// FALLBACK_LEVEL_ROLES mirrors 00081's seed, so these cases assert the same
// routing the hardcoded map used to give: pallet -> bulk/reserve, carton -> pick.

const ROLES = FALLBACK_LEVEL_ROLES

describe('resolvePutawayRoles', () => {
  it('leaves an unplated line unconstrained', () => {
    expect(resolvePutawayRoles(null, undefined, ROLES)).toBeNull()
  })

  it('preserves the SKU rule when there is no plate', () => {
    expect(resolvePutawayRoles(['pick'], undefined, ROLES)).toEqual(['pick'])
  })

  it('sends a pallet to bulk and reserve levels', () => {
    // Order follows sort_order (reserve 20 before bulk 30), not the old literal
    // array. Membership is all that matters — the only consumer is SQL's
    // `level_role = ANY(p_roles)` — so this asserts the set.
    expect(new Set(resolvePutawayRoles(null, 'pallet', ROLES))).toEqual(
      new Set(['reserve', 'bulk']),
    )
  })

  it('sends a carton to the pick zone', () => {
    expect(resolvePutawayRoles(null, 'carton', ROLES)).toEqual(['pick'])
  })

  it('intersects the SKU rule with the plate preference', () => {
    // SKU may live on reserve or pick; it arrived on a pallet -> reserve only.
    expect(resolvePutawayRoles(['reserve', 'pick'], 'pallet', ROLES)).toEqual(['reserve'])
  })

  it('falls back to the SKU rule when the intersection is empty', () => {
    // A pick-zone-only SKU that arrives on a pallet must NOT end up with an
    // empty candidate set — that would wedge the queue with nowhere to go.
    expect(resolvePutawayRoles(['pick'], 'pallet', ROLES)).toEqual(['pick'])
  })

  it('treats an empty SKU role list as unconstrained', () => {
    expect(resolvePutawayRoles([], 'carton', ROLES)).toEqual(['pick'])
  })

  it('never returns an empty array', () => {
    const cases: Array<[string[] | null, 'pallet' | 'carton' | undefined]> = [
      [null, 'pallet'],
      [['pick'], 'pallet'],
      [['bulk'], 'carton'],
      [[], 'pallet'],
    ]
    for (const [sku, hu] of cases) {
      const out = resolvePutawayRoles(sku as never, hu, ROLES)
      expect(out === null || out.length > 0).toBe(true)
    }
  })

  // ── The routing is data now, not code ──────────────────────────────────────

  it('follows an operator who reassigns a plate type to another role', () => {
    // Reserve stops accepting pallets; Bulk becomes the only pallet home.
    const edited: LevelRoleRecord[] = ROLES.map((r) =>
      r.key === 'reserve' ? { ...r, huTypes: [] } : r,
    )
    expect(resolvePutawayRoles(null, 'pallet', edited)).toEqual(['bulk'])
  })

  it('routes to an operator-created role that claims the plate type', () => {
    const withQuarantine: LevelRoleRecord[] = [
      ...ROLES,
      {
        key: 'quarantine',
        displayName: 'Quarantine',
        description: null,
        colorFill: '#fecaca',
        colorStroke: '#dc2626',
        colorText: null,
        sortOrder: 40,
        huTypes: ['carton'],
        isPickZone: false,
        replenSourceRank: null,
        isSystem: false,
        isActive: true,
      },
    ]
    expect(new Set(resolvePutawayRoles(null, 'carton', withQuarantine))).toEqual(
      new Set(['pick', 'quarantine']),
    )
  })

  it('ignores a deactivated role', () => {
    const deactivated: LevelRoleRecord[] = ROLES.map((r) =>
      r.key === 'reserve' ? { ...r, isActive: false } : r,
    )
    expect(resolvePutawayRoles(null, 'pallet', deactivated)).toEqual(['bulk'])
  })

  it('falls back to the SKU rule when no role claims the plate type', () => {
    // An empty vocabulary must read as "no preference", never as "nowhere is
    // allowed" — otherwise a failed role load would wedge every receipt.
    expect(resolvePutawayRoles(['bulk'], 'pallet', [])).toEqual(['bulk'])
    expect(resolvePutawayRoles(null, 'pallet', [])).toBeNull()
  })
})
