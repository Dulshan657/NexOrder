// Turning what was painted into what a sweep can plan.
//
// The rolling-up rules are the ones worth pinning: a levelled rack holds no
// placement row of ITS OWN — its SHELF children do — so every one of these functions
// has to fold a hit up to the rack and then find geometry for a row that has none.
// Getting that wrong does not throw; the rack silently drops out of the numbering.

import { describe, it, expect } from 'vitest'
import {
  areasOfSelection,
  blockCensus,
  buildLevelIdsByRack,
  buildUnitPlacements,
  incumbentsOfBlock,
  takenCodesFromLocations,
  unitsAtCell,
  unitsFromSelection,
  unitsInArea,
  unitsInRect,
  warehouseCodeOf,
} from '@/components/inventory/warehouse/recode/recodeGeometry'
import type { InventoryLocation } from '@/types'

const loc = (over: Partial<InventoryLocation> & { id: number }): InventoryLocation => ({
  kind: 'BIN', code: `C${over.id}`, name: `N${over.id}`, isActive: true,
  materializedPath: `AMD/C${over.id}`, parentId: null, ...over,
}) as InventoryLocation

const byId = (list: InventoryLocation[]) => new Map(list.map((l) => [l.id, l]))
const p = (locationId: number, x: number, y: number, w = 1, h = 1, floor = 0) =>
  ({ locationId, x, y, w, h, floor }) as any

/** A flat bin, and a 2-cell rack whose two SHELF levels carry the placements. */
const locations = byId([
  loc({ id: 1, code: 'AMD-B-0-0', materializedPath: 'AMD/AMD-B-0-0' }),
  loc({ id: 2, kind: 'RACK', code: 'AMD-B-4-0', materializedPath: 'AMD/AMD-B-4-0' }),
  loc({ id: 21, kind: 'SHELF', parentId: 2, levelIndex: 1, code: 'AMD-B-4-0-L1' }),
  loc({ id: 22, kind: 'SHELF', parentId: 2, levelIndex: 2, code: 'AMD-B-4-0-L2' }),
  loc({ id: 3, kind: 'ZONE', code: 'AMD-Z1', materializedPath: 'AMD/AMD-Z1' }),
])
const placements = [p(1, 0, 0), p(21, 4, 0, 2, 1), p(22, 4, 0, 2, 1), p(3, 9, 9)]

describe('warehouseCodeOf', () => {
  it('reads the site code off the head of any path, with no extra query', () => {
    expect(warehouseCodeOf(locations)).toBe('AMD')
  })

  it('is empty rather than throwing when nothing is loaded', () => {
    expect(warehouseCodeOf(new Map())).toBe('')
  })
})

describe('buildLevelIdsByRack', () => {
  it('groups SHELF children under their rack', () => {
    expect(buildLevelIdsByRack(locations).get(2)).toEqual([21, 22])
  })
})

describe('unitsAtCell', () => {
  it('takes a flat bin', () => {
    expect(unitsAtCell(placements, locations, 0, 0, 0)).toEqual([1])
  })

  // The rolling-up rule. Painting a level selects the RACK, and painting either of
  // the rack's two cells selects it once, not twice.
  it('folds a painted level up to its rack, and dedupes the levels', () => {
    expect(unitsAtCell(placements, locations, 0, 4, 0)).toEqual([2])
    expect(unitsAtCell(placements, locations, 0, 5, 0)).toEqual([2])
  })

  it('refuses a ZONE, which the server would refuse anyway', () => {
    expect(unitsAtCell(placements, locations, 0, 9, 9)).toEqual([])
  })

  it('takes nothing from empty floor', () => {
    expect(unitsAtCell(placements, locations, 0, 7, 7)).toEqual([])
  })
})

describe('unitsInRect', () => {
  // THE REPORTED BUG. A band that clips one cell of the 2-cell rack must leave it.
  it('leaves a rack the band only half covers', () => {
    expect(unitsInRect(placements, locations, { floor: 0, x0: 0, y0: 0, x1: 4, y1: 0 }))
      .toEqual([1])
  })

  it('takes it once the band covers all of it', () => {
    expect(unitsInRect(placements, locations, { floor: 0, x0: 0, y0: 0, x1: 5, y1: 0 }).sort())
      .toEqual([1, 2])
  })
})

describe('buildUnitPlacements', () => {
  // A rack has no placement of its own; it borrows its first level's, which is
  // correct because every level sits on the same cells. Without this the rack has no
  // (x,y) to frame and silently falls out of the numbering.
  it('gives a levelled rack the geometry of its lowest level', () => {
    const map = buildUnitPlacements(placements, locations)
    expect(map.get(2)).toMatchObject({ x: 4, y: 0, w: 2 })
    expect(map.get(1)).toMatchObject({ x: 0, y: 0 })
    expect(map.has(3)).toBe(false)
  })
})

