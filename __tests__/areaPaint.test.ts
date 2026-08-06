import { describe, it, expect } from 'vitest'
import {
  areaCellsFingerprint,
  areaObjectsFromSpecs,
  areaSpecsFromObjects,
  areaZoneProfileOf,
  diffAreas,
  expandAreaRuns,
  packAreaRuns,
  type AreaPaintCell,
} from '@/supabase/functions/_shared/wie/areaPaint'
import { type AreaCellSource } from '@/supabase/functions/_shared/wie/locationNaming'

// ── helpers ─────────────────────────────────────────────────────────────────

function cells(spec: string, floor = 0): AreaPaintCell[] {
  // Each line is a row; '#' is a painted cell. Lets a ragged shape be written
  // out rather than described.
  const out: AreaPaintCell[] = []
  spec.trim().split('\n').forEach((line, y) => {
    ;[...line.trim()].forEach((ch, x) => {
      if (ch === '#') out.push({ floor, x, y })
    })
  })
  return out
}

function objects(name: string, cs: readonly AreaPaintCell[], zoneProfileId: number | null = null): AreaCellSource[] {
  return cs.map((c) => ({
    objectType: 'area', floor: c.floor, x: c.x, y: c.y, w: 1, h: 1,
    meta: { name, zoneProfileId },
  }))
}

// ── run packing ─────────────────────────────────────────────────────────────

describe('packAreaRuns / expandAreaRuns', () => {
  it('round-trips a ragged shape with holes', () => {
    const shape = cells(`
      ###..#
      #..###
      ######
    `)
    expect(expandAreaRuns(packAreaRuns(shape))).toEqual([...shape].sort(
      (a, b) => (a.y - b.y) || (a.x - b.x),
    ))
  })

  it('packs contiguous cells into one run and breaks on a gap', () => {
    expect(packAreaRuns(cells('###..##'))).toEqual([
      { floor: 0, y: 0, x: 0, len: 3 },
      { floor: 0, y: 0, x: 5, len: 2 },
    ])
  })

  it('never merges across rows or floors', () => {
    const mixed = [...cells('##'), ...cells('##', 1)]
    const runs = packAreaRuns(mixed)
    expect(runs).toHaveLength(2)
    expect(runs.map((r) => r.floor).sort()).toEqual([0, 1])
  })

  it('deduplicates and canonicalises order', () => {
    const dupes: AreaPaintCell[] = [
      { floor: 0, x: 2, y: 0 }, { floor: 0, x: 0, y: 0 },
      { floor: 0, x: 1, y: 0 }, { floor: 0, x: 1, y: 0 },
    ]
    expect(packAreaRuns(dupes)).toEqual([{ floor: 0, y: 0, x: 0, len: 3 }])
  })

  it('handles a full 120x80 floor as one run per row', () => {
    const full: AreaPaintCell[] = []
    for (let y = 0; y < 80; y++) for (let x = 0; x < 120; x++) full.push({ floor: 0, x, y })
    const runs = packAreaRuns(full)
    expect(runs).toHaveLength(80)
    expect(runs.every((r) => r.len === 120)).toBe(true)
    expect(expandAreaRuns(runs)).toHaveLength(9600)
  })
})

// ── folding ─────────────────────────────────────────────────────────────────

describe('areaSpecsFromObjects', () => {
  it('groups by name, sorts, and expands a legacy multi-cell row', () => {
    const legacy: AreaCellSource[] = [
      { objectType: 'area', floor: 0, x: 0, y: 0, w: 3, h: 2, meta: { name: 'Chiller' } },
      { objectType: 'area', floor: 0, x: 9, y: 0, w: 1, h: 1, meta: { name: 'Bulk' } },
      { objectType: 'wall', floor: 0, x: 5, y: 5, w: 1, h: 1, meta: null },
    ]
    const specs = areaSpecsFromObjects(legacy)
    expect(specs.map((s) => s.name)).toEqual(['Bulk', 'Chiller'])
    expect(specs.find((s) => s.name === 'Chiller')!.cells).toHaveLength(6)
  })

  it('ignores unnamed and non-area rows', () => {
    expect(areaSpecsFromObjects([
      { objectType: 'area', floor: 0, x: 0, y: 0, w: 1, h: 1, meta: { name: '   ' } },
      { objectType: 'walkway', floor: 0, x: 1, y: 0, w: 1, h: 1, meta: { name: 'Nope' } },
    ])).toEqual([])
  })

  it('reads the zone profile, normalising a missing one to null', () => {
    expect(areaZoneProfileOf({ meta: { zoneProfileId: 4 } })).toBe(4)
    expect(areaZoneProfileOf({ meta: { zoneProfileId: null } })).toBeNull()
    expect(areaZoneProfileOf({ meta: {} })).toBeNull()
    expect(areaSpecsFromObjects(objects('Chiller', cells('##'), 7))[0].zoneProfileId).toBe(7)
  })

  it('round-trips through areaObjectsFromSpecs as 1x1 rows', () => {
    const source = objects('Chiller', cells('###\n#.#'), 3)
    const rebuilt = areaObjectsFromSpecs(areaSpecsFromObjects(source))
    expect(rebuilt.every((o) => o.w === 1 && o.h === 1)).toBe(true)
    expect(areaCellsFingerprint(rebuilt)).toBe(areaCellsFingerprint(source))
  })
})

