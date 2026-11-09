// NX-0033 I1: which putaway lines are held. A line is held when the bin it is
// headed for (assigned, else suggested) sits under a hold zone, judged by the
// NEAREST zone ancestor, the rule putaway and the home rule already use.

import { describe, expect, it } from 'vitest'
import { anyLineHeld, binIsHold, lineBinId } from '../supabase/functions/_shared/holdBins'

interface Loc { id: number; kind: string; materialized_path: string; is_hold?: boolean }

const LOCS: Loc[] = [
  { id: 1, kind: 'WAREHOUSE', materialized_path: 'WH' },
  { id: 2, kind: 'ZONE', materialized_path: 'WH/QZ', is_hold: true },
  { id: 3, kind: 'BIN', materialized_path: 'WH/QZ/Q1' },
  { id: 4, kind: 'ZONE', materialized_path: 'WH/PZ', is_hold: false },
  { id: 5, kind: 'BIN', materialized_path: 'WH/PZ/P1' },
  // An ordinary zone nested inside a hold zone: the nearest zone decides.
  { id: 6, kind: 'ZONE', materialized_path: 'WH/QZ/INNER', is_hold: false },
  { id: 7, kind: 'BIN', materialized_path: 'WH/QZ/INNER/I1' },
  { id: 8, kind: 'BIN', materialized_path: 'WH/LOOSE' },
]

/** The two PostgREST reads binIsHold makes, answered from LOCS. */
function stubAdmin(o: { fail?: 'location' | 'zones' } = {}) {
  return {
    from: () => ({
      select: (cols: string) => {
        const filters: Array<(l: Loc) => boolean> = []
        const b: any = {
          eq: (col: keyof Loc, v: unknown) => { filters.push((l) => l[col] === v); return b },
          in: (col: keyof Loc, vs: unknown[]) => { filters.push((l) => vs.includes(l[col])); return b },
          maybeSingle: async () => o.fail === 'location'
            ? { data: null, error: { message: 'boom' } }
            : { data: LOCS.find((l) => filters.every((f) => f(l))) ?? null, error: null },
          then: (res: (v: unknown) => unknown) => Promise.resolve(o.fail === 'zones'
            ? { data: null, error: { message: 'boom' } }
            : {
              data: LOCS.filter((l) => filters.every((f) => f(l))).map((l) => ({
                materialized_path: l.materialized_path,
                ...(cols.includes('zone_profiles') ? { zone_profiles: { is_hold: l.is_hold === true } } : {}),
              })),
              error: null,
            }).then(res),
        }
        return b
      },
    }),
  }
}

describe('binIsHold', () => {
  it('is true for a bin under a hold zone, false under an ordinary zone or none', async () => {
    const admin = stubAdmin()
    expect(await binIsHold(admin, 3)).toBe(true)
    expect(await binIsHold(admin, 5)).toBe(false)
    expect(await binIsHold(admin, 8)).toBe(false)
  })

  it('goes by the nearest zone, as putaway does', async () => {
    expect(await binIsHold(stubAdmin(), 7)).toBe(false)
  })

  it('fails closed: a read error throws rather than answering "not held"', async () => {
    await expect(binIsHold(stubAdmin({ fail: 'location' }), 3)).rejects.toThrow(/hold check/)
    await expect(binIsHold(stubAdmin({ fail: 'zones' }), 3)).rejects.toThrow(/hold check/)
  })
})

describe('lineBinId', () => {
  it('is the assigned bin, else the suggested one, else null', () => {
    expect(lineBinId({ assigned_location_id: 3, recommended_location_id: 5 })).toBe(3)
    expect(lineBinId({ assigned_location_id: null, recommended_location_id: 5 })).toBe(5)
    expect(lineBinId({ assigned_location_id: null, recommended_location_id: null })).toBeNull()
  })
})

describe('anyLineHeld', () => {
  it('is true when any line is headed for a hold bin', async () => {
    const admin = stubAdmin()
    expect(await anyLineHeld(admin, [
      { assigned_location_id: null, recommended_location_id: 5 },
      { assigned_location_id: 3, recommended_location_id: 5 },
    ])).toBe(true)
    expect(await anyLineHeld(admin, [{ assigned_location_id: 5, recommended_location_id: 3 }])).toBe(false)
    expect(await anyLineHeld(admin, [{ assigned_location_id: null, recommended_location_id: null }])).toBe(false)
  })
})
