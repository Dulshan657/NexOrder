// This test is the ONLY thing that makes the duplicated check-digit arithmetic
// in `scripts/lib/demoBarcodes.mjs` legitimate. That module is a `.mjs` script
// helper and cannot import the shared `.ts` definition without a build step, so
// the formula appears twice; here the two are held against each other.
//
// If this file is deleted, the seed script can start minting barcodes the app
// itself would reject, and nothing would say so until an operator scanned one.

import { describe, it, expect } from 'vitest'
import { barcodeFor, checkDigit, ean13For, upcAFor } from '@/scripts/lib/demoBarcodes.mjs'
import {
  barcodeVariants,
  gtinCheckDigit,
  hasValidGtinCheckDigit,
  normalizeScan,
} from '@/supabase/functions/_shared/scanNormalize'

const IDS = Array.from({ length: 300 }, (_, i) => i + 1)

describe('demo barcode generation agrees with the shared GTIN definition', () => {
  it('computes the same check digit as _shared/scanNormalize', () => {
    for (const sample of ['930000000001', '0123456789', '9312345678', '00000000']) {
      expect(checkDigit(sample)).toBe(gtinCheckDigit(sample))
    }
  })

  it('mints only codes the app considers valid', () => {
    for (const id of IDS) {
      const code = barcodeFor(id)
      expect(hasValidGtinCheckDigit(code), `product ${id} → ${code}`).toBe(true)
    }
  })

  it('mints EAN-13 at 13 digits and UPC-A at 12', () => {
    expect(ean13For(7)).toHaveLength(13)
    expect(upcAFor(8)).toHaveLength(12)
  })

  it('is deterministic, so a sheet printed last week still scans today', () => {
    expect(IDS.map(barcodeFor)).toEqual(IDS.map(barcodeFor))
  })

  it('never mints the same code for two different products', () => {
    const codes = IDS.map(barcodeFor)
    expect(new Set(codes).size).toBe(codes.length)
  })

  it('gives some products a UPC-A, which is the whole point of seeding at all', () => {
    // An all-EAN-13 catalogue would leave `barcodeVariants` untested by a real
    // beam — the folding only shows itself when the stored width and the
    // scanned width differ.
    const upcs = IDS.filter((id) => barcodeFor(id).length === 12)
    expect(upcs.length).toBeGreaterThan(50)
  })

  it('folds a seeded UPC-A onto its EAN-13 spelling and back', () => {
    const upc = upcAFor(8)
    const asEan = `0${upc}`
    expect(barcodeVariants(normalizeScan(upc))).toContain(asEan)
    expect(barcodeVariants(normalizeScan(asEan))).toContain(asEan)
    expect(hasValidGtinCheckDigit(asEan)).toBe(true)
  })

  it('does not collide a seeded code with a demo SKU shape', () => {
    // SKUs on the demo are letter-led (`AYM-CHL-001`); a purely numeric code
    // can never equal one, so a seeded barcode cannot shadow a SKU lookup.
    for (const id of IDS.slice(0, 40)) {
      expect(barcodeFor(id)).toMatch(/^\d+$/)
    }
  })
})

describe('seeded codes are shaped like real retail barcodes', () => {
  it('keeps a UPC-A bare value 11 digits long', () => {
    // A `0` + zero-padded id would strip back to two or three digits, land in
    // the same keyspace as any other short numeric code, and fold to an 8-digit
    // GTIN as well. The manufacturer block is what prevents that.
    for (const id of [4, 8, 40, 400]) {
      const bare = upcAFor(id).replace(/^0+/, '')
      expect(bare, `id ${id}`).toHaveLength(11)
    }
  })

  it('never mints a code whose variants reach another product', () => {
    const byVariant = new Map<string, number>()
    for (const id of IDS) {
      for (const v of barcodeVariants(normalizeScan(barcodeFor(id)))) {
        const owner = byVariant.get(v)
        expect(owner === undefined || owner === id, `${v} claimed by ${owner} and ${id}`).toBe(true)
        byVariant.set(v, id)
      }
    }
  })

  it('starts an EAN-13 with the Australian GS1 prefix', () => {
    expect(ean13For(1).startsWith('93')).toBe(true)
  })
})
