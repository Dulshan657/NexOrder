// Turning a pallet fit into a ladder row, and answering where a stored figure
// came from. The provenance rule is the part worth the most scrutiny: it is
// recomputed rather than stored, and the whole argument for that is that it
// stays true when things change underneath it.

import { describe, expect, it } from 'vitest'
import {
  PALLET_UOM_CODE,
  PALLET_UOM_FALLBACK_CODE,
  cartonUomOf,
  cartonUomOfProduct,
  findPalletDraftIndex,
  palletProvenance,
  palletSpecFromSettings,
  provenanceHint,
  provenanceLabel,
  uomProvenance,
  withPalletUom,
} from '@/lib/palletUom'
import { AU_STANDARD_PALLET, computePalletFit, resolvePalletFit } from '@/lib/palletFit'
import type { ExtraUomDraft } from '@/components/admin/ProductUomsSection'
import type { Product } from '@/types'

const draft = (code: string, factorToBase: string, extra: Partial<ExtraUomDraft> = {}): ExtraUomDraft => ({
  code, factorToBase, price: '10', cubicMeters: '', isOrderable: true, isReceivable: true, ...extra,
})

describe('palletSpecFromSettings', () => {
  it('reads the RAW snake_case row, which is what useSettings returns', () => {
    expect(palletSpecFromSettings({
      pallet_footprint_length_mm: 1200,
      pallet_footprint_width_mm: 800,
      pallet_base_height_mm: 144,
      pallet_max_load_height_mm: 1800,
    })).toEqual({
      footprintLengthMm: 1200, footprintWidthMm: 800, baseHeightMm: 144, maxLoadHeightMm: 1800,
    })
  })

  it('also accepts an adapted camelCase AppSettings', () => {
    expect(palletSpecFromSettings({ palletFootprintLengthMm: 1000 } as never)!.footprintLengthMm).toBe(1000)
  })

  it('falls back per field for a row read before mig 00125 landed', () => {
    expect(palletSpecFromSettings({} as never)).toEqual(AU_STANDARD_PALLET)
  })

  it('is null only when settings have not loaded, so nothing computes off a guess', () => {
    expect(palletSpecFromSettings(null)).toBeNull()
    expect(palletSpecFromSettings(undefined)).toBeNull()
  })
})

describe('cartonUomOf', () => {
  it('picks the LARGEST non-base row — the outer box is what gets stacked', () => {
    const extras = [draft('inner', '6'), draft('carton', '24')]
    expect(cartonUomOf(extras)!.code).toBe('carton')
  })

  it('never picks the pallet row as the carton', () => {
    const extras = [draft('carton', '12'), draft('pallet', '648')]
    expect(cartonUomOf(extras)!.code).toBe('carton')
  })

  it('ignores the fallback pallet code too', () => {
    const extras = [draft('carton', '12'), draft('pallet load', '648')]
    expect(cartonUomOf(extras)!.code).toBe('carton')
  })

  it('ignores a half-typed row rather than reading NaN as a factor', () => {
    expect(cartonUomOf([draft('carton', ''), draft('case', '10')])!.code).toBe('case')
    expect(cartonUomOf([draft('', '')])).toBeUndefined()
  })

  it('returns nothing on a base-only ladder — there is no pack to stack', () => {
    expect(cartonUomOf([])).toBeUndefined()
  })
})

describe('cartonUomOfProduct', () => {
  const product = (uoms: Array<Partial<Product['uoms'][number]>>): Product =>
    ({ id: 1, uoms: uoms.map((u, i) => ({
      id: i + 1, code: 'x', factorToBase: 1, price: 1, isBase: false,
      isOrderable: true, isReceivable: true, sortOrder: i, ...u,
    })) } as Product)

  it('makes the same choice against a saved product', () => {
    const p = product([
      { code: 'each', factorToBase: 1, isBase: true },
      { code: 'inner', factorToBase: 6 },
      { code: 'carton', factorToBase: 24 },
      { code: 'pallet', factorToBase: 1152 },
    ])
    expect(cartonUomOfProduct(p)!.code).toBe('carton')
  })

  it('returns nothing for a product with no ladder', () => {
    expect(cartonUomOfProduct(null)).toBeUndefined()
    expect(cartonUomOfProduct({ id: 1 } as Product)).toBeUndefined()
  })
})

