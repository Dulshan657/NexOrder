import { describe, it, expect } from 'vitest'

import { normalizeFloorplan, type FloorplanExtraction } from '../supabase/functions/_shared/floorplan/extractionSchema'

function extraction(partial: Partial<FloorplanExtraction>): FloorplanExtraction {
  return {
    gridWidth: 20,
    gridHeight: 15,
    floors: 1,
    objects: [],
    zones: [],
    racks: [],
    confidence: 0.9,
    notes: '',
    ...partial,
  }
}

const opts = { warehouseId: 5, warehouseCode: 'WH5' }

describe('normalizeFloorplan', () => {
  it('clamps the grid to allowed bounds', () => {
    const d = normalizeFloorplan(extraction({ gridWidth: 500, gridHeight: 2, floors: 99 }), opts)
    expect(d.gridWidth).toBe(60)
    expect(d.gridHeight).toBe(10) // min 10
    expect(d.floors).toBe(10)
  })

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
    // First 8 alphanumerics of the UUID, lowercased, as a code segment.
    expect(d.placements[0].new_bin.code).toBe('WH5-B-a1b2c3d4-3-4')
  })

  it('gives different imports disjoint code sets for the same cells', () => {
    const racks = [
      { code: 'A', x: 1, y: 1, floor: 0, storageTypeHint: '' },
      { code: 'B', x: 2, y: 3, floor: 0, storageTypeHint: '' },
    ]
    const a = normalizeFloorplan(extraction({ racks }), { ...opts, codeSlug: 'import-aaaa' })
    const b = normalizeFloorplan(extraction({ racks }), { ...opts, codeSlug: 'import-bbbb' })
    const codesA = a.placements.map((p) => p.new_bin.code)
    const codesB = b.placements.map((p) => p.new_bin.code)
    expect(codesA.some((c) => codesB.includes(c))).toBe(false)
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

  it('tags a rack with the profile of the zone it sits inside', () => {
    const d = normalizeFloorplan(
      extraction({
        zones: [{ code: 'Z1', name: 'Cold', x: 0, y: 0, w: 5, h: 5, floor: 0, zoneType: 'cold' }],
        racks: [
          { code: 'in', x: 1, y: 1, floor: 0, storageTypeHint: '' },
          { code: 'out', x: 8, y: 8, floor: 0, storageTypeHint: '' },
        ],
      }),
      { ...opts, zoneProfileByType: { cold: 42 } },
    )
    const inside = d.placements.find((p) => p.x === 1)
    const outside = d.placements.find((p) => p.x === 8)
    expect(inside?.new_bin.zone_profile_id).toBe(42)
    expect(outside?.new_bin.zone_profile_id).toBeUndefined()
  })

  it('maps a storage-type hint onto a catalogue id (loose contains match)', () => {
    const d = normalizeFloorplan(
      extraction({ racks: [{ code: 'A', x: 1, y: 1, floor: 0, storageTypeHint: 'pallet rack' }] }),
      { ...opts, storageTypeByToken: { 'pallet rack': 7, shelving: 8 } },
    )
    expect(d.placements[0].new_bin.storage_type_id).toBe(7)
  })

  it('turns zones into non-blocking label objects and counts structure separately', () => {
    const d = normalizeFloorplan(extraction({
      objects: [{ type: 'wall', x: 0, y: 0, w: 20, h: 1, floor: 0 }],
      zones: [{ code: 'Z', name: 'Bulk', x: 0, y: 2, w: 4, h: 4, floor: 0, zoneType: 'bulk' }],
    }), opts)
    expect(d.zoneCount).toBe(1)
    expect(d.objectCount).toBe(1) // the wall, not the label
    const label = d.objects.find((o) => o.object_type === 'label')
    expect(label?.meta).toMatchObject({ name: 'Bulk', zoneType: 'bulk' })
  })
})
