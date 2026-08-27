// What the putaway walk should ask an operator to hold up to the gun.
//
// The bug this rule exists to close: a receipt mints a plate for every line but
// prints no sticker, so the walk demanded HU-000509 — a code that existed only
// in the database — while the box in the operator's hands carried its own
// barcode. Every branch below is pinned by `reason`, not merely by `expect`, so
// a test failure names WHICH rule moved rather than only that the answer did.

import { describe, it, expect } from 'vitest'
import {
  classifyPutawayScan,
  plateNeedsLabel,
  putawayIdentity,
  scanIsThisProduct,
} from '@/supabase/functions/_shared/putawayIdentity'

describe('putawayIdentity', () => {
  it('asks for nothing on a line with no plate', () => {
    // Legacy stock and the CSV opening-stock path. This is the pre-existing
    // behaviour, preserved: those lines never had an identify step, and adding
    // one would slow a working path down for no evidence anyone could get wrong.
    const id = putawayIdentity({ huCode: null, productBarcode: '9310072011691' })
    expect(id.expect).toBe('none')
    expect(id.reason).toBe('no_plate')
    expect(id.canPrintLabel).toBe(false)
    expect(id.needsLabel).toBe(false)
  })

  it('asks for the plate once a sticker has been printed', () => {
    const id = putawayIdentity({
      huCode: 'HU-000123',
      huType: 'carton',
      huLabelPrinted: true,
      productBarcode: '9310072011691',
    })
    expect(id.expect).toBe('plate')
    expect(id.reason).toBe('label_printed')
    expect(id.canPrintLabel).toBe(false)
    // The barcode still works — an operator holding the stronger evidence is
    // never refused for producing it, and vice versa.
    expect(id.acceptsProduct).toBe(true)
  })

  it('asks for the plate on an unlabelled PALLET, and offers to print it', () => {
    // A carton barcode identifies the SKU and cannot tell two pallets of it
    // apart. This is the case the operating rule says wants a label.
    const id = putawayIdentity({
      huCode: 'HU-000200',
      huType: 'pallet',
      huLabelPrinted: false,
      productBarcode: '9310072011691',
    })
    expect(id.expect).toBe('plate')
    expect(id.reason).toBe('pallet_unlabelled')
    expect(id.needsLabel).toBe(true)
    expect(id.canPrintLabel).toBe(true)
    expect(id.acceptsProduct).toBe(true)
  })

  it('asks for the PRODUCT on an unlabelled carton whose goods carry a barcode', () => {
    // The reported bug, in one assertion: HU-000509 on the demo — a carton
    // plate, never labelled, holding Abalone Sauce 210ml.
    const id = putawayIdentity({
      huCode: 'HU-000509',
      huType: 'carton',
      huLabelPrinted: false,
      productBarcode: '4796009868869',
    })
    expect(id.expect).toBe('product')
    expect(id.reason).toBe('product_barcode')
    // Not "needs" a label — a barcoded carton identifies itself — but printing
    // stays reachable, because a barcode can arrive damaged.
    expect(id.needsLabel).toBe(false)
    expect(id.canPrintLabel).toBe(true)
    expect(id.acceptsPlate).toBe(true)
  })

  it('asks for nothing when there is no sticker AND no barcode, and says a label is needed', () => {
    const id = putawayIdentity({
      huCode: 'HU-000300',
      huType: 'carton',
      huLabelPrinted: false,
      productBarcode: null,
    })
    expect(id.expect).toBe('none')
    expect(id.reason).toBe('nothing_scannable')
    expect(id.needsLabel).toBe(true)
    expect(id.canPrintLabel).toBe(true)
  })

  it('treats a blank barcode as no barcode', () => {
    // A whitespace-only column is what a spreadsheet import leaves behind, and
    // it is not something anyone can scan.
    const id = putawayIdentity({ huCode: 'HU-1', huType: 'carton', productBarcode: '   ' })
    expect(id.reason).toBe('nothing_scannable')
  })

  it('prefers the printed sticker over the barcode', () => {
    // Ordering matters: a plate names this exact unit load, a barcode names a
    // SKU. When both exist the stronger one is what the prompt asks for.
    const id = putawayIdentity({
      huCode: 'HU-1',
      huType: 'carton',
      huLabelPrinted: true,
      productBarcode: '9310072011691',
    })
    expect(id.expect).toBe('plate')
  })
})

describe('classifyPutawayScan', () => {
  const task = { huCode: 'HU-000509' }

  it('routes the task plate code to plate evidence', () => {
    expect(classifyPutawayScan('HU-000509', task)).toBe('plate')
  })

  it('normalises before comparing', () => {
    expect(classifyPutawayScan('  hu-000509  ', task)).toBe('plate')
  })

  it('routes a product barcode to product evidence', () => {
    expect(classifyPutawayScan('4796009868869', task)).toBe('product')
  })

  it('routes an unrelated string to product evidence, not plate', () => {
    // Deliberate: checkPutawayScan then answers "that item is not <SKU>",
    // which is actionable. Routing it to the plate key produced "that is plate
    // 4796009868869" — a sentence with no true reading.
    expect(classifyPutawayScan('WHO-KNOWS', task)).toBe('product')
  })

  it('routes anything to product when the line names no plate', () => {
    expect(classifyPutawayScan('HU-000509', { huCode: null })).toBe('product')
  })
})

describe('scanIsThisProduct', () => {
  const product = { sku: 'AYM-SAU-018', barcode: '4796009868869' }

  it('recognises the barcode', () => {
    expect(scanIsThisProduct('4796009868869', product)).toBe(true)
  })

  it('recognises the SKU', () => {
    expect(scanIsThisProduct('aym-sau-018', product)).toBe(true)
  })

  it('rejects anything else', () => {
    expect(scanIsThisProduct('HU-000509', product)).toBe(false)
    expect(scanIsThisProduct('', product)).toBe(false)
  })
})

describe('plateNeedsLabel', () => {
  it('always wants one for a pallet', () => {
    expect(plateNeedsLabel({ huType: 'pallet', productBarcodes: ['4796009868869'] })).toBe(true)
  })

  it('does not want one for a barcoded carton', () => {
    expect(plateNeedsLabel({ huType: 'carton', productBarcodes: ['4796009868869'] })).toBe(false)
  })

  it('wants one for a carton whose goods carry no barcode', () => {
    expect(plateNeedsLabel({ huType: 'carton', productBarcodes: [null] })).toBe(true)
    expect(plateNeedsLabel({ huType: 'carton', productBarcodes: ['  '] })).toBe(true)
  })

  it('wants one if ANY product on the plate is unidentifiable', () => {
    expect(plateNeedsLabel({ huType: 'carton', productBarcodes: ['4796009868869', null] })).toBe(true)
  })

  it('never wants one for a plate already printed', () => {
    // Including a pallet: reprinting is a deliberate act, not a default.
    expect(plateNeedsLabel({ huType: 'pallet', labelPrinted: true, productBarcodes: [null] })).toBe(false)
  })
})
