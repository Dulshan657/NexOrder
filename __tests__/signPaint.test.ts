// Floor signs — the pure fold, packing and fingerprint (mig 00097).
//
// The load-bearing property is the LOSSLESS ROUND TRIP of MAIN's seeded signs.
// They were written by warehouse-main/layout.mjs as single wide rows (`w: 10`),
// and the first save on that site rewrites them as 1x1 cells. If the fold did not
// expand `w`/`h`, the client's fingerprint would disagree with the server's and
// every sign save on MAIN would 409 forever on a picture nobody changed.

import { describe, it, expect } from 'vitest'
import {
  MAX_SIGN_NAME,
  diffSigns,
  expandSignRuns,
  packSignRuns,
  sanitizeSignName,
  signCellsFingerprint,
  signNameIssue,
  signObjectsFromSpecs,
  signSpecsFromObjects,
} from '@/lib/signPaint'
import { areaCellsFingerprint, areaSpecsFromObjects } from '@/lib/areaPaint'

const cell = (name: string, x: number, y = 0, floor = 0) => ({
  objectType: 'label', floor, x, y, w: 1, h: 1, meta: { name },
})

/** A seeded sign as warehouse-main writes it: ONE row, `w` wide. */
const wide = (name: string, x: number, y: number, w: number) => ({
  objectType: 'label', floor: 0, x, y, w, h: 1, meta: { name },
})

describe('signSpecsFromObjects', () => {
  it('folds 1x1 cells sharing a text into one spec', () => {
    const specs = signSpecsFromObjects([cell('Inbound', 0), cell('Inbound', 1), cell('Inbound', 2)])
    expect(specs).toHaveLength(1)
    expect(specs[0].name).toBe('Inbound')
    expect(specs[0].cells).toHaveLength(3)
  })

  it('reads ONLY label rows — areas on the same layout are invisible to it', () => {
    const specs = signSpecsFromObjects([
      cell('Inbound', 0),
      { objectType: 'area', floor: 0, x: 0, y: 0, w: 1, h: 1, meta: { name: 'Chiller', zoneProfileId: 4 } },
    ])
    expect(specs.map((s) => s.name)).toEqual(['Inbound'])
  })

  it('carries no zone profile, even when a row somehow has one', () => {
    // A sign must never acquire area semantics by the back door.
    const specs = signSpecsFromObjects([
      { objectType: 'label', floor: 0, x: 0, y: 0, w: 1, h: 1, meta: { name: 'Inbound', zoneProfileId: 4 } },
    ])
    expect(specs[0]).toEqual({ name: 'Inbound', cells: [{ floor: 0, x: 0, y: 0 }] })
    expect(signObjectsFromSpecs(specs)[0].meta).toEqual({ name: 'Inbound' })
  })

  it('expands a wide seeded row into its cells', () => {
    const specs = signSpecsFromObjects([wide('Inbound staging', 3, 3, 10)])
    expect(specs[0].cells).toHaveLength(10)
    expect(specs[0].cells[0]).toEqual({ floor: 0, x: 3, y: 3 })
    expect(specs[0].cells[9]).toEqual({ floor: 0, x: 12, y: 3 })
  })
})

