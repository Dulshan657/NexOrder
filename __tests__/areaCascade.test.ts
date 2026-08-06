import { describe, it, expect } from 'vitest'
import { planAreaCascade } from '@/supabase/functions/_shared/wie/areaPaint'
import {
  buildAreaIndex,
  type AreaCellSource,
  type NamingUnit,
} from '@/supabase/functions/_shared/wie/locationNaming'

// The name cascade when an area is PAINTED rather than renamed. Everything here
// is decided by assignAutoNames; planAreaCascade only works out which units moved
// and in which direction. These tests pin the two things that are genuinely new:
// which units are candidates at all, and that two groups landing in one pool
// cannot both keep the same number.

// ── helpers ─────────────────────────────────────────────────────────────────

/** Paint a rectangular area cell-by-cell, exactly as the designer does. */
function area(name: string, x: number, y: number, w = 1, h = 1, floor = 0): AreaCellSource[] {
  const cells: AreaCellSource[] = []
  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) {
      cells.push({ objectType: 'area', floor, x: x + dx, y: y + dy, w: 1, h: 1, meta: { name } })
    }
  }
  return cells
}

function rack(over: Partial<NamingUnit> & { ref: string; x: number }): NamingUnit {
  return {
    floor: 0,
    y: 0,
    w: 1,
    h: 1,
    nameIsAuto: true,
    nameSeq: null,
    nameArea: null,
    ...over,
  }
}

/** A row of N racks at y=0, already numbered in `pool` as 1..N. */
function numberedRow(count: number, pool: string, prefix = 'r'): NamingUnit[] {
  return Array.from({ length: count }, (_, i) =>
    rack({
      ref: `loc:${prefix}${i + 1}`,
      x: i,
      nameSeq: i + 1,
      nameArea: pool || null,
      name: pool ? `${pool} · Rack ${i + 1}` : `Rack ${i + 1}`,
    }),
  )
}

/** What the server loads from `locations`: pool → live numbers, and the max. */
function claimsFrom(units: readonly NamingUnit[]) {
  const high = new Map<string, number>()
  const claims = new Map<string, Set<number>>()
  for (const u of units) {
    if (u.nameSeq == null) continue
    const pool = (u.nameArea ?? '').trim()
    high.set(pool, Math.max(high.get(pool) ?? 0, u.nameSeq))
    const bucket = claims.get(pool) ?? new Set<number>()
    bucket.add(u.nameSeq)
    claims.set(pool, bucket)
  }
  return { high, claims }
}

function run(
  units: NamingUnit[],
  before: AreaCellSource[],
  after: AreaCellSource[],
  options: { includeCustom?: boolean } = {},
) {
  const { high, claims } = claimsFrom(units)
  return planAreaCascade(units, buildAreaIndex(before), buildAreaIndex(after), {
    ...options,
    minSeq: high,
    claims,
  })
}

const nameFor = (plan: ReturnType<typeof run>, ref: string): string | undefined =>
  plan.decided.get(ref)?.name

// ── adopting a prefix ───────────────────────────────────────────────────────

describe('planAreaCascade — painting an area over existing racks', () => {
  it('adopts the prefix on all 24 racks and preserves every number', () => {
    const units = numberedRow(24, '')
    const plan = run(units, [], area('Chiller', 0, 0, 24))

    expect(plan.decided.size).toBe(24)
    expect(plan.skippedCustom).toBe(0)
    expect(plan.skippedForeign).toBe(0)
    expect(nameFor(plan, 'loc:r1')).toBe('Chiller · Rack 1')
    expect(nameFor(plan, 'loc:r7')).toBe('Chiller · Rack 7')
    expect(nameFor(plan, 'loc:r24')).toBe('Chiller · Rack 24')
    for (const named of plan.decided.values()) {
      expect(named.areaName).toBe('Chiller')
      expect(named.assigned).toBe(false) // nothing was minted; every number was kept
    }
  })

  it('leaves racks alone when nothing moved under them', () => {
    const units = numberedRow(24, 'Chiller')
    const painted = area('Chiller', 0, 0, 24)
    const plan = run(units, painted, painted)
    expect(plan.decided.size).toBe(0)
  })

  it('is idempotent — replaying the same picture decides nothing', () => {
    const units = numberedRow(6, '')
    const after = area('Chiller', 0, 0, 6)
    const first = run(units, [], after)
    expect(first.decided.size).toBe(6)

    // Feed the first pass's answers back on, the way a save does, then replay.
    const settled = units.map((u) => {
      const named = first.decided.get(u.ref)!
      return { ...u, name: named.name, nameSeq: named.seq, nameArea: named.areaName }
    })
    expect(run(settled, after, after).decided.size).toBe(0)
  })
})

