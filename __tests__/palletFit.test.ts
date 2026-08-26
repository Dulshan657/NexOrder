// The pallet-fit engine. Every number it produces ends up as a UOM factor that
// a real receipt is counted in, so the two things under most scrutiny here are
// the refusals (never a zero) and the arithmetic being exactly the rule an
// operator can check against the pallet in front of them.

import { describe, expect, it } from 'vitest'
import {
  AU_STANDARD_PALLET,
  CARTON_WALL_ALLOWANCE,
  MAX_UNITS_PER_CARTON,
  cmToMm,
  computePalletFit,
  describeRefusal,
  estimateCartonBox,
  factorTriples,
  formatBoxCm,
  resolvePalletFit,
  type BoxMm,
} from '@/lib/palletFit'

const box = (l: number, w: number, h: number): BoxMm => ({ lengthMm: l, widthMm: w, heightMm: h })

describe('cmToMm', () => {
  it('rounds to whole millimetres rather than trusting float arithmetic', () => {
    // 12.3 * 10 is 122.99999999999999 in IEEE 754, and the fit is a stack of
    // floor()s — one part in a million short loses a whole carton off a layer.
    expect(cmToMm(12.3)).toBe(123)
    expect(cmToMm(116.5)).toBe(1165)
    expect(cmToMm(40)).toBe(400)
  })
})

describe('factorTriples', () => {
  it('finds every way n divides into three whole factors, once each', () => {
    // 12 = 1x1x12, 1x2x6, 1x3x4, 2x2x3. Sorted, so 3x2x2 is not a fifth.
    expect(factorTriples(12)).toEqual([[1, 1, 12], [1, 2, 6], [1, 3, 4], [2, 2, 3]])
  })

  it('handles a prime — a single row of units is still an arrangement', () => {
    expect(factorTriples(7)).toEqual([[1, 1, 7]])
  })

  it('handles one unit per carton', () => {
    expect(factorTriples(1)).toEqual([[1, 1, 1]])
  })

  it('refuses a figure large enough to be a typo, rather than enumerating it', () => {
    expect(factorTriples(MAX_UNITS_PER_CARTON + 1)).toEqual([])
    expect(factorTriples(0)).toEqual([])
    expect(factorTriples(-4)).toEqual([])
    expect(factorTriples(2.5)).toEqual([])
  })
})

describe('estimateCartonBox', () => {
  it('picks the most cube-like arrangement, and grows it by the wall allowance', () => {
    // 12 cubes of 100mm. The cube-like answer is 2x2x3, not 1x1x12.
    const est = estimateCartonBox(box(100, 100, 100), 12)!
    expect(est.arrangement.slice().sort()).toEqual([2, 2, 3])
    expect(est.bareMm.lengthMm * est.bareMm.widthMm * est.bareMm.heightMm).toBe(12 * 1e6)
    // Each edge grows by 5%, so 200 -> 210 and 300 -> 315.
    const grown = [est.box.lengthMm, est.box.widthMm, est.box.heightMm].sort((a, b) => a - b)
    expect(grown).toEqual([210, 210, 315])
    expect(est.wallAllowance).toBe(CARTON_WALL_ALLOWANCE)
  })

  it('applies the allowance to each EDGE, not to the volume', () => {
    // The fit divides by linear dimensions, so a linear allowance is the one
    // that actually protects the count.
    const est = estimateCartonBox(box(100, 100, 100), 1)!
    expect(est.bareMm).toEqual(box(100, 100, 100))
    expect(est.box).toEqual(box(105, 105, 105))
  })

  it('lays a prime count out in a single row', () => {
    const est = estimateCartonBox(box(60, 40, 200), 7)!
    expect(est.arrangement.slice().sort((a, b) => a - b)).toEqual([1, 1, 7])
  })

  it('accounts for a non-cubic unit rather than assuming a square footprint', () => {
    // A tall thin bottle: 12 of them should lie in a flat 4x3x1 slab, not
    // stack 12 high, because that is the lower surface area.
    const est = estimateCartonBox(box(60, 60, 250), 12)!
    expect(est.arrangement[2]).toBe(1)
    expect(est.bareMm.heightMm).toBe(250)
  })

  it('is deterministic — the same input gives the same box every time', () => {
    const a = estimateCartonBox(box(80, 60, 250), 24)
    const b = estimateCartonBox(box(80, 60, 250), 24)
    expect(a).toEqual(b)
  })

  it('returns null rather than a guess when it has nothing to work from', () => {
    expect(estimateCartonBox(box(0, 100, 100), 12)).toBeNull()
    expect(estimateCartonBox(box(100, 100, 100), 0)).toBeNull()
    expect(estimateCartonBox(box(NaN, 100, 100), 12)).toBeNull()
  })

  it('reports how many arrangements it compared, so the form can show its working', () => {
    expect(estimateCartonBox(box(100, 100, 100), 12)!.candidatesConsidered).toBe(4)
  })
})

