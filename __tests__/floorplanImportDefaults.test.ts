import { describe, expect, it } from 'vitest'
import { applyDefaultStorageForm, applyPalletAreaChoices, pruneStaleWalkways, type PalletAreaDecision, type PalletAreaInput } from '@/lib/floorplanImportDefaults'

interface FakePlacement {
  client_ref: string
  new_bin?: { storage_type_id?: number | null; code: string } | null
}

describe('applyDefaultStorageForm', () => {
  it('backfills storage_type_id on unmatched bins', () => {
    const placements: FakePlacement[] = [
      { client_ref: 'fp1', new_bin: { code: 'A-1', storage_type_id: undefined } },
      { client_ref: 'fp2', new_bin: { code: 'A-2', storage_type_id: null } },
    ]

    const result = applyDefaultStorageForm(placements, 7)

    expect(result[0].new_bin?.storage_type_id).toBe(7)
    expect(result[1].new_bin?.storage_type_id).toBe(7)
  })

  it('leaves matched bins untouched (same reference)', () => {
    const matched: FakePlacement = { client_ref: 'fp1', new_bin: { code: 'A-1', storage_type_id: 3 } }
    const placements: FakePlacement[] = [matched]

    const result = applyDefaultStorageForm(placements, 7)

    expect(result[0]).toBe(matched)
    expect(result[0].new_bin?.storage_type_id).toBe(3)
  })

  it('returns placements without new_bin unchanged (same reference)', () => {
    const noBin: FakePlacement = { client_ref: 'fp1' }
    const placements: FakePlacement[] = [noBin]

    const result = applyDefaultStorageForm(placements, 7)

    expect(result[0]).toBe(noBin)
  })

  it('formId = null leaves unmatched bins with storage_type_id undefined (uncapped)', () => {
    const placements: FakePlacement[] = [
      { client_ref: 'fp1', new_bin: { code: 'A-1', storage_type_id: undefined } },
    ]

    const result = applyDefaultStorageForm(placements, null)

    expect(result[0].new_bin?.storage_type_id).toBeUndefined()
  })

  it('does not mutate the input array or its objects', () => {
    const original: FakePlacement = { client_ref: 'fp1', new_bin: { code: 'A-1', storage_type_id: undefined } }
    const placements: FakePlacement[] = [original]
    const placementsCopy = [...placements]

    applyDefaultStorageForm(placements, 7)

    expect(placements).toEqual(placementsCopy)
    expect(original.new_bin?.storage_type_id).toBeUndefined()
  })

  it('returns a new array instance', () => {
    const placements: FakePlacement[] = [{ client_ref: 'fp1', new_bin: { code: 'A-1', storage_type_id: undefined } }]

    const result = applyDefaultStorageForm(placements, 7)

    expect(result).not.toBe(placements)
  })
})