describe('withPalletUom', () => {
  it('adds a RECEIVABLE, NOT ORDERABLE pallet row', () => {
    // Not orderable matters twice: selling by the pallet was not asked for, and
    // set_product_uoms recomputes products.carton_size from the ORDERABLE rows.
    const next = withPalletUom([draft('carton', '12')], {
      factorToBase: 648, baseUnitCode: 'each', basePrice: 2.5,
    })
    const pallet = next.find((u) => u.code === PALLET_UOM_CODE)!
    expect(pallet.factorToBase).toBe('648')
    expect(pallet.isReceivable).toBe(true)
    expect(pallet.isOrderable).toBe(false)
  })

  it('prices it at base × factor, so an accidental Order tick is not free', () => {
    const next = withPalletUom([], { factorToBase: 100, baseUnitCode: 'each', basePrice: 2.5 })
    expect(next[0].price).toBe('250.00')
  })

  it('updates the existing row in place rather than adding a second', () => {
    const before = [draft('carton', '12'), draft('pallet', '480', { isOrderable: true, price: '99' })]
    const after = withPalletUom(before, { factorToBase: 648, baseUnitCode: 'each', basePrice: 2.5 })
    expect(after).toHaveLength(2)
    const pallet = after.find((u) => u.code === 'pallet')!
    expect(pallet.factorToBase).toBe('648')
    // Only the QUANTITY is recomputed — an admin's own price and Order tick survive.
    expect(pallet.price).toBe('99')
    expect(pallet.isOrderable).toBe(true)
  })

  it('does not mutate the array it was given', () => {
    const before = [draft('carton', '12')]
    const copy = JSON.parse(JSON.stringify(before))
    withPalletUom(before, { factorToBase: 648, baseUnitCode: 'each', basePrice: 1 })
    expect(before).toEqual(copy)
  })

  it('renames itself when the BASE unit is literally called "pallet"', () => {
    // assembleProductUoms rejects a duplicate code, including against the base.
    const next = withPalletUom([], { factorToBase: 10, baseUnitCode: 'Pallet', basePrice: 1 })
    expect(next[0].code).toBe(PALLET_UOM_FALLBACK_CODE)
  })

  it('finds a pallet row under either spelling', () => {
    expect(findPalletDraftIndex([draft('carton', '12'), draft('Pallet', '4')])).toBe(1)
    expect(findPalletDraftIndex([draft('pallet load', '4')])).toBe(0)
    expect(findPalletDraftIndex([draft('carton', '12')])).toBe(-1)
  })
})

describe('palletProvenance', () => {
  const fit = (unitsPerPallet: number, basis: 'measured' | 'estimated') => {
    const r = computePalletFit({
      spec: AU_STANDARD_PALLET, carton: { lengthMm: 400, widthMm: 300, heightMm: 250 },
      unitsPerCarton: 12, basis,
    })
    // 36 cartons x 12 = 432; override for the cases that need a different figure.
    return { ...r.fit!, unitsPerPallet }
  }

  it('says measured when the stored figure IS what the measured carton works out to', () => {
    expect(palletProvenance(432, fit(432, 'measured'))).toBe('measured')
  })

  it('says estimated when the fit it matches came from an estimated carton', () => {
    expect(palletProvenance(432, fit(432, 'estimated'))).toBe('estimated')
  })

  it('says manual when the stored figure does not match the computation', () => {
    // The case a "are the carton dims null" rule gets wrong: an admin edited the
    // suggestion before confirming it, so it is neither measured nor estimated.
    expect(palletProvenance(500, fit(432, 'measured'))).toBe('manual')
  })

  it('reclassifies to manual when the PALLET SPEC changes underneath a saved figure', () => {
    // The stated cost of recomputing, and the point of it: this is the only
    // signal anyone gets that a spec change invalidated a catalogue's figures.
    const onAuStandard = computePalletFit({
      spec: AU_STANDARD_PALLET, carton: { lengthMm: 400, widthMm: 300, heightMm: 250 },
      unitsPerCarton: 12, basis: 'measured',
    })
    const stored = onAuStandard.fit!.unitsPerPallet
    expect(palletProvenance(stored, onAuStandard.fit!)).toBe('measured')

    const onEuro = computePalletFit({
      spec: { ...AU_STANDARD_PALLET, footprintLengthMm: 1200, footprintWidthMm: 800 },
      carton: { lengthMm: 400, widthMm: 300, heightMm: 250 }, unitsPerCarton: 12, basis: 'measured',
    })
    expect(onEuro.fit!.unitsPerPallet).not.toBe(stored)
    expect(palletProvenance(stored, onEuro.fit!)).toBe('manual')
  })

  it('claims nothing when there is no figure or nothing to compare against', () => {
    expect(palletProvenance(null, fit(432, 'measured'))).toBe('unknown')
    expect(palletProvenance(undefined, fit(432, 'measured'))).toBe('unknown')
    expect(palletProvenance(432, null)).toBe('unknown')
  })
})

