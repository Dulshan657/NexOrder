import { describe, it, expect } from 'vitest'
import {
  categoryConflicts,
  planZoneBinding,
  requiredProfileIds,
  resolveProfileId,
  zoneTargets,
  type BindingUnit,
  type ZoneRow,
  type ZoneTarget,
} from '@/supabase/functions/_shared/wie/zoneBinding'
import { buildAreaIndex, type AreaCellSource } from '@/supabase/functions/_shared/wie/locationNaming'

// ── helpers ─────────────────────────────────────────────────────────────────

const WH = { id: 1, path: 'MAIN' }
const COLD: ZoneRow = { id: 900, path: 'MAIN/MAIN-Z4' }
const BULK: ZoneRow = { id: 901, path: 'MAIN/MAIN-Z1' }

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

/** A bin sitting at the warehouse root — the state every drawn bin is in today. */
function unit(over: Partial<BindingUnit> & { id: number; x: number; y: number }): BindingUnit {
  const code = over.code ?? `MAIN-B-${over.x}-${over.y}`
  return {
    ref: `loc:${over.id}`,
    code,
    floor: 0,
    w: 1,
    h: 1,
    parentId: WH.id,
    path: `${WH.path}/${code}`,
    ...over,
  }
}

/** Bind, then feed the result back onto the units, the way a save does. */
function settle(units: BindingUnit[], moves: ReturnType<typeof planZoneBinding>['moves']): BindingUnit[] {
  const byId = new Map(moves.map((m) => [m.id, m]))
  return units.map((u) => {
    const move = byId.get(u.id)
    const next = move ? { ...u, parentId: move.parent_id, path: move.materialized_path } : u
    return {
      ...next,
      levels: (u.levels ?? []).map((l) => {
        const lm = byId.get(l.id)
        return lm ? { ...l, path: lm.materialized_path } : l
      }),
    }
  })
}

/** The whole pipeline, as an edge function runs it. */
function bind(
  units: BindingUnit[],
  objects: AreaCellSource[],
  profileByArea: Map<string, number | null>,
  zones: Map<number, ZoneRow> = new Map([[4, COLD], [1, BULK]]),
) {
  const targets = zoneTargets(units, buildAreaIndex(objects), profileByArea)
  return { targets, plan: planZoneBinding(units, targets, zones, WH) }
}

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

// ── the rule ────────────────────────────────────────────────────────────────

describe('zoneTargets', () => {
  it('reads the area under a bin and its profile', () => {
    const units = [unit({ id: 10, x: 3, y: 3 })]
    const targets = zoneTargets(units, buildAreaIndex(area('Chiller', 3, 3)), new Map([['Chiller', 4]]))
    expect(targets.get('loc:10')).toEqual({ areaName: 'Chiller', profileId: 4 })
  })

  it('reports an area that carries no profile as a named area with none', () => {
    const units = [unit({ id: 10, x: 3, y: 3 })]
    const targets = zoneTargets(units, buildAreaIndex(area('Bulk', 3, 3)), new Map([['Bulk', null]]))
    expect(targets.get('loc:10')).toEqual({ areaName: 'Bulk', profileId: null })
  })

  it('reports no area as the empty pool', () => {
    const units = [unit({ id: 10, x: 9, y: 9 })]
    const targets = zoneTargets(units, buildAreaIndex(area('Chiller', 3, 3)), new Map([['Chiller', 4]]))
    expect(targets.get('loc:10')).toEqual({ areaName: '', profileId: null })
  })

  it('uses areaForRect, so a straddling rack follows the majority of its cells', () => {
    // Two cells in Chiller, one in Bulk.
    const objects = [...area('Chiller', 0, 0, 2, 1), ...area('Bulk', 2, 0, 1, 1)]
    const units = [unit({ id: 10, x: 0, y: 0, w: 3, h: 1 })]
    const targets = zoneTargets(units, buildAreaIndex(objects), new Map([['Chiller', 4], ['Bulk', 1]]))
    expect(targets.get('loc:10')!.areaName).toBe('Chiller')
  })
})