describe('applyPalletAreaChoices', () => {
  const LAYOUT_ID = 42

  function area(code: string, placements: FakePlacement[]): PalletAreaInput<FakePlacement> {
    return { code, floor: 0, x: 1, y: 2, w: 3, h: 4, placements }
  }

  it('backfills the chosen storage_type_id per storable area and suffixes bin codes', () => {
    const areaA = area('PA-A', [
      { client_ref: 'a1', new_bin: { code: 'PA-A-0-0', storage_type_id: undefined } },
      { client_ref: 'a2', new_bin: { code: 'PA-A-1-0', storage_type_id: undefined } },
    ])
    const areaB = area('PA-B', [
      { client_ref: 'b1', new_bin: { code: 'PA-B-0-0', storage_type_id: undefined } },
    ])
    const decisions: Record<string, PalletAreaDecision> = {
      'PA-A': { storable: true, storageTypeId: 11 },
      'PA-B': { storable: true, storageTypeId: 22 },
    }

    const result = applyPalletAreaChoices([areaA, areaB], decisions, LAYOUT_ID)

    expect(result.placements).toEqual([
      { client_ref: 'a1', new_bin: { code: `PA-A-0-0-L${LAYOUT_ID}`, storage_type_id: 11 } },
      { client_ref: 'a2', new_bin: { code: `PA-A-1-0-L${LAYOUT_ID}`, storage_type_id: 11 } },
      { client_ref: 'b1', new_bin: { code: `PA-B-0-0-L${LAYOUT_ID}`, storage_type_id: 22 } },
    ])
    expect(result.visualObjects).toEqual([])
  })

  it('leaves an already-set storage_type_id alone (does not override with the area choice)', () => {
    const areaA = area('PA-A', [
      { client_ref: 'a1', new_bin: { code: 'PA-A-0-0', storage_type_id: 99 } },
    ])
    const decisions: Record<string, PalletAreaDecision> = { 'PA-A': { storable: true, storageTypeId: 11 } }

    const result = applyPalletAreaChoices([areaA], decisions, LAYOUT_ID)

    expect(result.placements[0].new_bin?.storage_type_id).toBe(99)
  })

  it('storageTypeId: null backfills as undefined (uncapped), matching applyDefaultStorageForm', () => {
    const areaA = area('PA-A', [
      { client_ref: 'a1', new_bin: { code: 'PA-A-0-0', storage_type_id: undefined } },
    ])
    const decisions: Record<string, PalletAreaDecision> = { 'PA-A': { storable: true, storageTypeId: null } }

    const result = applyPalletAreaChoices([areaA], decisions, LAYOUT_ID)

    expect(result.placements[0].new_bin?.storage_type_id).toBeUndefined()
  })

  it('excludes a visual-only area from placements and emits one obstacle object covering its footprint', () => {
    const areaA = area('PA-A', [
      { client_ref: 'a1', new_bin: { code: 'PA-A-0-0', storage_type_id: undefined } },
      { client_ref: 'a2', new_bin: { code: 'PA-A-1-0', storage_type_id: undefined } },
    ])
    const decisions: Record<string, PalletAreaDecision> = { 'PA-A': { storable: false } }

    const result = applyPalletAreaChoices([areaA], decisions, LAYOUT_ID)

    expect(result.placements).toEqual([])
    expect(result.visualObjects).toEqual([
      { object_type: 'obstacle', floor: 0, x: 1, y: 2, w: 3, h: 4, meta: { name: 'Pallet storage' } },
    ])
  })

  it('handles a mix of storable and visual areas together', () => {
    const storable = area('PA-S', [{ client_ref: 's1', new_bin: { code: 'PA-S-0-0', storage_type_id: undefined } }])
    const visual = area('PA-V', [{ client_ref: 'v1', new_bin: { code: 'PA-V-0-0', storage_type_id: undefined } }])
    const decisions: Record<string, PalletAreaDecision> = {
      'PA-S': { storable: true, storageTypeId: 5 },
      'PA-V': { storable: false },
    }

    const result = applyPalletAreaChoices([storable, visual], decisions, LAYOUT_ID)

    expect(result.placements).toHaveLength(1)
    expect(result.placements[0].client_ref).toBe('s1')
    expect(result.visualObjects).toHaveLength(1)
  })

  it('defaults to storable/uncapped when an area has no recorded decision', () => {
    const areaA = area('PA-A', [
      { client_ref: 'a1', new_bin: { code: 'PA-A-0-0', storage_type_id: undefined } },
    ])

    const result = applyPalletAreaChoices([areaA], {}, LAYOUT_ID)

    expect(result.placements).toHaveLength(1)
    expect(result.placements[0].new_bin?.storage_type_id).toBeUndefined()
    expect(result.visualObjects).toEqual([])
  })

  it('passes through placements with no new_bin unchanged (same reference)', () => {
    const noBin: FakePlacement = { client_ref: 'existing' }
    const areaA = area('PA-A', [noBin])
    const decisions: Record<string, PalletAreaDecision> = { 'PA-A': { storable: true, storageTypeId: 3 } }

    const result = applyPalletAreaChoices([areaA], decisions, LAYOUT_ID)

    expect(result.placements[0]).toBe(noBin)
  })

  it('returns empty placements/visualObjects for an empty areas array', () => {
    const result = applyPalletAreaChoices([], {}, LAYOUT_ID)

    expect(result.placements).toEqual([])
    expect(result.visualObjects).toEqual([])
  })

  it('does not mutate the input areas, their placements, or new_bin objects', () => {
    const originalNewBin = { code: 'PA-A-0-0', storage_type_id: undefined }
    const originalPlacement: FakePlacement = { client_ref: 'a1', new_bin: originalNewBin }
    const areaA = area('PA-A', [originalPlacement])
    const decisions: Record<string, PalletAreaDecision> = { 'PA-A': { storable: true, storageTypeId: 7 } }

    applyPalletAreaChoices([areaA], decisions, LAYOUT_ID)

    expect(originalPlacement.new_bin).toBe(originalNewBin)
    expect(originalNewBin.storage_type_id).toBeUndefined()
    expect(originalNewBin.code).toBe('PA-A-0-0')
  })
})

