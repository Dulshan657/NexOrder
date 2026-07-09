import { describe, expect, it } from 'vitest'
import { applyDefaultStorageForm } from '@/lib/floorplanImportDefaults'

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