describe('computePalletFit', () => {
  const spec = AU_STANDARD_PALLET // 1165 x 1165, 1650mm of load

  it('works a real carton end to end', () => {
    // 400 x 300 x 250 on 1165 x 1165.
    //   as measured: floor(1165/400)=2 x floor(1165/300)=3 -> 6
    //   rotated:     floor(1165/300)=3 x floor(1165/400)=2 -> 6
    //   layers: floor(1650/250) = 6      -> 36 cartons
    const r = computePalletFit({ spec, carton: box(400, 300, 250), unitsPerCarton: 12, basis: 'measured' })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.fit.perLayer).toBe(6)
    expect(r.fit.layers).toBe(6)
    expect(r.fit.cartonsPerPallet).toBe(36)
    expect(r.fit.unitsPerPallet).toBe(432)
    expect(r.fit.loadHeightMm).toBe(1500)
    expect(r.fit.headroomMm).toBe(150)
    expect(r.fit.basis).toBe('measured')
  })

  it('turns the carton 90° when that fits more per layer', () => {
    // 600 x 200: as measured floor(1165/600)=1 x floor(1165/200)=5 -> 5
    //            rotated     floor(1165/200)=5 x floor(1165/600)=1 -> 5  (tie)
    // Use an oblong pallet to break the symmetry instead.
    const oblong = { ...spec, footprintLengthMm: 1200, footprintWidthMm: 800 }
    // 700 x 300: as measured floor(1200/700)=1 x floor(800/300)=2 -> 2
    //            rotated     floor(1200/300)=4 x floor(800/700)=1 -> 4
    const r = computePalletFit({ spec: oblong, carton: box(700, 300, 200), unitsPerCarton: 1, basis: 'measured' })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.fit.perLayer).toBe(4)
    expect(r.fit.orientation).toBe('rotated')
    expect(r.fit.alongLength).toBe(4)
    expect(r.fit.alongWidth).toBe(1)
  })

  it('keeps the measured orientation when it is the better one', () => {
    const oblong = { ...spec, footprintLengthMm: 1200, footprintWidthMm: 800 }
    const r = computePalletFit({ spec: oblong, carton: box(300, 700, 200), unitsPerCarton: 1, basis: 'measured' })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.fit.perLayer).toBe(4)
    expect(r.fit.orientation).toBe('as_measured')
  })

  it('REFUSES BY NAME when the carton overhangs, rather than returning zero', () => {
    // No overhang allowance, by decision. A 1200mm carton does not fit a
    // 1165mm deck in either orientation.
    const r = computePalletFit({ spec, carton: box(1200, 1200, 200), unitsPerCarton: 12, basis: 'measured' })
    expect(r).toEqual({ ok: false, reason: 'carton_footprint_exceeds_pallet' })
  })

  it('REFUSES BY NAME when one carton is taller than the load may stack', () => {
    const r = computePalletFit({ spec, carton: box(400, 300, 1700), unitsPerCarton: 12, basis: 'measured' })
    expect(r).toEqual({ ok: false, reason: 'carton_taller_than_max_load' })
  })

  it('does not subtract the pallet deck from the load height', () => {
    // maxLoadHeightMm is already load-only; subtracting baseHeightMm would
    // count the deck twice and quietly lose a layer.
    const r = computePalletFit({ spec, carton: box(400, 300, 550), unitsPerCarton: 1, basis: 'measured' })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.fit.layers).toBe(3) // floor(1650/550), not floor(1500/550)
  })

  it('refuses a nonsense units-per-carton', () => {
    expect(computePalletFit({ spec, carton: box(400, 300, 250), unitsPerCarton: 0, basis: 'measured' }))
      .toEqual({ ok: false, reason: 'no_units_per_carton' })
    expect(computePalletFit({ spec, carton: box(400, 300, 250), unitsPerCarton: 2.5, basis: 'measured' }))
      .toEqual({ ok: false, reason: 'no_units_per_carton' })
    expect(computePalletFit({ spec, carton: box(400, 300, 250), unitsPerCarton: MAX_UNITS_PER_CARTON + 1, basis: 'measured' }))
      .toEqual({ ok: false, reason: 'units_per_carton_too_large' })
  })

  it('refuses a carton with no real dimensions', () => {
    expect(computePalletFit({ spec, carton: box(0, 300, 250), unitsPerCarton: 12, basis: 'measured' }))
      .toEqual({ ok: false, reason: 'no_carton_box' })
  })

  it('never returns a zero pallet quantity on any accepted fit', () => {
    // The property that matters: an accepted fit is always usable as a factor.
    for (const c of [box(400, 300, 250), box(1165, 1165, 1650), box(100, 100, 100)]) {
      const r = computePalletFit({ spec, carton: c, unitsPerCarton: 6, basis: 'measured' })
      if (r.ok) {
        expect(r.fit.unitsPerPallet).toBeGreaterThan(0)
        expect(r.fit.cartonsPerPallet).toBeGreaterThan(0)
      }
    }
  })
})