interface FakeObject {
  object_type: string
  floor: number
  x: number
  y: number
  w: number
  h: number
}

interface FakePlacementCell {
  floor: number
  x: number
  y: number
  w: number
  h: number
}

describe('pruneStaleWalkways', () => {
  it('prunes a 1×1 walkway whose cell is covered by a placement', () => {
    const walkway: FakeObject = { object_type: 'walkway', floor: 0, x: 5, y: 5, w: 1, h: 1 }
    const placements: FakePlacementCell[] = [{ floor: 0, x: 5, y: 5, w: 1, h: 1 }]

    const result = pruneStaleWalkways([walkway], placements)

    expect(result).toEqual([])
  })

  it('keeps a multi-cell walkway even if one of its cells is overlapped', () => {
    const aisle: FakeObject = { object_type: 'walkway', floor: 0, x: 5, y: 5, w: 3, h: 1 }
    const placements: FakePlacementCell[] = [{ floor: 0, x: 5, y: 5, w: 1, h: 1 }]

    const result = pruneStaleWalkways([aisle], placements)

    expect(result).toEqual([aisle])
  })

  it('keeps a 1×1 walkway whose cell is not covered by any placement', () => {
    const walkway: FakeObject = { object_type: 'walkway', floor: 0, x: 5, y: 5, w: 1, h: 1 }
    const placements: FakePlacementCell[] = [{ floor: 0, x: 9, y: 9, w: 1, h: 1 }]

    const result = pruneStaleWalkways([walkway], placements)

    expect(result).toEqual([walkway])
  })

  it('leaves non-walkway objects untouched even if covered by a placement', () => {
    const dock: FakeObject = { object_type: 'dock', floor: 0, x: 5, y: 5, w: 1, h: 1 }
    const placements: FakePlacementCell[] = [{ floor: 0, x: 5, y: 5, w: 1, h: 1 }]

    const result = pruneStaleWalkways([dock], placements)

    expect(result).toEqual([dock])
  })

  it('only prunes the covered walkway out of a mixed object list', () => {
    const staleWalkway: FakeObject = { object_type: 'walkway', floor: 0, x: 5, y: 5, w: 1, h: 1 }
    const freshWalkway: FakeObject = { object_type: 'walkway', floor: 0, x: 1, y: 1, w: 1, h: 1 }
    const wall: FakeObject = { object_type: 'wall', floor: 0, x: 0, y: 0, w: 1, h: 1 }
    const placements: FakePlacementCell[] = [{ floor: 0, x: 5, y: 5, w: 1, h: 1 }]

    const result = pruneStaleWalkways([staleWalkway, freshWalkway, wall], placements)

    expect(result).toEqual([freshWalkway, wall])
  })
})