// ── fingerprint ─────────────────────────────────────────────────────────────

describe('areaCellsFingerprint', () => {
  const shape = cells('###\n.##')

  it('is independent of row order', () => {
    const source = objects('Chiller', shape)
    expect(areaCellsFingerprint([...source].reverse())).toBe(areaCellsFingerprint(source))
  })

  it('is independent of how cells were split across rows', () => {
    const asOneRow: AreaCellSource[] = [
      { objectType: 'area', floor: 0, x: 0, y: 0, w: 3, h: 1, meta: { name: 'Chiller', zoneProfileId: null } },
    ]
    expect(areaCellsFingerprint(asOneRow)).toBe(areaCellsFingerprint(objects('Chiller', cells('###'))))
  })

  it('ignores duplicate rows describing the same cell', () => {
    const source = objects('Chiller', shape)
    expect(areaCellsFingerprint([...source, ...source])).toBe(areaCellsFingerprint(source))
  })

  it('changes when the NAME changes but the cell count does not', () => {
    // The case a bare count comparison would miss, and the one worth catching.
    expect(areaCellsFingerprint(objects('Cold Room', shape)))
      .not.toBe(areaCellsFingerprint(objects('Chiller', shape)))
  })

  it('changes when a cell moves, a floor changes, or a profile changes', () => {
    const base = areaCellsFingerprint(objects('Chiller', shape))
    expect(areaCellsFingerprint(objects('Chiller', cells('###\n##.')))).not.toBe(base)
    expect(areaCellsFingerprint(objects('Chiller', cells('###\n.##', 1)))).not.toBe(base)
    expect(areaCellsFingerprint(objects('Chiller', shape, 2))).not.toBe(base)
  })

  it('is stable, and empty is not a special case', () => {
    expect(areaCellsFingerprint([])).toBe(areaCellsFingerprint([]))
    expect(areaCellsFingerprint([])).not.toBe(areaCellsFingerprint(objects('Chiller', shape)))
    expect(areaCellsFingerprint(objects('Chiller', shape))).toHaveLength(16)
  })
})

// ── diff ────────────────────────────────────────────────────────────────────

describe('diffAreas', () => {
  const chiller = objects('Chiller', cells('####'))

  it('reports an unchanged picture', () => {
    const delta = diffAreas(chiller, chiller)
    expect(delta.unchanged).toBe(true)
    expect(delta.cellsAfter).toBe(4)
  })

  it('reports a created and an erased area', () => {
    expect(diffAreas([], chiller).created).toEqual(['Chiller'])
    expect(diffAreas(chiller, []).erased).toEqual(['Chiller'])
    expect(diffAreas(chiller, []).cellsAfter).toBe(0)
  })

  it('reports a shrink with both counts', () => {
    const delta = diffAreas(chiller, objects('Chiller', cells('##')))
    expect(delta.resized).toEqual([{ name: 'Chiller', before: 4, after: 2, added: 0, removed: 2 }])
    expect(delta.unchanged).toBe(false)
  })

  it('reports a pure MOVE, which a count comparison would miss', () => {
    const moved = objects('Chiller', [
      { floor: 0, x: 10, y: 0 }, { floor: 0, x: 11, y: 0 },
      { floor: 0, x: 12, y: 0 }, { floor: 0, x: 13, y: 0 },
    ])
    expect(diffAreas(chiller, moved).resized).toEqual([
      { name: 'Chiller', before: 4, after: 4, added: 4, removed: 4 },
    ])
  })

  it('reports a zone-profile-only change and nothing else', () => {
    const delta = diffAreas(chiller, objects('Chiller', cells('####'), 5))
    expect(delta.resized).toEqual([])
    expect(delta.reprofiled).toEqual([{ name: 'Chiller', before: null, after: 5 }])
    expect(delta.unchanged).toBe(false)
  })

  it('treats a rename as an erase plus a create, which is what it means', () => {
    // Deliberate: paint_areas reads the before-picture from the database, so
    // "renamed Chiller to Cold Room" and "erased Chiller, painted Cold Room over
    // the same cells" produce the same plan — because both mean the same thing.
    const delta = diffAreas(chiller, objects('Cold Room', cells('####')))
    expect(delta.created).toEqual(['Cold Room'])
    expect(delta.erased).toEqual(['Chiller'])
  })
})
