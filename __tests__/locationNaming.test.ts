import { describe, it, expect } from 'vitest'
import {
  NAME_SEP,
  MAX_AREA_NAME,
  areaForRect,
  areaNameAt,
  areaNameAtIndexed,
  areaNameIssue,
  areaNameOf,
  assignAutoNames,
  buildAreaIndex,
  composeName,
  unitNoun,
  describeSeqRanges,
  highWaterFromRows,
  isUninformativeName,
  nextSeqForArea,
  restampNames,
  sanitizeAreaName,
  type AreaCellSource,
  type NamingUnit,
} from '@/supabase/functions/_shared/wie/locationNaming'

// ── helpers ─────────────────────────────────────────────────────────────────

/** Paint a rectangular area, cell-by-cell, exactly as the designer does. */
function area(name: string, x: number, y: number, w = 1, h = 1, floor = 0): AreaCellSource[] {
  const cells: AreaCellSource[] = []
  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) {
      cells.push({ objectType: 'area', floor, x: x + dx, y: y + dy, w: 1, h: 1, meta: { name } })
    }
  }
  return cells
}

function unit(over: Partial<NamingUnit> & { ref: string; x: number; y: number }): NamingUnit {
  return {
    floor: 0,
    w: 1,
    h: 1,
    nameIsAuto: true,
    nameSeq: null,
    nameArea: null,
    ...over,
  }
}

/** Run a pass and feed its answers back onto the units, the way a save does. */
function settle(units: NamingUnit[], objects: AreaCellSource[]): NamingUnit[] {
  const result = assignAutoNames(units, buildAreaIndex(objects))
  return units.map((u) => {
    const named = result.units.find((n) => n.ref === u.ref)!
    return { ...u, name: named.name, nameSeq: named.seq, nameArea: named.areaName }
  })
}

const nameOf = (units: NamingUnit[], objects: AreaCellSource[], ref: string): string =>
  assignAutoNames(units, buildAreaIndex(objects)).units.find((u) => u.ref === ref)!.name

