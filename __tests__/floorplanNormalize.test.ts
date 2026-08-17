import { describe, it, expect } from 'vitest'

import {
  normalizeFloorplan,
  resolveObjectOverlaps,
  MAX_GRID_WIDTH,
  MAX_GRID_HEIGHT,
  type FloorplanExtraction,
  type NormalizedObject,
} from '../supabase/functions/_shared/floorplan/extractionSchema'

function extraction(partial: Partial<FloorplanExtraction>): FloorplanExtraction {
  return {
    gridWidth: 20,
    gridHeight: 15,
    floors: 1,
    objects: [],
    zones: [],
    rackRows: [],
    palletAreas: [],
    confidence: 0.9,
    notes: '',
    ...partial,
  }
}

const opts = { warehouseId: 5, warehouseCode: 'WH5' }

describe('normalizeFloorplan', () => {
  it('clamps the grid to the raised 120×80 bounds', () => {
    const d = normalizeFloorplan(extraction({ gridWidth: 5000, gridHeight: 2, floors: 99 }), opts)
    expect(d.gridWidth).toBe(MAX_GRID_WIDTH)
    expect(d.gridHeight).toBe(10) // min 10
    expect(d.floors).toBe(10)
    expect(MAX_GRID_WIDTH).toBe(120)
    expect(MAX_GRID_HEIGHT).toBe(80)
  })

  describe('rackRows → bays', () => {
    it('distributes exactly one bay per cell when bayCount is 0 (unknown)', () => {
      const d = normalizeFloorplan(
        extraction({ rackRows: [{ code: 'R1', x: 2, y: 3, w: 4, h: 1, floor: 0, bayCount: 0, storageTypeHint: '' }] }),
        opts,
      )
      expect(d.placements).toHaveLength(4)
      expect(d.placements.map((p) => `${p.x},${p.y}`).sort()).toEqual(['2,3', '3,3', '4,3', '5,3'])
    })

    it('distributes bayCount === length identically to the unknown case', () => {
      const d = normalizeFloorplan(
        extraction({ rackRows: [{ code: 'R1', x: 0, y: 0, w: 5, h: 1, floor: 0, bayCount: 5, storageTypeHint: '' }] }),
        opts,
      )
      expect(d.placements).toHaveLength(5)
      expect(d.placements.map((p) => p.x).sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4])
    })

    it('spreads bayCount < length evenly across the row (fewer bays than cells)', () => {
      const d = normalizeFloorplan(
        extraction({ rackRows: [{ code: 'R1', x: 0, y: 0, w: 10, h: 1, floor: 0, bayCount: 2, storageTypeHint: '' }] }),
        opts,
      )
      // bay i at round((i+0.5)*10/2 - 0.5): i=0 -> round(2) = 2; i=1 -> round(7) = 7.
      expect(d.placements).toHaveLength(2)
      expect(d.placements.map((p) => p.x).sort((a, b) => a - b)).toEqual([2, 7])
    })

    it('caps bayCount > length to the row length (never more bays than cells)', () => {
      const d = normalizeFloorplan(
        extraction({ rackRows: [{ code: 'R1', x: 0, y: 0, w: 3, h: 1, floor: 0, bayCount: 999, storageTypeHint: '' }] }),
        opts,
      )
      expect(d.placements).toHaveLength(3)
    })

    it('runs bays along the vertical long axis when h > w', () => {
      const d = normalizeFloorplan(
        extraction({ rackRows: [{ code: 'R1', x: 4, y: 1, w: 1, h: 3, floor: 0, bayCount: 0, storageTypeHint: '' }] }),
        opts,
      )
      expect(d.placements).toHaveLength(3)
      expect(d.placements.every((p) => p.x === 4)).toBe(true)
      expect(d.placements.map((p) => p.y).sort((a, b) => a - b)).toEqual([1, 2, 3])
    })

    it('tags rackRow bays with zone profile + matched storage type', () => {
      const d = normalizeFloorplan(
        extraction({
          zones: [{ code: 'Z1', name: 'Cold', x: 0, y: 0, w: 5, h: 5, floor: 0, zoneType: 'cold' }],
          rackRows: [{ code: 'R1', x: 1, y: 1, w: 2, h: 1, floor: 0, bayCount: 0, storageTypeHint: 'pallet rack' }],
        }),
        { ...opts, zoneProfileByType: { cold: 42 }, storageTypeByToken: { 'pallet rack': 7 } },
      )
      expect(d.placements.every((p) => p.new_bin.zone_profile_id === 42)).toBe(true)
      expect(d.placements.every((p) => p.new_bin.storage_type_id === 7)).toBe(true)
    })
  })

  describe('cross-collection dedup + blocked cells', () => {
    it('dedupes a rackRow bay landing on the same cell as a legacy rack (shared seen-set)', () => {
      const d = normalizeFloorplan(
        extraction({
          rackRows: [{ code: 'R1', x: 2, y: 2, w: 1, h: 1, floor: 0, bayCount: 1, storageTypeHint: '' }],
          racks: [{ code: 'A', x: 2, y: 2, floor: 0, storageTypeHint: '' }],
        }),
        opts,
      )
      expect(d.placements).toHaveLength(1)
    })

    it('drops a rackRow bay landing on a wall/conveyor/obstacle cell', () => {
      const d = normalizeFloorplan(
        extraction({
          objects: [
            { type: 'wall', name: '', x: 0, y: 0, w: 1, h: 1, floor: 0 },
            { type: 'conveyor', name: '', x: 1, y: 0, w: 1, h: 1, floor: 0 },
            { type: 'obstacle', name: 'Office block', x: 2, y: 0, w: 1, h: 1, floor: 0 },
          ],
          rackRows: [{ code: 'R1', x: 0, y: 0, w: 3, h: 1, floor: 0, bayCount: 3, storageTypeHint: '' }],
        }),
        opts,
      )
      expect(d.placements).toHaveLength(0)
    })

    it('drops legacy racks landing on a blocked cell too', () => {
      const d = normalizeFloorplan(
        extraction({
          objects: [{ type: 'wall', name: '', x: 5, y: 5, w: 1, h: 1, floor: 0 }],
          racks: [{ code: 'A', x: 5, y: 5, floor: 0, storageTypeHint: '' }],
        }),
        opts,
      )
      expect(d.placements).toHaveLength(0)
    })
  })

  describe('objects: obstacle/staging meta.name + conveyor/staging pass-through', () => {
    it('gives obstacle/staging a meta.name when named, and omits it when unnamed', () => {
      const d = normalizeFloorplan(
        extraction({
          objects: [
            { type: 'obstacle', name: 'Office block', x: 0, y: 0, w: 2, h: 2, floor: 0 },
            { type: 'staging', name: 'Shipping & Receiving', x: 3, y: 0, w: 2, h: 2, floor: 0 },
            { type: 'obstacle', name: '', x: 6, y: 0, w: 1, h: 1, floor: 0 },
          ],
        }),
        opts,
      )
      const office = d.objects.find((o) => o.object_type === 'obstacle' && o.x === 0)
      const staging = d.objects.find((o) => o.object_type === 'staging')
      const unnamed = d.objects.find((o) => o.object_type === 'obstacle' && o.x === 6)
      expect(office?.meta).toEqual({ name: 'Office block' })
      expect(staging?.meta).toEqual({ name: 'Shipping & Receiving' })
      expect(unnamed?.meta).toBeUndefined()
    })

    it('passes conveyor and staging through as first-class object types', () => {
      const d = normalizeFloorplan(
        extraction({
          objects: [
            { type: 'conveyor', name: '', x: 0, y: 0, w: 5, h: 1, floor: 0 },
            { type: 'staging', name: 'Shipping & Receiving', x: 0, y: 2, w: 5, h: 5, floor: 0 },
          ],
        }),
        opts,
      )
      expect(d.objects.some((o) => o.object_type === 'conveyor')).toBe(true)
      expect(d.objects.some((o) => o.object_type === 'staging')).toBe(true)
      expect(d.objectCount).toBe(2) // both count as structure, neither is a label
    })
  })

  describe('pallet areas', () => {
    it('groups pallet-area bins under NormalizedPalletArea, unset storage type, NOT in draft.placements', () => {
      const d = normalizeFloorplan(
        extraction({ palletAreas: [{ code: 'PA1', x: 0, y: 0, w: 2, h: 2, floor: 0 }] }),
        opts,
      )
      expect(d.palletAreaCount).toBe(1)
      expect(d.palletAreas).toHaveLength(1)
      expect(d.palletAreas[0].code).toBe('PA1')
      expect(d.palletAreas[0].placements).toHaveLength(4) // 2x2 cells
      expect(d.palletAreas[0].placements.every((p) => p.new_bin.storage_type_id === undefined)).toBe(true)
      expect(d.placements).toHaveLength(0) // never folded into the base placements
    })

    it('skips pallet-area cells already seen (rackRow) or blocked (wall)', () => {
      const d = normalizeFloorplan(
        extraction({
          objects: [{ type: 'wall', name: '', x: 0, y: 0, w: 1, h: 1, floor: 0 }],
          rackRows: [{ code: 'R1', x: 1, y: 0, w: 1, h: 1, floor: 0, bayCount: 1, storageTypeHint: '' }],
          palletAreas: [{ code: 'PA1', x: 0, y: 0, w: 2, h: 1, floor: 0 }], // covers the wall cell + the rackRow cell
        }),
        opts,
      )
      expect(d.placements).toHaveLength(1) // the rackRow bay
      expect(d.palletAreas[0].placements).toHaveLength(0) // both its cells were blocked/seen
    })
  })

  describe('legacy racks (back-compat)', () => {
    it('emits warehouse-prefixed rack codes and 1×1 placements (no slug → legacy code)', () => {
      const d = normalizeFloorplan(extraction({ racks: [{ code: 'A', x: 3, y: 4, floor: 0, storageTypeHint: '' }] }), opts)
      expect(d.placements).toHaveLength(1)
      expect(d.placements[0].new_bin.code).toBe('WH5-B-3-4')
      expect(d.placements[0].new_bin.parent_id).toBe(5)
      expect(d.placements[0]).toMatchObject({ x: 3, y: 4, w: 1, h: 1, rotation: 0 })
    })

    it('folds a per-import slug into rack codes (unique against existing racks)', () => {
      const d = normalizeFloorplan(
        extraction({ racks: [{ code: 'A', x: 3, y: 4, floor: 0, storageTypeHint: '' }] }),
        { ...opts, codeSlug: 'a1b2c3d4-e5f6-7890-abcd-ef0123456789' },
      )
      // UPPERCASE: `normalizeScan` folds case, so a lowercase slug would let one
      // import mint a code that scans identically to another's.
      expect(d.placements[0].new_bin.code).toBe('WH5-B-A1B2C3D4-3-4')
    })

    it('dedupes racks sharing a cell and clamps out-of-bounds coords', () => {
      const d = normalizeFloorplan(extraction({
        gridWidth: 10, gridHeight: 10,
        racks: [
          { code: 'A', x: 2, y: 2, floor: 0, storageTypeHint: '' },
          { code: 'B', x: 2, y: 2, floor: 0, storageTypeHint: '' }, // dup cell → dropped
          { code: 'C', x: 999, y: 999, floor: 0, storageTypeHint: '' }, // clamps to (9,9)
        ],
      }), opts)
      expect(d.placements).toHaveLength(2)
      expect(d.placements[1].new_bin.code).toBe('WH5-B-9-9')
    })

    it('maps a storage-type hint onto a catalogue id (loose contains match)', () => {
      const d = normalizeFloorplan(
        extraction({ racks: [{ code: 'A', x: 1, y: 1, floor: 0, storageTypeHint: 'pallet rack' }] }),
        { ...opts, storageTypeByToken: { 'pallet rack': 7, shelving: 8 } },
      )
      expect(d.placements[0].new_bin.storage_type_id).toBe(7)
    })
  })

  it('turns zones into non-blocking label objects and counts structure separately', () => {
    const d = normalizeFloorplan(extraction({
      objects: [{ type: 'wall', name: '', x: 0, y: 0, w: 20, h: 1, floor: 0 }],
      zones: [{ code: 'Z', name: 'Bulk', x: 0, y: 2, w: 4, h: 4, floor: 0, zoneType: 'bulk' }],
    }), opts)
    expect(d.zoneCount).toBe(1)
    expect(d.objectCount).toBe(1) // the wall, not the label
    const label = d.objects.find((o) => o.object_type === 'label')
    expect(label?.meta).toMatchObject({ name: 'Bulk', zoneType: 'bulk' })
  })
})