describe('resolveProfileId', () => {
  const u = unit({ id: 10, x: 0, y: 0, ownZoneProfileId: 1 })

  it('lets the area beat the placement’s own zone_profile_id', () => {
    expect(resolveProfileId(u, { areaName: 'Chiller', profileId: 4 })).toBe(4)
  })

  it('falls back to the placement’s own when the area names no profile', () => {
    expect(resolveProfileId(u, { areaName: 'Bulk', profileId: null })).toBe(1)
  })

  it('falls back when there is no area at all', () => {
    expect(resolveProfileId(u, { areaName: '', profileId: null })).toBe(1)
  })

  it('is null when neither says anything', () => {
    expect(resolveProfileId(unit({ id: 11, x: 0, y: 0 }), undefined)).toBeNull()
  })
})

describe('requiredProfileIds', () => {
  it('dedupes and sorts, so each profile is find-or-created once', () => {
    const units = [
      unit({ id: 10, x: 0, y: 0 }),
      unit({ id: 11, x: 1, y: 0 }),
      unit({ id: 12, x: 5, y: 5, ownZoneProfileId: 1 }),
    ]
    const targets = new Map<string, ZoneTarget>([
      ['loc:10', { areaName: 'Chiller', profileId: 4 }],
      ['loc:11', { areaName: 'Chiller', profileId: 4 }],
      ['loc:12', { areaName: '', profileId: null }],
    ])
    expect(requiredProfileIds(units, targets)).toEqual([1, 4])
  })

  it('asks for nothing when no unit is bound', () => {
    const units = [unit({ id: 10, x: 9, y: 9 })]
    expect(requiredProfileIds(units, zoneTargets(units, buildAreaIndex([]), new Map()))).toEqual([])
  })
})

// ── planZoneBinding ─────────────────────────────────────────────────────────

describe('planZoneBinding', () => {
  it('moves a root-parented bin under its area’s zone', () => {
    const units = [unit({ id: 10, x: 3, y: 3, code: 'MAIN-B-3-3' })]
    const { plan } = bind(units, area('Chiller', 3, 3), new Map([['Chiller', 4]]))

    expect(plan.moves).toEqual([
      { id: 10, parent_id: COLD.id, materialized_path: 'MAIN/MAIN-Z4/MAIN-B-3-3' },
    ])
    expect(plan.units).toBe(1)
    expect(plan.toRoot).toBe(0)
    expect(plan.unchanged).toBe(0)
  })

  it('leaves a bin in no area at the root, and calls it unchanged', () => {
    const units = [unit({ id: 10, x: 9, y: 9 })]
    const { plan } = bind(units, area('Chiller', 3, 3), new Map([['Chiller', 4]]))

    expect(plan.moves).toEqual([])
    expect(plan.unchanged).toBe(1)
  })

  it('leaves a bin in a profile-less area at the root', () => {
    const units = [unit({ id: 10, x: 3, y: 3 })]
    const { plan } = bind(units, area('Bulk', 3, 3), new Map([['Bulk', null]]))

    expect(plan.moves).toEqual([])
    expect(plan.byArea[0]).toMatchObject({ areaName: 'Bulk', profileId: null, zoneId: null, units: 1 })
  })

  it('honours the placement’s own zone_profile_id outside any area', () => {
    const units = [unit({ id: 10, x: 9, y: 9, code: 'MAIN-B-9-9', ownZoneProfileId: 1 })]
    const { plan } = bind(units, [], new Map())

    expect(plan.moves).toEqual([
      { id: 10, parent_id: BULK.id, materialized_path: 'MAIN/MAIN-Z1/MAIN-B-9-9' },
    ])
    // …but byArea still reports the AREA's profile, which is none. Otherwise the
    // "no area" bucket would claim a profile and get category-warned about it.
    expect(plan.byArea).toEqual([
      { areaName: '', profileId: null, zoneId: null, units: 1, moved: 1, unitIds: [10] },
    ])
  })

  it('sends a bin back to the root when its area is erased — the reverse is the same rule', () => {
    const bound = [unit({
      id: 10, x: 3, y: 3, code: 'MAIN-B-3-3',
      parentId: COLD.id, path: 'MAIN/MAIN-Z4/MAIN-B-3-3',
    })]
    const { plan } = bind(bound, [], new Map())

    expect(plan.moves).toEqual([
      { id: 10, parent_id: WH.id, materialized_path: 'MAIN/MAIN-B-3-3' },
    ])
    expect(plan.toRoot).toBe(1)
  })

  it('sends a bin back to the root when its area’s profile is cleared', () => {
    const bound = [unit({
      id: 10, x: 3, y: 3, code: 'MAIN-B-3-3',
      parentId: COLD.id, path: 'MAIN/MAIN-Z4/MAIN-B-3-3',
    })]
    const { plan } = bind(bound, area('Chiller', 3, 3), new Map([['Chiller', null]]))

    expect(plan.moves).toEqual([
      { id: 10, parent_id: WH.id, materialized_path: 'MAIN/MAIN-B-3-3' },
    ])
  })

  it('moves a bin straight from one zone to another when the area is re-tinted', () => {
    const bound = [unit({
      id: 10, x: 3, y: 3, code: 'MAIN-B-3-3',
      parentId: COLD.id, path: 'MAIN/MAIN-Z4/MAIN-B-3-3',
    })]
    const { plan } = bind(bound, area('Chiller', 3, 3), new Map([['Chiller', 1]]))

    expect(plan.moves).toEqual([
      { id: 10, parent_id: BULK.id, materialized_path: 'MAIN/MAIN-Z1/MAIN-B-3-3' },
    ])
  })

  it('throws rather than silently unbinding when a profile has no resolved zone', () => {
    const units = [unit({ id: 10, x: 3, y: 3 })]
    const targets = zoneTargets(units, buildAreaIndex(area('Chiller', 3, 3)), new Map([['Chiller', 7]]))
    expect(() => planZoneBinding(units, targets, new Map(), WH)).toThrow(/profile 7/)
  })
})