describe('fingerprint', () => {
  it('is identical for a wide seeded row and the 1x1 cells that replace it', () => {
    // THE MAIN ROUND TRIP. Without this, every sign save on MAIN would 409.
    const seeded = [
      wide('Inbound staging', 3, 3, 10),
      wide('Outbound staging', 46, 3, 10),
      wide('Cold room', 2, 27, 6),
    ]
    const rewritten = signObjectsFromSpecs(signSpecsFromObjects(seeded))
    expect(rewritten.every((o) => o.w === 1 && o.h === 1)).toBe(true)
    expect(rewritten).toHaveLength(26)
    expect(signCellsFingerprint(rewritten)).toBe(signCellsFingerprint(seeded))
  })

  it('ignores row order and duplicate rows describing the same cell', () => {
    const a = [cell('Inbound', 0), cell('Inbound', 1)]
    const b = [cell('Inbound', 1), cell('Inbound', 0), cell('Inbound', 1)]
    expect(signCellsFingerprint(b)).toBe(signCellsFingerprint(a))
  })

  it('changes when the same cells are relabelled', () => {
    // A bare cell COUNT would miss this, which is the whole reason it is a hash.
    expect(signCellsFingerprint([cell('Inbound', 0)])).not.toBe(signCellsFingerprint([cell('Outbound', 0)]))
  })

  it('is computed over labels only, so an area edit cannot invalidate it', () => {
    const signs = [cell('Inbound', 0)]
    const withArea = [
      ...signs,
      { objectType: 'area', floor: 0, x: 5, y: 5, w: 1, h: 1, meta: { name: 'Chiller', zoneProfileId: 1 } },
    ]
    expect(signCellsFingerprint(withArea)).toBe(signCellsFingerprint(signs))
    // …and the converse: the area fingerprint does not move when signs do.
    expect(areaCellsFingerprint(withArea)).toBe(
      areaCellsFingerprint([{ objectType: 'area', floor: 0, x: 5, y: 5, w: 1, h: 1, meta: { name: 'Chiller', zoneProfileId: 1 } }]),
    )
  })
})

describe('run packing', () => {
  it('round-trips cells through runs', () => {
    const cells = [
      { floor: 0, x: 3, y: 3 }, { floor: 0, x: 4, y: 3 }, { floor: 0, x: 5, y: 3 },
      { floor: 0, x: 9, y: 7 },
    ]
    expect(expandSignRuns(packSignRuns(cells))).toEqual(cells)
  })

  it('compresses a contiguous run to one entry', () => {
    const cells = Array.from({ length: 10 }, (_, i) => ({ floor: 0, x: i, y: 0 }))
    expect(packSignRuns(cells)).toEqual([{ floor: 0, y: 0, x: 0, len: 10 }])
  })
})

describe('diffSigns', () => {
  it('reports created, erased and resized', () => {
    const before = [cell('Inbound', 0), cell('Inbound', 1), cell('Gone', 20)]
    const after = [cell('Inbound', 0), cell('Inbound', 1), cell('Inbound', 2), cell('New', 30)]
    const d = diffSigns(before, after)
    expect(d.created).toEqual(['New'])
    expect(d.erased).toEqual(['Gone'])
    expect(d.resized).toEqual([{ name: 'Inbound', before: 2, after: 3, added: 1, removed: 0 }])
    expect(d.unchanged).toBe(false)
  })

  it('reports unchanged for an identical picture spelled differently', () => {
    const d = diffSigns([wide('Inbound', 0, 0, 3)], [cell('Inbound', 0), cell('Inbound', 1), cell('Inbound', 2)])
    expect(d.unchanged).toBe(true)
  })
})

describe('name rules', () => {
  it('collapses whitespace and caps length', () => {
    expect(sanitizeSignName('  Inbound   Staging  ')).toBe('Inbound Staging')
    expect(sanitizeSignName('x'.repeat(200))).toHaveLength(MAX_SIGN_NAME)
  })

  it('refuses a blank text', () => {
    expect(signNameIssue('   ')).toBeTruthy()
  })

  it('ALLOWS "·", unlike an area name', () => {
    // The area ban exists only because composeName joins a bin name around ` · `.
    // Nothing composes a sign, so importing that rule would be cargo-culting it.
    expect(signNameIssue('Cold · Dry')).toBeNull()
  })
})

describe('areaPaint generalization is a no-op for areas', () => {
  it('still defaults to object_type area', () => {
    const objects = [
      { objectType: 'area', floor: 0, x: 0, y: 0, w: 1, h: 1, meta: { name: 'Chiller', zoneProfileId: 2 } },
      cell('Inbound', 9),
    ]
    const specs = areaSpecsFromObjects(objects)
    expect(specs).toHaveLength(1)
    expect(specs[0]).toMatchObject({ name: 'Chiller', zoneProfileId: 2 })
  })
})