// ── stripping a prefix ──────────────────────────────────────────────────────

describe('planAreaCascade — erasing and shrinking', () => {
  it('strips the prefix on erase but KEEPS the number', () => {
    const units = numberedRow(8, 'Chiller')
    const plan = run(units, area('Chiller', 0, 0, 8), [])

    expect(plan.decided.size).toBe(8)
    expect(nameFor(plan, 'loc:r7')).toBe('Rack 7')
    for (const named of plan.decided.values()) {
      expect(named.areaName).toBe('')
      expect(named.seq).not.toBeNull()
    }
  })

  it('touches only the racks that fell out when an area shrinks', () => {
    const units = numberedRow(10, 'Chiller')
    const plan = run(units, area('Chiller', 0, 0, 10), area('Chiller', 0, 0, 5))

    expect(plan.decided.size).toBe(5)
    expect([...plan.decided.keys()].sort()).toEqual([
      'loc:r10', 'loc:r6', 'loc:r7', 'loc:r8', 'loc:r9',
    ])
    expect(nameFor(plan, 'loc:r6')).toBe('Rack 6')
    expect(nameFor(plan, 'loc:r1')).toBeUndefined()
  })
})

// ── the collision this feature exposes ──────────────────────────────────────

describe('planAreaCascade — number collisions when a boundary moves', () => {
  it('mints a fresh number rather than colliding with an untouched incumbent', () => {
    const mover = rack({ ref: 'loc:mover', x: 0, nameSeq: 3, nameArea: 'Bulk', name: 'Bulk · Rack 3' })
    const incumbent = rack({
      ref: 'loc:sitting', x: 10, nameSeq: 3, nameArea: 'Chiller', name: 'Chiller · Rack 3',
    })
    const before = [...area('Bulk', 0, 0), ...area('Chiller', 10, 0)]
    const after = [...area('Chiller', 0, 0), ...area('Chiller', 10, 0)]

    const plan = run([mover, incumbent], before, after)

    // The incumbent never moved, so it is not even a candidate.
    expect(plan.decided.has('loc:sitting')).toBe(false)
    // And the mover cannot keep 3 — two racks under one name is the exact thing
    // the numbering rule exists to prevent.
    expect(nameFor(plan, 'loc:mover')).toBe('Chiller · Rack 4')
    expect(plan.decided.get('loc:mover')!.assigned).toBe(true)
  })

  it('keeps the number when the target pool does not already hold it', () => {
    const mover = rack({ ref: 'loc:mover', x: 0, nameSeq: 3, nameArea: 'Bulk', name: 'Bulk · Rack 3' })
    const incumbent = rack({
      ref: 'loc:sitting', x: 10, nameSeq: 9, nameArea: 'Chiller', name: 'Chiller · Rack 9',
    })
    const before = [...area('Bulk', 0, 0), ...area('Chiller', 10, 0)]
    const after = [...area('Chiller', 0, 0), ...area('Chiller', 10, 0)]

    expect(nameFor(run([mover, incumbent], before, after), 'loc:mover')).toBe('Chiller · Rack 3')
  })

  it('does not let two groups landing in one pool both keep the same number', () => {
    // The failure a single assignAutoNames call would give for free and N calls
    // do not: neither mover is in the other's claims, so only the threading of
    // `landed` between groups catches it.
    const fromBulk = rack({ ref: 'loc:a', x: 0, nameSeq: 3, nameArea: 'Bulk', name: 'Bulk · Rack 3' })
    const fromCold = rack({ ref: 'loc:b', x: 1, nameSeq: 3, nameArea: 'Cold', name: 'Cold · Rack 3' })
    const before = [...area('Bulk', 0, 0), ...area('Cold', 1, 0)]
    const after = area('Chiller', 0, 0, 2)

    const plan = run([fromBulk, fromCold], before, after)
    const names = [nameFor(plan, 'loc:a'), nameFor(plan, 'loc:b')].sort()
    expect(names).toEqual(['Chiller · Rack 3', 'Chiller · Rack 4'])
    expect(new Set(names).size).toBe(2)
  })
})

// ── who is left alone, and why ──────────────────────────────────────────────