describe('resolvePalletFit', () => {
  const spec = AU_STANDARD_PALLET
  const noneCm = { lengthCm: null, widthCm: null, heightCm: null }

  it('prefers the measured carton, and says the basis is measured', () => {
    const r = resolvePalletFit({
      spec,
      cartonCm: { lengthCm: 40, widthCm: 30, heightCm: 25 },
      unitCm: { lengthCm: 8, widthCm: 6, heightCm: 25 },
      unitsPerCarton: 12,
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.fit.basis).toBe('measured')
    expect(r.estimate).toBeNull()
    expect(r.fit.cartonsPerPallet).toBe(36)
  })

  it('estimates from the unit when the carton is not measured, and SAYS SO', () => {
    const r = resolvePalletFit({
      spec,
      cartonCm: noneCm,
      unitCm: { lengthCm: 8, widthCm: 6, heightCm: 25 },
      unitsPerCarton: 12,
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.fit.basis).toBe('estimated')
    expect(r.estimate).not.toBeNull()
    expect(r.estimate!.unitsPerCarton).toBe(12)
  })

  it('treats a partly-filled carton box as not measured', () => {
    // Two of three dimensions is not a box, and half a box must never be
    // silently completed from the other half.
    const r = resolvePalletFit({
      spec,
      cartonCm: { lengthCm: 40, widthCm: 30, heightCm: null },
      unitCm: { lengthCm: 8, widthCm: 6, heightCm: 25 },
      unitsPerCarton: 12,
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.fit.basis).toBe('estimated')
  })

  it('refuses with no pallet spec, so nothing computes off a number nobody set', () => {
    expect(resolvePalletFit({ spec: null, cartonCm: noneCm, unitCm: noneCm, unitsPerCarton: 12 }))
      .toEqual({ ok: false, reason: 'no_pallet_spec' })
  })

  it('refuses with no carton unit on the ladder', () => {
    expect(resolvePalletFit({ spec, cartonCm: noneCm, unitCm: noneCm, unitsPerCarton: null }))
      .toEqual({ ok: false, reason: 'no_units_per_carton' })
  })

  it('refuses when neither the carton nor the unit is measured', () => {
    expect(resolvePalletFit({ spec, cartonCm: noneCm, unitCm: noneCm, unitsPerCarton: 12 }))
      .toEqual({ ok: false, reason: 'no_carton_box' })
  })
})

describe('describeRefusal', () => {
  it('gives every reason a sentence in the operator’s terms', () => {
    const reasons = [
      'no_pallet_spec', 'no_carton_box', 'no_units_per_carton',
      'units_per_carton_too_large', 'carton_footprint_exceeds_pallet',
      'carton_taller_than_max_load',
    ] as const
    for (const r of reasons) {
      const text = describeRefusal(r, AU_STANDARD_PALLET)
      expect(text.length).toBeGreaterThan(20)
      expect(text).not.toMatch(/undefined|NaN|\[object/)
    }
  })

  it('quotes the actual pallet when it has one', () => {
    expect(describeRefusal('carton_footprint_exceeds_pallet', AU_STANDARD_PALLET)).toMatch(/1165 × 1165/)
    expect(describeRefusal('carton_taller_than_max_load', AU_STANDARD_PALLET)).toMatch(/1650/)
  })

  it('still reads without one', () => {
    expect(describeRefusal('carton_footprint_exceeds_pallet', null)).toMatch(/wider than the pallet/)
  })
})

describe('formatBoxCm', () => {
  it('reads back in the unit the operator typed', () => {
    expect(formatBoxCm(box(400, 300, 250))).toBe('40 × 30 × 25 cm')
    expect(formatBoxCm(box(252, 126, 252))).toBe('25.2 × 12.6 × 25.2 cm')
  })
})