/** Deterministic shuffle — no Math.random, so a failure is reproducible. */
function shuffle<T>(items: readonly T[], seed: number): T[] {
  const out = [...items]
  let state = seed
  for (let i = out.length - 1; i > 0; i--) {
    state = (state * 1103515245 + 12345) & 0x7fffffff
    const j = state % (i + 1)
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

// ── composition ─────────────────────────────────────────────────────────────

describe('composeName', () => {
  it('composes a rack, and a level, inside an area', () => {
    expect(composeName('Chiller', 7)).toBe('Chiller · Rack 7')
    expect(composeName('Chiller', 7, 4)).toBe('Chiller · Rack 7 · L4')
  })

  it('drops the area part when a rack sits outside every area', () => {
    expect(composeName('', 12)).toBe('Rack 12')
    expect(composeName('   ', 12, 2)).toBe('Rack 12 · L2')
  })

  it('never emits the code separator', () => {
    expect(composeName('Cold Room', 3, 1)).not.toMatch(/-/)
    expect(NAME_SEP).not.toContain('-')
  })

  it('composes with the noun it is given (mig 00100)', () => {
    expect(composeName('Bulk Storage', 3, null, 'Pallet')).toBe('Bulk Storage · Pallet 3')
    expect(composeName('', 3, null, 'Pallet')).toBe('Pallet 3')
    // A floor spot has no levels, but the composition must still agree if one
    // is ever asked for — a level named after a different noun than its parent
    // is the bug this parameter exists to prevent.
    expect(composeName('Bulk Storage', 3, 1, 'Pallet')).toBe('Bulk Storage · Pallet 3 · L1')
  })

  it('stays inside the 120-char cap on locations.name at the extremes', () => {
    const longest = composeName('x'.repeat(MAX_AREA_NAME), 999, 99)
    expect(longest.length).toBeLessThanOrEqual(120)
  })
})

// A unit's noun follows its OWN storage form, so the only names this ever
// rewrites belong to units whose form actually changed.
describe('unitNoun', () => {
  it('calls a pallet-denominated floor a Pallet', () => {
    expect(unitNoun({ isFloor: true, slotUnit: 'pallet' })).toBe('Pallet')
  })

  it('calls everything else a Rack', () => {
    // Racking, however it is denominated.
    expect(unitNoun({ isFloor: false, slotUnit: 'pallet' })).toBe('Rack')
    expect(unitNoun({ isFloor: false, slotUnit: 'carton' })).toBe('Rack')
    // A floor counted in something other than pallets. There is no better word
    // that would not be invented, and nothing is auto-named with one today.
    expect(unitNoun({ isFloor: true, slotUnit: 'carton' })).toBe('Rack')
    expect(unitNoun({ isFloor: true, slotUnit: 'uncounted' })).toBe('Rack')
    // No form at all — a bin drawn before storage forms existed.
    expect(unitNoun(null)).toBe('Rack')
    expect(unitNoun(undefined)).toBe('Rack')
  })

  it('never treats a missing is_floor as a floor', () => {
    // MAIN_PALLET_BAY is real racking sitting at is_floor false; reading a
    // missing flag as true would rename all 189 of MAIN's bays.
    expect(unitNoun({ slotUnit: 'pallet' })).toBe('Rack')
    expect(unitNoun({ isFloor: null, slotUnit: 'pallet' })).toBe('Rack')
  })
})

// Recomposition with NO assignment: the pool and the number are stored columns,
// so a form edit that moves the noun can rebuild every name from the row itself.
// This is the repair for units no naming pass reaches — the ones that exist only
// on a published layout (mig 00103).
describe('restampNames', () => {
  const unitRow = (over: Partial<Parameters<typeof restampNames>[0][number]> = {}) => ({
    id: 1,
    name: 'Quarantine · Rack 2',
    nameArea: 'Quarantine',
    nameSeq: 2,
    ...over,
  })

  it('rewrites the word and nothing else', () => {
    expect(restampNames([unitRow()], 'Pallet')).toEqual([
      { id: 1, name: 'Quarantine · Pallet 2', nameSeq: 2, nameArea: 'Quarantine' },
    ])
  })

  it('emits nothing when the noun has not moved', () => {
    // A form edit that changes a colour or a weight limit must write no names at
    // all, or every such save churns `locations` and reads as a rename.
    expect(restampNames([unitRow()], 'Rack')).toEqual([])
  })

  it('composes an area-less unit without a stray separator', () => {
    const [write] = restampNames([unitRow({ nameArea: null, name: 'Rack 2' })], 'Pallet')
    expect(write.name).toBe('Pallet 2')
    expect(write.nameArea).toBeNull()
  })

  it('takes a level from its PARENT pool, keeping its own index', () => {
    const writes = restampNames([unitRow({
      name: 'Bulk · Rack 3',
      nameArea: 'Bulk',
      nameSeq: 3,
      levels: [
        { id: 11, name: 'Bulk · Rack 3 · L1', levelIndex: 1 },
        { id: 12, name: 'Bulk · Rack 3 · L2', levelIndex: 2 },
      ],
    })], 'Pallet')
    expect(writes).toEqual([
      { id: 1, name: 'Bulk · Pallet 3', nameSeq: 3, nameArea: 'Bulk' },
      // A level carries no number of its own — mutate-layout writes name_seq
      // null and the rack's area, and this must agree byte-for-byte.
      { id: 11, name: 'Bulk · Pallet 3 · L1', nameSeq: null, nameArea: 'Bulk' },
      { id: 12, name: 'Bulk · Pallet 3 · L2', nameSeq: null, nameArea: 'Bulk' },
    ])
  })

  it('rewrites a level whose parent is already correct', () => {
    // The half most likely to be missing: the rack was restamped by some earlier
    // pass and its levels were not.
    const writes = restampNames([unitRow({
      name: 'Bulk · Pallet 3',
      nameArea: 'Bulk',
      nameSeq: 3,
      levels: [{ id: 11, name: 'Bulk · Rack 3 · L1', levelIndex: 1 }],
    })], 'Pallet')
    expect(writes).toEqual([{ id: 11, name: 'Bulk · Pallet 3 · L1', nameSeq: null, nameArea: 'Bulk' }])
  })

  it('agrees with composeName, which is what the naming pass uses', () => {
    const [write] = restampNames([unitRow()], 'Pallet')
    expect(write.name).toBe(composeName('Quarantine', 2, null, 'Pallet'))
  })
})

// The whole point of carrying the noun per UNIT rather than per pass.
describe('assignAutoNames — per-unit nouns', () => {
  const AREA = area('Bulk Storage', 0, 0, 4, 1)

  it('names a floor spot and a rack in one area with their own words', () => {
    const units = [
      unit({ ref: 'floor', x: 0, y: 0, noun: 'Pallet' }),
      unit({ ref: 'rack', x: 1, y: 0 }),
    ]
    const named = assignAutoNames(units, buildAreaIndex(AREA)).units
    expect(named.find((u) => u.ref === 'floor')!.name).toBe('Bulk Storage · Pallet 1')
    expect(named.find((u) => u.ref === 'rack')!.name).toBe('Bulk Storage · Rack 2')
  })

  it('gives a levelled unit levels that match its own noun', () => {
    const units = [unit({ ref: 'r', x: 0, y: 0, noun: 'Pallet', levelIndexes: [1, 2] })]
    const named = assignAutoNames(units, buildAreaIndex(AREA)).units[0]
    expect(named.levelNames[1]).toBe('Bulk Storage · Pallet 1 · L1')
    expect(named.noun).toBe('Pallet')
  })

  it('leaves a unit with no noun composing exactly as it always did', () => {
    const units = [unit({ ref: 'r', x: 0, y: 0 })]
    expect(assignAutoNames(units, buildAreaIndex(AREA)).units[0].name).toBe('Bulk Storage · Rack 1')
  })

  it('shares one number pool across nouns, so two units never collide', () => {
    // The pool is the AREA, not the word — "Pallet 1" and "Rack 1" standing in
    // one area would read as two different things with the same number.
    const units = [
      unit({ ref: 'a', x: 0, y: 0, noun: 'Pallet' }),
      unit({ ref: 'b', x: 1, y: 0, noun: 'Pallet' }),
      unit({ ref: 'c', x: 2, y: 0 }),
    ]
    const seqs = assignAutoNames(units, buildAreaIndex(AREA)).units.map((u) => u.seq)
    expect(new Set(seqs).size).toBe(3)
  })
})

describe('sanitizeAreaName / areaNameIssue', () => {
  it('collapses whitespace and caps length', () => {
    expect(sanitizeAreaName('  Cold   Room  ')).toBe('Cold Room')
    expect(sanitizeAreaName('y'.repeat(200))).toHaveLength(MAX_AREA_NAME)
  })

  it('refuses a blank name and one containing the part separator', () => {
    expect(areaNameIssue('   ')).toMatch(/name/i)
    expect(areaNameIssue('Cold · Dry')).toMatch(/·/)
    expect(areaNameIssue('Cold Room')).toBeNull()
  })
})

describe('isUninformativeName', () => {
  it.each([
    ['', 'NEXG-B-9-4', true],
    ['   ', 'NEXG-B-9-4', true],
    ['Bin 9,4', 'NEXG-B-9-4', true],
    ['Level 4', 'NEXG-B-9-4-L4', true],
    ['nexg-b-9-4', 'NEXG-B-9-4', true],
    // The seeded shape on WIE-DEMO and MAIN. Worse than the bare code on a
    // canvas: it elides to "Bin WI…", identical for every bin on the floor,
    // where the code keeps its discriminating tail.
    ['Bin WIEDEMO-Z1-AL-R1-B3', 'WIEDEMO-Z1-AL-R1-B3', true],
    ['Rack MAIN-F01-L01', 'MAIN-F01-L01', true],
    ['Chiller · Rack 7', 'NEXG-B-9-4', false],
    ['Rack 12', 'NEXG-B-9-4', false],
    ['Damaged goods bay', 'NEXG-B-9-4', false],
  ])('%s vs %s -> %s', (name, code, expected) => {
    expect(isUninformativeName(name, code)).toBe(expected)
  })
})

// ── containment ─────────────────────────────────────────────────────────────

describe('containment', () => {
  const objects = [...area('Chiller', 0, 0, 4, 3), ...area('Bulk', 4, 0, 3, 3)]

  it('agrees between the linear and the rasterized form for every cell', () => {
    const index = buildAreaIndex(objects)
    for (let y = -1; y <= 4; y++) {
      for (let x = -1; x <= 8; x++) {
        expect(areaNameAtIndexed(index, 0, x, y)).toBe(areaNameAt(objects, 0, x, y))
      }
    }
  })

  it('is empty outside every area, and on another floor', () => {
    const index = buildAreaIndex(objects)
    expect(areaNameAtIndexed(index, 0, 9, 9)).toBe('')
    expect(areaNameAtIndexed(index, 1, 0, 0)).toBe('')
    expect(areaNameAt(objects, 1, 0, 0)).toBe('')
  })

  it('ignores unnamed area cells and non-area objects', () => {
    const messy: AreaCellSource[] = [
      { objectType: 'area', floor: 0, x: 0, y: 0, w: 1, h: 1, meta: { name: '  ' } },
      { objectType: 'wall', floor: 0, x: 1, y: 0, w: 1, h: 1, meta: { name: 'Wall' } },
    ]
    expect(areaNameAt(messy, 0, 0, 0)).toBe('')
    expect(areaNameAt(messy, 0, 1, 0)).toBe('')
    expect(areaNameOf({ meta: { name: ' Chiller ' } })).toBe('Chiller')
    expect(areaNameOf({ meta: null })).toBe('')
  })

  it('breaks an overlap on the smaller raw name, both ways round', () => {
    const forward = buildAreaIndex([...area('Bulk', 0, 0), ...area('Ambient', 0, 0)])
    const reverse = buildAreaIndex([...area('Ambient', 0, 0), ...area('Bulk', 0, 0)])
    expect(areaNameAtIndexed(forward, 0, 0, 0)).toBe('Ambient')
    expect(areaNameAtIndexed(reverse, 0, 0, 0)).toBe('Ambient')
  })

  it('gives a straddling multi-cell rack to whichever area covers most of it', () => {
    // MAIN's bays are two cells wide, so this is real, not theoretical.
    const index = buildAreaIndex(objects)
    expect(areaForRect(index, { floor: 0, x: 2, y: 0, w: 3, h: 1 })).toBe('Chiller') // 2 vs 1
    expect(areaForRect(index, { floor: 0, x: 3, y: 0, w: 3, h: 1 })).toBe('Bulk') // 1 vs 2
  })

  it('breaks an even straddle on the smaller name', () => {
    const index = buildAreaIndex(objects)
    expect(areaForRect(index, { floor: 0, x: 3, y: 0, w: 2, h: 1 })).toBe('Bulk') // Bulk < Chiller
  })
})

// ── numbering: the contract ─────────────────────────────────────────────────

describe('assignAutoNames — numbering', () => {
  const objects = area('Chiller', 0, 0, 10, 10)

  it('numbers a fresh draw in reading order', () => {
    const units = [
      unit({ ref: 'c', x: 0, y: 1 }),
      unit({ ref: 'a', x: 0, y: 0 }),
      unit({ ref: 'b', x: 1, y: 0 }),
    ]
    const result = assignAutoNames(units, buildAreaIndex(objects))
    expect(result.units.map((u) => `${u.ref}:${u.seq}`)).toEqual(['a:1', 'b:2', 'c:3'])
    expect(result.highWater.get('Chiller')).toBe(3)
  })

  it('NEVER renumbers: a deleted rack leaves a permanent gap', () => {
    let units = settle(
      [0, 1, 2, 3, 4].map((i) => unit({ ref: `r${i}`, x: i, y: 0 })),
      objects,
    )
    expect(units.map((u) => u.name)).toEqual([
      'Chiller · Rack 1',
      'Chiller · Rack 2',
      'Chiller · Rack 3',
      'Chiller · Rack 4',
      'Chiller · Rack 5',
    ])

    // Delete rack 3 (seq 3) and draw a new one.
    const survivors = units.filter((u) => u.ref !== 'r2')
    const after = assignAutoNames(
      [...survivors, unit({ ref: 'new', x: 7, y: 0 })],
      buildAreaIndex(objects),
    )

    // The survivors come back byte-identical...
    for (const s of survivors) {
      const got = after.units.find((u) => u.ref === s.ref)!
      expect(got.name).toBe(s.name)
      expect(got.seq).toBe(s.nameSeq)
      expect(got.assigned).toBe(false)
      expect(got.restamped).toBe(false)
    }
    // ...and the new rack is 6, not the vacated 3.
    expect(after.units.find((u) => u.ref === 'new')!.name).toBe('Chiller · Rack 6')
  })

  it('is idempotent — feeding a settled set back in changes nothing', () => {
    const once = settle([0, 1, 2].map((i) => unit({ ref: `r${i}`, x: i, y: 0 })), objects)
    const twice = settle(once, objects)
    expect(twice.map((u) => [u.name, u.nameSeq, u.nameArea])).toEqual(
      once.map((u) => [u.name, u.nameSeq, u.nameArea]),
    )
    const result = assignAutoNames(once, buildAreaIndex(objects))
    expect(result.units.every((u) => !u.assigned && !u.restamped)).toBe(true)
  })

  it('does not depend on the order the caller collected the units', () => {
    const units = [0, 1, 2, 3, 4, 5].map((i) => unit({ ref: `r${i}`, x: i % 3, y: Math.floor(i / 3) }))
    const canonical = assignAutoNames(units, buildAreaIndex(objects)).units
      .map((u) => `${u.ref}=${u.name}`)
      .sort()
    for (let seed = 1; seed <= 50; seed++) {
      const shuffled = assignAutoNames(shuffle(units, seed), buildAreaIndex(objects)).units
        .map((u) => `${u.ref}=${u.name}`)
        .sort()
      expect(shuffled).toEqual(canonical)
    }
  })

  it('shares one pool across floors so two floors cannot both hold Rack 1', () => {
    const twoFloors = [...area('Chiller', 0, 0, 4, 4, 0), ...area('Chiller', 0, 0, 4, 4, 1)]
    const result = assignAutoNames(
      [
        unit({ ref: 'f0a', x: 0, y: 0, floor: 0 }),
        unit({ ref: 'f0b', x: 1, y: 0, floor: 0 }),
        unit({ ref: 'f1a', x: 0, y: 0, floor: 1 }),
      ],
      buildAreaIndex(twoFloors),
    )
    expect(result.units.map((u) => u.name)).toEqual([
      'Chiller · Rack 1',
      'Chiller · Rack 2',
      'Chiller · Rack 3',
    ])
    expect(new Set(result.units.map((u) => u.name)).size).toBe(3)
  })

  it('numbers a rack drawn outside every area, and never renumbers it later', () => {
    const settled = settle([unit({ ref: 'lone', x: 50, y: 50 })], objects)
    expect(settled[0].name).toBe('Rack 1')

    // Now paint an area over it. Nothing auto-restamps on a repaint.
    const covered = [...objects, ...area('Chiller', 50, 50)]
    expect(nameOf(settled, covered, 'lone')).toBe('Rack 1')
  })

  it('holds its claim when a different area is painted over it', () => {
    // §9.1 of the design, mechanized: the failure the stored pool key prevents.
    const settled = settle(
      [0, 1, 2, 3, 4].map((i) => unit({ ref: `r${i}`, x: i, y: 0 })),
      objects,
    )
    const repainted = [...area('Bulk', 0, 0, 5, 1), ...area('Chiller', 0, 1, 10, 9)]

    // The five keep their Chiller names even though Bulk now covers them...
    const after = assignAutoNames(
      [...settled, unit({ ref: 'next', x: 0, y: 5 })],
      buildAreaIndex(repainted),
    )
    for (const s of settled) {
      expect(after.units.find((u) => u.ref === s.ref)!.name).toBe(s.name)
    }
    // ...so the next rack drawn in Chiller is 6, not a duplicate Rack 1.
    expect(after.units.find((u) => u.ref === 'next')!.name).toBe('Chiller · Rack 6')
  })

  it('honours a floor from numbers handed out outside this layout', () => {
    // The claim that matters is one that reached a label. A rack deleted from the
    // layout keeps its `locations` row — publishing never retires a bin — so its
    // number must not come back on a different rack.
    const result = assignAutoNames(
      [unit({ ref: 'fresh', x: 0, y: 0 })],
      buildAreaIndex(objects),
      { minSeq: new Map([['Chiller', 12]]) },
    )
    expect(result.units[0].name).toBe('Chiller · Rack 13')
  })

  it('keeps pools independent when a floor is supplied', () => {
    const twoAreas = [...area('Chiller', 0, 0, 2, 1), ...area('Bulk', 2, 0, 2, 1)]
    const result = assignAutoNames(
      [unit({ ref: 'c', x: 0, y: 0 }), unit({ ref: 'b', x: 2, y: 0 })],
      buildAreaIndex(twoAreas),
      { minSeq: new Map([['Chiller', 9]]) },
    )
    expect(result.units.map((u) => u.name)).toEqual(['Chiller · Rack 10', 'Bulk · Rack 1'])
  })

  it('builds that floor from raw location rows, ignoring unnumbered ones', () => {
    expect(
      Object.fromEntries(
        highWaterFromRows([
          { nameArea: 'Chiller', nameSeq: 3, nameIsAuto: true },
          { nameArea: 'Chiller', nameSeq: 11, nameIsAuto: true },
          { nameArea: 'Bulk', nameSeq: 2, nameIsAuto: true },
          { nameArea: null, nameSeq: 7, nameIsAuto: true },
          { nameArea: 'Chiller', nameSeq: null, nameIsAuto: false },
        ]),
      ),
    ).toEqual({ Chiller: 11, Bulk: 2, '': 7 })
  })

  it('composes a level name for every index, from its rack’s number', () => {
    const result = assignAutoNames(
      [unit({ ref: 'rack', x: 0, y: 0, levelIndexes: [1, 2, 3] })],
      buildAreaIndex(objects),
    )
    expect(result.units[0].levelNames).toEqual({
      1: 'Chiller · Rack 1 · L1',
      2: 'Chiller · Rack 1 · L2',
      3: 'Chiller · Rack 1 · L3',
    })
  })

  it('gives a level added to a saved rack that rack’s number', () => {
    const saved = unit({
      ref: 'rack', x: 3, y: 3, nameSeq: 9, nameArea: 'Chiller',
      name: 'Chiller · Rack 9', levelIndexes: [1, 2],
    })
    const result = assignAutoNames([saved], buildAreaIndex(objects))
    expect(result.units[0].seq).toBe(9)
    expect(result.units[0].levelNames[2]).toBe('Chiller · Rack 9 · L2')
  })
})

// ── numbering: the rename cascade ───────────────────────────────────────────

describe('assignAutoNames — area rename', () => {
  const before = area('Chiller', 0, 0, 6, 3)
  const after = area('Cold Room', 0, 0, 6, 3)

  const settled = () =>
    settle([0, 1, 2].map((i) => unit({ ref: `r${i}`, x: i, y: 0 })), before)

  it('relabels every rack and keeps every number', () => {
    const units = settled()
    const result = assignAutoNames(units, buildAreaIndex(after), {
      rename: { from: 'Chiller', to: 'Cold Room' },
    })
    expect(result.units.map((u) => u.name)).toEqual([
      'Cold Room · Rack 1',
      'Cold Room · Rack 2',
      'Cold Room · Rack 3',
    ])
    expect(result.units.map((u) => u.seq)).toEqual([1, 2, 3])
    expect(result.units.every((u) => u.restamped && !u.assigned)).toBe(true)
  })

  it('relabels the levels too', () => {
    const units = settle([unit({ ref: 'r', x: 0, y: 0, levelIndexes: [1, 2] })], before)
    const result = assignAutoNames(units, buildAreaIndex(after), {
      rename: { from: 'Chiller', to: 'Cold Room' },
    })
    expect(result.units[0].levelNames).toEqual({
      1: 'Cold Room · Rack 1 · L1',
      2: 'Cold Room · Rack 1 · L2',
    })
  })

  it('skips a hand-named rack, and takes it when told to', () => {
    const units = settled()
    // Someone renamed r1 by hand: custom, and its number was released.
    units[1] = { ...units[1], name: 'Damaged goods bay', nameIsAuto: false, nameSeq: null, nameArea: null }

    const skipped = assignAutoNames(units, buildAreaIndex(after), {
      rename: { from: 'Chiller', to: 'Cold Room' },
    })
    const untouched = skipped.units.find((u) => u.ref === 'r1')!
    expect(untouched.restamped).toBe(false)
    expect(untouched.assigned).toBe(false)
    expect(untouched.isAuto).toBe(false)
    // Echoed back verbatim — it must NOT be handed a number and recomposed.
    expect(untouched.name).toBe('Damaged goods bay')
    expect(untouched.seq).toBeNull()
    expect(skipped.units.map((u) => u.name)).toContain('Cold Room · Rack 1')
    expect(skipped.units.map((u) => u.name)).not.toContain('Cold Room · Rack 2')

    const taken = assignAutoNames(units, buildAreaIndex(after), {
      rename: { from: 'Chiller', to: 'Cold Room' },
      includeCustom: true,
    })
    const r1 = taken.units.find((u) => u.ref === 'r1')!
    expect(r1.restamped).toBe(true)
    expect(r1.assigned).toBe(true)
    // A fresh number ABOVE the high-water mark — never one already on the floor.
    expect(r1.seq).toBe(4)
    expect(r1.name).toBe('Cold Room · Rack 4')
  })

  it('gives a rack adopted from another area a fresh number, not a colliding one', () => {
    const units = settled()
    // A "Bulk · Rack 1" that the renamed area now covers.
    units.push(
      unit({ ref: 'adopted', x: 4, y: 0, nameSeq: 1, nameArea: 'Bulk', name: 'Bulk · Rack 1' }),
    )
    const result = assignAutoNames(units, buildAreaIndex(after), {
      rename: { from: 'Chiller', to: 'Cold Room' },
    })
    const adopted = result.units.find((u) => u.ref === 'adopted')!
    expect(adopted.seq).toBe(4)
    expect(adopted.name).toBe('Cold Room · Rack 4')
    expect(new Set(result.units.map((u) => u.name)).size).toBe(result.units.length)
  })

  it('leaves a hand-named rack alone on an ordinary save, with no rename at all', () => {
    // The regression this guard exists for: a custom name carries no seq, so
    // without the early exit it looks brand new and gets recomposed away.
    const custom: NamingUnit = unit({
      ref: 'custom', x: 0, y: 0, name: 'Damaged goods bay', nameIsAuto: false,
    })
    const result = assignAutoNames([custom], buildAreaIndex(before))
    expect(result.units[0].name).toBe('Damaged goods bay')
    expect(result.units[0].assigned).toBe(false)
    expect(result.units[0].isAuto).toBe(false)
    // ...and it holds no claim, so the next auto rack is still 1.
    expect(nextSeqForArea([custom], 'Chiller')).toBe(1)
  })

  it('does not sweep up a hand-named rack OUTSIDE the renamed area, even with includeCustom', () => {
    const renamed = [...area('Cold Room', 0, 0, 3, 1), ...area('Bulk', 3, 0, 3, 1)]
    const units = [
      unit({ ref: 'in', x: 0, y: 0, name: 'Hand named A', nameIsAuto: false }),
      unit({ ref: 'out', x: 3, y: 0, name: 'Hand named B', nameIsAuto: false }),
    ]
    const result = assignAutoNames(units, buildAreaIndex(renamed), {
      rename: { from: 'Chiller', to: 'Cold Room' },
      includeCustom: true,
    })
    expect(result.units.find((u) => u.ref === 'in')!.name).toBe('Cold Room · Rack 1')
    expect(result.units.find((u) => u.ref === 'out')!.name).toBe('Hand named B')
  })

  it('leaves racks outside the renamed area alone', () => {
    const objects = [...area('Chiller', 0, 0, 3, 1), ...area('Bulk', 3, 0, 3, 1)]
    const units = settle(
      [unit({ ref: 'in', x: 0, y: 0 }), unit({ ref: 'out', x: 3, y: 0 })],
      objects,
    )
    const renamed = [...area('Cold Room', 0, 0, 3, 1), ...area('Bulk', 3, 0, 3, 1)]
    const result = assignAutoNames(units, buildAreaIndex(renamed), {
      rename: { from: 'Chiller', to: 'Cold Room' },
    })
    expect(result.units.find((u) => u.ref === 'in')!.name).toBe('Cold Room · Rack 1')
    expect(result.units.find((u) => u.ref === 'out')!.name).toBe('Bulk · Rack 1')
  })

  it('renames across every floor carrying the name', () => {
    const twoBefore = [...area('Chiller', 0, 0, 3, 1, 0), ...area('Chiller', 0, 0, 3, 1, 1)]
    const twoAfter = [...area('Cold Room', 0, 0, 3, 1, 0), ...area('Cold Room', 0, 0, 3, 1, 1)]
    const units = settle(
      [unit({ ref: 'f0', x: 0, y: 0, floor: 0 }), unit({ ref: 'f1', x: 0, y: 0, floor: 1 })],
      twoBefore,
    )
    const result = assignAutoNames(units, buildAreaIndex(twoAfter), {
      rename: { from: 'Chiller', to: 'Cold Room' },
    })
    expect(result.units.map((u) => u.name)).toEqual(['Cold Room · Rack 1', 'Cold Room · Rack 2'])
  })

  it('is a no-op when the name did not actually change', () => {
    const units = settled()
    const result = assignAutoNames(units, buildAreaIndex(before), {
      rename: { from: 'Chiller', to: 'Chiller' },
    })
    expect(result.units.every((u) => !u.restamped && !u.assigned)).toBe(true)
  })
})

// ── helpers used by the UI ──────────────────────────────────────────────────

describe('nextSeqForArea', () => {
  it('agrees with what assignAutoNames would hand out', () => {
    const objects = area('Chiller', 0, 0, 5, 5)
    const settled = settle([0, 1].map((i) => unit({ ref: `r${i}`, x: i, y: 0 })), objects)
    expect(nextSeqForArea(settled, 'Chiller')).toBe(3)

    const result = assignAutoNames([...settled, unit({ ref: 'n', x: 3, y: 0 })], buildAreaIndex(objects))
    expect(result.units.find((u) => u.ref === 'n')!.seq).toBe(3)
  })

  it('starts at 1 for a pool nobody has used', () => {
    expect(nextSeqForArea([], 'Chiller')).toBe(1)
    expect(nextSeqForArea([], '')).toBe(1)
  })
})

describe('describeSeqRanges', () => {
  it('summarises what a fill spanning two areas is about to mint', () => {
    const objects = [...area('Chiller', 0, 0, 2, 1), ...area('Bulk', 2, 0, 2, 1)]
    const result = assignAutoNames(
      [0, 1, 2, 3].map((i) => unit({ ref: `r${i}`, x: i, y: 0 })),
      buildAreaIndex(objects),
    )
    expect(describeSeqRanges(result.units)).toBe('Chiller 1–2, Bulk 1–2')
  })

  it('says nothing about racks it did not number', () => {
    const objects = area('Chiller', 0, 0, 3, 1)
    const settled = settle([unit({ ref: 'r', x: 0, y: 0 })], objects)
    const result = assignAutoNames(settled, buildAreaIndex(objects))
    expect(describeSeqRanges(result.units)).toBe('')
  })
})

// ── the guarantee ───────────────────────────────────────────────────────────

describe('the code is never touched', () => {
  it('emits nothing code-shaped', () => {
    const objects = area('Chiller', 0, 0, 3, 3)
    const result = assignAutoNames(
      [unit({ ref: 'NEXG-B-9-4', x: 0, y: 0, levelIndexes: [1, 2, 3, 4] })],
      buildAreaIndex(objects),
    )
    const emitted = [result.units[0].name, ...Object.values(result.units[0].levelNames)]
    for (const text of emitted) {
      expect(text).not.toContain('NEXG')
      expect(text).not.toMatch(/-B-/)
    }
  })
})