// ── levelled racks ──────────────────────────────────────────────────────────

describe('levelled racks', () => {
  const rack = () => unit({
    id: 20, x: 3, y: 3, code: 'MAIN-R-3-3',
    levels: [
      { id: 21, code: 'MAIN-R-3-3-L1', path: 'MAIN/MAIN-R-3-3/MAIN-R-3-3-L1' },
      { id: 22, code: 'MAIN-R-3-3-L2', path: 'MAIN/MAIN-R-3-3/MAIN-R-3-3-L2' },
    ],
  })

  it('rewrites every SHELF path when the rack moves, keeping the rack as their parent', () => {
    const { plan } = bind([rack()], area('Chiller', 3, 3), new Map([['Chiller', 4]]))

    expect(plan.moves).toEqual([
      { id: 20, parent_id: COLD.id, materialized_path: 'MAIN/MAIN-Z4/MAIN-R-3-3' },
      { id: 21, parent_id: 20, materialized_path: 'MAIN/MAIN-Z4/MAIN-R-3-3/MAIN-R-3-3-L1' },
      { id: 22, parent_id: 20, materialized_path: 'MAIN/MAIN-Z4/MAIN-R-3-3/MAIN-R-3-3-L2' },
    ])
    expect(plan.units).toBe(1)
    expect(plan.levels).toBe(2)
  })

  it('repairs a drifted level even when the rack itself is already settled', () => {
    // The rack landed; one level did not — a half-applied batch, or a level added
    // while the rack sat elsewhere.
    const half = unit({
      id: 20, x: 3, y: 3, code: 'MAIN-R-3-3',
      parentId: COLD.id, path: 'MAIN/MAIN-Z4/MAIN-R-3-3',
      levels: [
        { id: 21, code: 'MAIN-R-3-3-L1', path: 'MAIN/MAIN-Z4/MAIN-R-3-3/MAIN-R-3-3-L1' },
        { id: 22, code: 'MAIN-R-3-3-L2', path: 'MAIN/MAIN-R-3-3/MAIN-R-3-3-L2' },
      ],
    })
    const { plan } = bind([half], area('Chiller', 3, 3), new Map([['Chiller', 4]]))

    expect(plan.units).toBe(0)
    expect(plan.moves).toEqual([
      { id: 22, parent_id: 20, materialized_path: 'MAIN/MAIN-Z4/MAIN-R-3-3/MAIN-R-3-3-L2' },
    ])
  })
})

// ── the properties that matter ──────────────────────────────────────────────

