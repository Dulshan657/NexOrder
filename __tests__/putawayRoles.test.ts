import { describe, it, expect } from 'vitest'
import { resolvePutawayRoles } from '@/supabase/functions/_shared/putawayTasks'

// Level-role routing by handling-unit type (mig 00072 roles + 00075 plates).
// The SKU rule is HARD (enforced in wie_putaway_candidates' WHERE clause); the
// plate type is a preference layered on top.

describe('resolvePutawayRoles', () => {
  it('leaves an unplated line unconstrained', () => {
    expect(resolvePutawayRoles(null, undefined)).toBeNull()
  })

  it('preserves the SKU rule when there is no plate', () => {
    expect(resolvePutawayRoles(['pick'], undefined)).toEqual(['pick'])
  })

  it('sends a pallet to bulk and reserve levels', () => {
    expect(resolvePutawayRoles(null, 'pallet')).toEqual(['bulk', 'reserve'])
  })

  it('sends a carton to the pick face', () => {
    expect(resolvePutawayRoles(null, 'carton')).toEqual(['pick'])
  })

  it('intersects the SKU rule with the plate preference', () => {
    // SKU may live on reserve or pick; it arrived on a pallet -> reserve only.
    expect(resolvePutawayRoles(['reserve', 'pick'], 'pallet')).toEqual(['reserve'])
  })

  it('falls back to the SKU rule when the intersection is empty', () => {
    // A pick-face-only SKU that arrives on a pallet must NOT end up with an
    // empty candidate set — that would wedge the queue with nowhere to go.
    expect(resolvePutawayRoles(['pick'], 'pallet')).toEqual(['pick'])
  })

  it('treats an empty SKU role list as unconstrained', () => {
    expect(resolvePutawayRoles([], 'carton')).toEqual(['pick'])
  })

  it('never returns an empty array', () => {
    const cases: Array<[string[] | null, 'pallet' | 'carton' | undefined]> = [
      [null, 'pallet'],
      [['pick'], 'pallet'],
      [['bulk'], 'carton'],
      [[], 'pallet'],
    ]
    for (const [sku, hu] of cases) {
      const out = resolvePutawayRoles(sku as never, hu)
      expect(out === null || out.length > 0).toBe(true)
    }
  })
})