describe('resolveObjectOverlaps', () => {
  it('keeps the dock intact and clips the wall around it (dock beats wall)', () => {
    const objects: NormalizedObject[] = [
      { object_type: 'wall', floor: 0, x: 0, y: 0, w: 10, h: 1 },
      { object_type: 'dock', floor: 0, x: 3, y: 0, w: 2, h: 1 },
    ]
    const resolved = resolveObjectOverlaps(objects)

    const dock = resolved.find((o) => o.object_type === 'dock')
    expect(dock).toEqual({ object_type: 'dock', floor: 0, x: 3, y: 0, w: 2, h: 1 })

    const wallCells = resolved
      .filter((o) => o.object_type === 'wall')
      .flatMap((o) => Array.from({ length: o.w }, (_, i) => o.x + i))
    expect(wallCells.sort((a, b) => a - b)).toEqual([0, 1, 2, 5, 6, 7, 8, 9])
    // Neither wall fragment overlaps the dock's cells.
    expect(wallCells).not.toContain(3)
    expect(wallCells).not.toContain(4)
  })

  it('clips a conveyor against an overlapping wall (wall outranks conveyor)', () => {
    const objects: NormalizedObject[] = [
      { object_type: 'wall', floor: 0, x: 0, y: 0, w: 4, h: 1 },
      { object_type: 'conveyor', floor: 0, x: 2, y: 0, w: 4, h: 1 },
    ]
    const resolved = resolveObjectOverlaps(objects)

    const wall = resolved.find((o) => o.object_type === 'wall')
    expect(wall).toEqual({ object_type: 'wall', floor: 0, x: 0, y: 0, w: 4, h: 1 })

    const conveyor = resolved.find((o) => o.object_type === 'conveyor')
    expect(conveyor).toEqual({ object_type: 'conveyor', floor: 0, x: 4, y: 0, w: 2, h: 1 })
  })

  it('rebuilds a partial-overlap survivor set into non-overlapping fragments that exactly cover the surviving cells', () => {
    const objects: NormalizedObject[] = [
      { object_type: 'obstacle', floor: 0, x: 0, y: 0, w: 4, h: 4, meta: { name: 'Office block' } },
      { object_type: 'dock', floor: 0, x: 2, y: 2, w: 2, h: 2 }, // carves the bottom-right 2x2 corner out of the obstacle
    ]
    const resolved = resolveObjectOverlaps(objects)

    const dock = resolved.find((o) => o.object_type === 'dock')
    expect(dock).toEqual({ object_type: 'dock', floor: 0, x: 2, y: 2, w: 2, h: 2 })

    const fragments = resolved.filter((o) => o.object_type === 'obstacle')
    const coveredCells = new Set<string>()
    for (const f of fragments) {
      for (let dy = 0; dy < f.h; dy++) {
        for (let dx = 0; dx < f.w; dx++) {
          const key = `${f.x + dx},${f.y + dy}`
          expect(coveredCells.has(key)).toBe(false) // fragments never overlap each other
          coveredCells.add(key)
        }
      }
    }
    // 4x4 (16 cells) minus the 2x2 dock corner (4 cells) = 12 surviving cells.
    expect(coveredCells.size).toBe(12)
    for (const key of coveredCells) {
      const [x, y] = key.split(',').map(Number)
      expect(x >= 2 && x < 4 && y >= 2 && y < 4).toBe(false) // none inside the dock's footprint
    }
  })

  it('keeps meta only on the largest fragment when an object is split', () => {
    const objects: NormalizedObject[] = [
      { object_type: 'staging', floor: 0, x: 0, y: 0, w: 10, h: 1, meta: { name: 'Shipping & Receiving' } },
      { object_type: 'dock', floor: 0, x: 3, y: 0, w: 1, h: 1 },
    ]
    const resolved = resolveObjectOverlaps(objects)

    const stagingFragments = resolved.filter((o) => o.object_type === 'staging')
    expect(stagingFragments).toHaveLength(2) // split around the dock cell at x=3: [0,1,2] and [4..9]

    const withMeta = stagingFragments.filter((f) => f.meta)
    expect(withMeta).toHaveLength(1)
    expect(withMeta[0].meta).toEqual({ name: 'Shipping & Receiving' })
    expect(withMeta[0]).toMatchObject({ x: 4, w: 6 }) // the larger fragment (w=6 vs w=3)
  })

  it('drops an object with zero surviving cells (fully covered by a higher-priority object)', () => {
    const objects: NormalizedObject[] = [
      { object_type: 'walkway', floor: 0, x: 1, y: 1, w: 2, h: 2 },
      { object_type: 'wall', floor: 0, x: 0, y: 0, w: 5, h: 5 }, // fully covers the walkway
    ]
    const resolved = resolveObjectOverlaps(objects)

    expect(resolved.some((o) => o.object_type === 'walkway')).toBe(false)
    expect(resolved.filter((o) => o.object_type === 'wall')).toHaveLength(1)
  })

  it('dedupes two overlapping objects of the same type, keeping the earlier one', () => {
    const objects: NormalizedObject[] = [
      { object_type: 'wall', floor: 0, x: 0, y: 0, w: 5, h: 1 },
      { object_type: 'wall', floor: 0, x: 0, y: 0, w: 5, h: 1 }, // exact duplicate
    ]
    const resolved = resolveObjectOverlaps(objects)

    expect(resolved).toHaveLength(1)
    expect(resolved[0]).toEqual({ object_type: 'wall', floor: 0, x: 0, y: 0, w: 5, h: 1 })
  })

  it('passes label objects through untouched and excludes them from rasterization', () => {
    const objects: NormalizedObject[] = [
      { object_type: 'label', floor: 0, x: 0, y: 0, w: 5, h: 5, meta: { code: 'Z1', name: 'Bulk', zoneType: 'bulk' } },
      { object_type: 'wall', floor: 0, x: 2, y: 2, w: 2, h: 2 },
    ]
    const resolved = resolveObjectOverlaps(objects)

    const label = resolved.find((o) => o.object_type === 'label')
    expect(label).toEqual(objects[0])
    // The label never contests cells — the wall keeps its full footprint.
    const wall = resolved.find((o) => o.object_type === 'wall')
    expect(wall).toEqual(objects[1])
  })

  it('integration: normalizeFloorplan cleans an overlapping conveyor+wall extraction so bin placement avoids both', () => {
    const d = normalizeFloorplan(
      extraction({
        objects: [
          { type: 'conveyor', name: '', x: 0, y: 0, w: 6, h: 1, floor: 0 },
          { type: 'wall', name: '', x: 2, y: 0, w: 6, h: 1, floor: 0 }, // overlaps the conveyor
        ],
        rackRows: [{ code: 'R1', x: 0, y: 0, w: 8, h: 1, floor: 0, bayCount: 8, storageTypeHint: '' }],
      }),
      opts,
    )

    // Wall (higher priority) keeps its full footprint x=2..7; the conveyor is
    // clipped down to the remaining x=0..1.
    const wall = d.objects.find((o) => o.object_type === 'wall')
    const conveyorFragments = d.objects.filter((o) => o.object_type === 'conveyor')
    expect(wall).toMatchObject({ x: 2, w: 6 })
    expect(conveyorFragments).toEqual([{ object_type: 'conveyor', floor: 0, x: 0, y: 0, w: 2, h: 1 }])

    // The union of wall+conveyor now covers x=0..7 — every rackRow bay in
    // that span is blocked, so no bins land on top of either.
    expect(d.placements).toHaveLength(0)
  })
})