describe('uomProvenance', () => {
  const product = (over: Partial<Product> = {}): Product =>
    ({
      id: 1, lengthCm: 8, widthCm: 6, heightCm: 25,
      uoms: [
        { id: 1, code: 'each', factorToBase: 1, price: 1, isBase: true, isOrderable: true, isReceivable: true, sortOrder: 0 },
        { id: 2, code: 'carton', factorToBase: 12, price: 12, isBase: false, isOrderable: true, isReceivable: true, sortOrder: 1 },
      ],
      ...over,
    } as Product)

  it('says nothing at all about a row that is not the pallet', () => {
    const p = product()
    expect(uomProvenance(p, { code: 'carton', factorToBase: 12 }, AU_STANDARD_PALLET)).toBe('unknown')
  })

  it('labels a pallet row estimated when the carton was never measured', () => {
    // Accept whatever the estimate suggests, then read its provenance back —
    // the round trip an admin actually performs.
    const p = product()
    const suggested = resolvePalletFit({
      spec: AU_STANDARD_PALLET,
      cartonCm: { lengthCm: null, widthCm: null, heightCm: null },
      unitCm: { lengthCm: 8, widthCm: 6, heightCm: 25 },
      unitsPerCarton: 12,
    })
    expect(suggested.ok).toBe(true)
    expect(uomProvenance(p, { code: 'pallet', factorToBase: suggested.fit!.unitsPerPallet }, AU_STANDARD_PALLET))
      .toBe('estimated')
  })

  it('flips estimated -> measured when the carton is measured afterwards', () => {
    // The case a stored flag gets wrong: the figure stops being a guess and
    // nothing would have updated the flag. Here it is recomputed, so it moves.
    const est = resolvePalletFit({
      spec: AU_STANDARD_PALLET,
      cartonCm: { lengthCm: null, widthCm: null, heightCm: null },
      unitCm: { lengthCm: 8, widthCm: 6, heightCm: 25 },
      unitsPerCarton: 12,
    })
    const stored = est.fit!.unitsPerPallet
    const estimatedBox = est.estimate!.box

    // Measuring the carton and finding EXACTLY the estimated box makes the same
    // stored figure read as measured.
    const measured = product({
      cartonLengthCm: estimatedBox.lengthMm / 10,
      cartonWidthCm: estimatedBox.widthMm / 10,
      cartonHeightCm: estimatedBox.heightMm / 10,
    } as Partial<Product>)
    expect(uomProvenance(measured, { code: 'pallet', factorToBase: stored }, AU_STANDARD_PALLET))
      .toBe('measured')
  })

  it('labels a pallet row measured once the carton dimensions are on file', () => {
    const p = product({ cartonLengthCm: 40, cartonWidthCm: 30, cartonHeightCm: 25 } as Partial<Product>)
    // 400x300x250 on AU standard = 6 per layer x 6 layers x 12 = 432.
    expect(uomProvenance(p, { code: 'pallet', factorToBase: 432 }, AU_STANDARD_PALLET)).toBe('measured')
  })

  it('claims nothing without a pallet spec', () => {
    const p = product({ cartonLengthCm: 40, cartonWidthCm: 30, cartonHeightCm: 25 } as Partial<Product>)
    expect(uomProvenance(p, { code: 'pallet', factorToBase: 432 }, null)).toBe('unknown')
  })

  it('claims nothing about a missing product or row', () => {
    expect(uomProvenance(null, { code: 'pallet', factorToBase: 1 }, AU_STANDARD_PALLET)).toBe('unknown')
    expect(uomProvenance(product(), null, AU_STANDARD_PALLET)).toBe('unknown')
  })
})

describe('the words shown to an operator', () => {
  it('gives every state a label and a sentence, except unknown which says nothing', () => {
    for (const p of ['measured', 'estimated', 'manual'] as const) {
      expect(provenanceLabel(p)).toBeTruthy()
      expect((provenanceHint(p) ?? '').length).toBeGreaterThan(20)
    }
    expect(provenanceLabel('unknown')).toBeNull()
    expect(provenanceHint('unknown')).toBeNull()
  })

  it('tells an estimate apart from a measurement in words, not just in a flag', () => {
    expect(provenanceHint('estimated')).toMatch(/approximate|estimated/i)
    expect(provenanceHint('manual')).toMatch(/by hand|changed/i)
  })
})