describe('idempotence', () => {
  it('replaying a settled site yields no moves', () => {
    const objects = [...area('Chiller', 0, 0, 4, 2), ...area('Bulk', 4, 0, 4, 2)]
    const profiles = new Map([['Chiller', 4], ['Bulk', 1]])
    const units = [
      unit({ id: 10, x: 0, y: 0, code: 'A' }),
      unit({ id: 11, x: 5, y: 1, code: 'B' }),
      unit({ id: 12, x: 9, y: 9, code: 'C' }),
      unit({
        id: 13, x: 2, y: 1, code: 'D',
        levels: [{ id: 14, code: 'D-L1', path: 'MAIN/D/D-L1' }],
      }),
    ]

    const first = bind(units, objects, profiles).plan
    expect(first.moves.length).toBeGreaterThan(0)

    const second = bind(settle(units, first.moves), objects, profiles).plan
    expect(second.moves).toEqual([])
    expect(second.unchanged).toBe(units.length)
  })

  it('is idempotent through an erase as well', () => {
    const units = [unit({ id: 10, x: 3, y: 3, code: 'A' })]
    const bound = settle(units, bind(units, area('Chiller', 3, 3), new Map([['Chiller', 4]])).plan.moves)

    const erased = bind(bound, [], new Map()).plan
    expect(erased.moves).toHaveLength(1)
    expect(bind(settle(bound, erased.moves), [], new Map()).plan.moves).toEqual([])
  })
})

describe('order independence', () => {
  it('produces the same moves whatever order the placements arrive in', () => {
    const objects = [...area('Chiller', 0, 0, 4, 4), ...area('Bulk', 4, 0, 4, 4)]
    const profiles = new Map([['Chiller', 4], ['Bulk', 1]])
    const units = Array.from({ length: 12 }, (_, i) =>
      unit({ id: 100 + i, x: i % 8, y: Math.floor(i / 8), code: `C${i}` }))

    const expected = bind(units, objects, profiles).plan.moves
    for (const seed of [1, 7, 99]) {
      expect(bind(shuffle(units, seed), objects, profiles).plan.moves).toEqual(expected)
    }
  })
})

// ── the preview ─────────────────────────────────────────────────────────────

describe('byArea summary', () => {
  it('groups by area and counts what actually moves', () => {
    const objects = [...area('Chiller', 0, 0, 2, 1), ...area('Bulk', 2, 0, 2, 1)]
    const units = [
      unit({ id: 10, x: 0, y: 0, code: 'A' }),
      unit({ id: 11, x: 1, y: 0, code: 'B' }),
      // Already bound — counted in `units`, not in `moved`.
      unit({ id: 12, x: 2, y: 0, code: 'C', parentId: BULK.id, path: 'MAIN/MAIN-Z1/C' }),
      unit({ id: 13, x: 9, y: 9, code: 'D' }),
    ]
    const { plan } = bind(units, objects, new Map([['Chiller', 4], ['Bulk', 1]]))

    expect(plan.byArea).toEqual([
      { areaName: '', profileId: null, zoneId: null, units: 1, moved: 0, unitIds: [13] },
      { areaName: 'Bulk', profileId: 1, zoneId: BULK.id, units: 1, moved: 0, unitIds: [12] },
      { areaName: 'Chiller', profileId: 4, zoneId: COLD.id, units: 2, moved: 2, unitIds: [10, 11] },
    ])
  })
})

describe('categoryConflicts', () => {
  const objects = area('Chiller', 0, 0, 2, 1)
  const units = [
    unit({ id: 10, x: 0, y: 0, code: 'A' }),
    unit({ id: 11, x: 1, y: 0, code: 'B' }),
  ]
  const plan = () => bind(units, objects, new Map([['Chiller', 4]])).plan

  it('names the bins whose stock the profile would refuse', () => {
    const conflicts = categoryConflicts(
      plan(),
      new Map([[4, ['Frozen', 'Chilled']]]),
      new Map([[10, ['Dry Goods']], [11, ['Chilled']]]),
    )
    expect(conflicts).toEqual([
      { areaName: 'Chiller', profileId: 4, bins: 1, categories: ['Dry Goods'] },
    ])
  })

  it('treats a null allow-list as "any category"', () => {
    expect(categoryConflicts(plan(), new Map([[4, null]]), new Map([[10, ['Dry Goods']]]))).toEqual([])
  })

  it('treats an empty allow-list as "any category" too', () => {
    expect(categoryConflicts(plan(), new Map([[4, []]]), new Map([[10, ['Dry Goods']]]))).toEqual([])
  })

  it('says nothing about an empty bin', () => {
    expect(categoryConflicts(plan(), new Map([[4, ['Frozen']]]), new Map())).toEqual([])
  })
})