describe('unitsFromSelection', () => {
  const unitPlacements = buildUnitPlacements(placements, locations)
  const levels = buildLevelIdsByRack(locations)

  it('carries a rack\'s levels so they ride in the same batch', () => {
    const [rack] = unitsFromSelection(new Set([2]), locations, unitPlacements, levels)
    expect(rack.levels?.map((l) => l.levelIndex)).toEqual([1, 2])
    expect(rack.x).toBe(4)
  })

  it('leaves a flat bin with no levels at all, rather than an empty array', () => {
    const [bin] = unitsFromSelection(new Set([1]), locations, unitPlacements, levels)
    expect(bin.levels).toBeUndefined()
  })

  it('skips a selected id with no geometry rather than inventing a cell', () => {
    expect(unitsFromSelection(new Set([999]), locations, unitPlacements, levels)).toEqual([])
  })
})

describe('incumbentsOfBlock', () => {
  const swept = byId([
    loc({ id: 1, code: 'AMD-BULK-1-1', codeBlock: 'BULK', codeSeq: 1 }),
    loc({ id: 2, code: 'AMD-BULK-1-2', codeBlock: 'BULK', codeSeq: 2 }),
    loc({ id: 3, code: 'AMD-COLD-1-1', codeBlock: 'COLD', codeSeq: 1 }),
    loc({ id: 4, code: 'AMD-B-9-9' }),
  ])
  const pl = [p(1, 0, 0), p(2, 1, 0), p(3, 5, 0), p(4, 6, 0)]
  const up = buildUnitPlacements(pl, swept)
  const lv = buildLevelIdsByRack(swept)

  it('finds the other members of the block being grown', () => {
    expect(incumbentsOfBlock('BULK', new Set([2]), swept, up, lv).map((u) => u.id)).toEqual([1])
  })

  it('excludes everything already in the selection', () => {
    expect(incumbentsOfBlock('BULK', new Set([1, 2]), swept, up, lv)).toEqual([])
  })

  it('matches the SANITIZED block, so a half-typed name finds the same members', () => {
    expect(incumbentsOfBlock('bulk', new Set(), swept, up, lv).map((u) => u.id).sort())
      .toEqual([1, 2])
  })

  it('is empty for a blank block rather than matching every un-swept bin', () => {
    expect(incumbentsOfBlock('', new Set(), swept, up, lv)).toEqual([])
  })
})

describe('blockCensus', () => {
  const swept = byId([
    loc({ id: 1, codeBlock: 'BULK', codeSeq: 1 }),
    loc({ id: 2, codeBlock: 'BULK', codeSeq: 4 }),
    loc({ id: 3, codeBlock: 'COLD', codeSeq: 1 }),
    loc({ id: 4 }),
    loc({ id: 5 }),
  ])

  // `code_block IS NULL` is the provenance signal 00107 added, and it means exactly
  // "not minted by a pattern" — so the un-swept count is a fact, not a heuristic.
  it('counts what has been swept against what could be', () => {
    const census = blockCensus(swept, new Set([1, 2, 3, 4, 5]))
    expect(census.swept).toBe(3)
    expect(census.total).toBe(5)
  })

  it('reports each block with its range, sorted', () => {
    const { blocks } = blockCensus(swept, new Set([1, 2, 3, 4, 5]))
    expect(blocks.map((b) => b.block)).toEqual(['BULK', 'COLD'])
    expect(blocks[0]).toMatchObject({ units: 2, minSeq: 1, maxSeq: 4 })
    expect(blocks[0].ids.sort()).toEqual([1, 2])
  })

  it('counts only the sweepable set it is given', () => {
    expect(blockCensus(swept, new Set([4])).total).toBe(1)
  })
})

describe('takenCodesFromLocations', () => {
  // Lowercased, because `normalizeScan` folds case: two codes differing only in case
  // are two rows to the UNIQUE constraint and ONE key to the scan resolver.
  it('folds case, mapping to the owning id', () => {
    expect(takenCodesFromLocations(byId([loc({ id: 7, code: 'AMD-A01' })])).get('amd-a01')).toBe(7)
  })
})

describe('areasOfSelection', () => {
  const objects = [
    { objectType: 'area', floor: 0, x: 0, y: 0, w: 1, h: 1, meta: { name: 'Bulk' } },
    { objectType: 'area', floor: 0, x: 5, y: 0, w: 1, h: 1, meta: { name: 'Chiller' } },
  ] as any[]
  const up = new Map([[1, p(1, 0, 0)], [2, p(2, 5, 0)]])

  it('names every area a selection spans, so a crossing is visible before Apply', () => {
    expect(areasOfSelection(new Set([1, 2]), up, objects)).toEqual(['Bulk', 'Chiller'])
  })

  it('is a single name when the selection stays inside one', () => {
    expect(areasOfSelection(new Set([1]), up, objects)).toEqual(['Bulk'])
  })

  it('omits unpainted ground rather than reporting an empty name', () => {
    expect(areasOfSelection(new Set([1, 2]), new Map([[1, p(1, 9, 9)]]), objects)).toEqual([])
  })
})

describe('unitsInArea', () => {
  const objects = [
    { objectType: 'area', floor: 0, x: 0, y: 0, w: 1, h: 1, meta: { name: 'Bulk' } },
    { objectType: 'area', floor: 0, x: 1, y: 0, w: 1, h: 1, meta: { name: 'Bulk' } },
  ] as any[]

  it('selects every sweepable unit standing on the area', () => {
    expect(unitsInArea([p(1, 0, 0), p(9, 7, 7)], locations, objects, 'Bulk')).toEqual([1])
  })
})