describe('planAreaCascade — what it refuses to touch', () => {
  it('skips a hand-named rack and counts it, unless the operator opts in', () => {
    const typed = rack({ ref: 'loc:typed', x: 0, nameIsAuto: false, name: 'Freezer bay' })
    const auto = rack({ ref: 'loc:auto', x: 1, nameSeq: 4, nameArea: '', name: 'Rack 4' })

    const plan = run([typed, auto], [], area('Chiller', 0, 0, 2))
    expect(plan.skippedCustom).toBe(1)
    expect(plan.decided.get('loc:typed')!.isAuto).toBe(false)
    expect(plan.decided.get('loc:typed')!.name).toBe('Freezer bay')
    expect(nameFor(plan, 'loc:auto')).toBe('Chiller · Rack 4')

    const opted = run([typed, auto], [], area('Chiller', 0, 0, 2), { includeCustom: true })
    expect(opted.skippedCustom).toBe(0)
    expect(opted.decided.get('loc:typed')!.isAuto).toBe(true)
    expect(opted.decided.get('loc:typed')!.name).toMatch(/^Chiller · Rack \d+$/)
  })

  it('never touches a hand-named rack outside the repainted region', () => {
    const typed = rack({ ref: 'loc:typed', x: 40, nameIsAuto: false, name: 'Freezer bay' })
    const moved = rack({ ref: 'loc:moved', x: 0, nameSeq: 1, nameArea: '', name: 'Rack 1' })

    const plan = run([typed, moved], [], area('Chiller', 0, 0, 2), { includeCustom: true })
    expect(plan.decided.has('loc:typed')).toBe(false)
    expect(plan.skippedCustom).toBe(0)
  })

  it('reports, and does not silently repair, a rack whose pool already disagreed', () => {
    // Painted over at some earlier point with the cascade declined: it carries
    // Chiller but sits in Bulk. This paint did not make it inconsistent.
    const foreign = rack({
      ref: 'loc:foreign', x: 0, nameSeq: 5, nameArea: 'Chiller', name: 'Chiller · Rack 5',
    })
    const plan = run([foreign], area('Bulk', 0, 0), area('Cold', 0, 0))

    expect(plan.skippedForeign).toBe(1)
    expect(plan.decided.size).toBe(0)
  })
})

// ── levels ──────────────────────────────────────────────────────────────────

describe('planAreaCascade — levelled racks', () => {
  it('composes a full name for every level of a moved rack', () => {
    const levelled = rack({
      ref: 'loc:rk', x: 0, nameSeq: 7, nameArea: '', name: 'Rack 7', levelIndexes: [1, 2, 3],
    })
    const plan = run([levelled], [], area('Chiller', 0, 0))

    const named = plan.decided.get('loc:rk')!
    expect(named.name).toBe('Chiller · Rack 7')
    expect(named.levelNames).toEqual({
      1: 'Chiller · Rack 7 · L1',
      2: 'Chiller · Rack 7 · L2',
      3: 'Chiller · Rack 7 · L3',
    })
  })

  it('emits no level names for a hand-named rack it declined to touch', () => {
    const typed = rack({
      ref: 'loc:rk', x: 0, nameIsAuto: false, name: 'Freezer bay', levelIndexes: [1, 2],
    })
    expect(run([typed], [], area('Chiller', 0, 0)).decided.get('loc:rk')!.levelNames).toEqual({})
  })
})

// ── straddling, and multi-floor pools ───────────────────────────────────────

describe('planAreaCascade — containment', () => {
  it('assigns a straddling rack to whichever area covers most of it', () => {
    const wide = rack({ ref: 'loc:wide', x: 0, w: 4, nameSeq: 1, nameArea: '', name: 'Rack 1' })
    const after = [...area('Chiller', 0, 0, 3), ...area('Bulk', 3, 0, 1)]
    expect(nameFor(run([wide], [], after), 'loc:wide')).toBe('Chiller · Rack 1')
  })

  it('shares one pool across floors', () => {
    const ground = rack({ ref: 'loc:g', x: 0, floor: 0 })
    const upper = rack({ ref: 'loc:u', x: 0, floor: 1 })
    const after = [...area('Chiller', 0, 0, 1, 1, 0), ...area('Chiller', 0, 0, 1, 1, 1)]

    const plan = run([ground, upper], [], after)
    const names = [nameFor(plan, 'loc:g'), nameFor(plan, 'loc:u')].sort()
    expect(names).toEqual(['Chiller · Rack 1', 'Chiller · Rack 2'])
  })

  it('honours numbers claimed by racks that have left the layout', () => {
    const fresh = rack({ ref: 'loc:new', x: 0 })
    const plan = planAreaCascade(
      [fresh],
      buildAreaIndex([]),
      buildAreaIndex(area('Chiller', 0, 0)),
      // A rack drawn, labelled and later deleted still holds Chiller 1..12.
      { minSeq: new Map([['Chiller', 12]]), claims: new Map([['Chiller', new Set([12])]]) },
    )
    expect(nameFor(plan, 'loc:new')).toBe('Chiller · Rack 13')
  })
})
