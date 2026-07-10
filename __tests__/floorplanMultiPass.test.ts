import { describe, it, expect } from 'vitest'

import { mergeExtractions, HIGH_FIDELITY_RECONCILE } from '../supabase/functions/_shared/floorplan/multiPass'
import type { FloorplanExtraction } from '../supabase/functions/_shared/floorplan/extractionSchema'

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

describe('mergeExtractions', () => {
  it('takes grid/objects/zones from the structure pass only', () => {
    const structure = extraction({
      gridWidth: 40,
      gridHeight: 30,
      floors: 2,
      objects: [{ type: 'wall', name: '', x: 0, y: 0, w: 10, h: 1, floor: 0 }],
      zones: [{ code: 'Z1', name: 'Bulk', x: 0, y: 2, w: 4, h: 4, floor: 0, zoneType: 'bulk' }],
    })
    const detail = extraction({
      gridWidth: 999, // must be ignored — structure's dims win
      gridHeight: 999,
      floors: 99,
      objects: [{ type: 'obstacle', name: 'should be ignored', x: 0, y: 0, w: 1, h: 1, floor: 0 }],
      zones: [{ code: 'ZX', name: 'ignored', x: 0, y: 0, w: 1, h: 1, floor: 0, zoneType: '' }],
    })

    const merged = mergeExtractions(structure, detail)

    expect(merged.gridWidth).toBe(40)
    expect(merged.gridHeight).toBe(30)
    expect(merged.floors).toBe(2)
    expect(merged.objects).toEqual(structure.objects)
    expect(merged.zones).toEqual(structure.zones)
  })

  it('takes rackRows/palletAreas from the detail pass only', () => {
    const structure = extraction({
      rackRows: [{ code: 'ignored', x: 0, y: 0, w: 1, h: 1, floor: 0, bayCount: 1, storageTypeHint: '' }],
      palletAreas: [{ code: 'ignored', x: 0, y: 0, w: 1, h: 1, floor: 0 }],
    })
    const detail = extraction({
      rackRows: [{ code: 'R1', x: 1, y: 1, w: 5, h: 1, floor: 0, bayCount: 5, storageTypeHint: 'pallet rack' }],
      palletAreas: [{ code: 'PA1', x: 2, y: 2, w: 3, h: 3, floor: 0 }],
    })

    const merged = mergeExtractions(structure, detail)

    expect(merged.rackRows).toEqual(detail.rackRows)
    expect(merged.palletAreas).toEqual(detail.palletAreas)
  })

  it('confidence is the minimum of the two passes', () => {
    expect(mergeExtractions(extraction({ confidence: 0.9 }), extraction({ confidence: 0.4 })).confidence).toBe(0.4)
    expect(mergeExtractions(extraction({ confidence: 0.3 }), extraction({ confidence: 0.95 })).confidence).toBe(0.3)
  })

  it('joins notes from both passes with " | ", skipping empty ones', () => {
    expect(mergeExtractions(extraction({ notes: 'blurry top-left' }), extraction({ notes: 'rack count uncertain' })).notes).toBe(
      'blurry top-left | rack count uncertain',
    )
    expect(mergeExtractions(extraction({ notes: '' }), extraction({ notes: 'only detail note' })).notes).toBe('only detail note')
    expect(mergeExtractions(extraction({ notes: '' }), extraction({ notes: '' })).notes).toBe('')
    expect(mergeExtractions(extraction({ notes: '  ' }), extraction({ notes: 'x' })).notes).toBe('x')
  })

  it('ships pass-3 reconciliation disabled', () => {
    expect(HIGH_FIDELITY_RECONCILE).toBe(false)
  })
})
