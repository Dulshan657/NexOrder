import { describe, it, expect } from 'vitest'
import {
  barcodeVariants,
  buildScanIndex,
  codeMatchesProduct,
  describeScanMatch,
  gtin14Base,
  gtinCheckDigit,
  hasValidGtinCheckDigit,
  normalizeScan,
  resolveScan,
  type ScanIndexSources,
} from '@/lib/scan/resolveScan'

const SOURCES: ScanIndexSources = {
  locations: [
    { id: 1, code: 'MAIN-B-4-2-L2', name: 'Bay 4-2 Level 2', isActive: true },
    { id: 2, code: 'MAIN-Z1', name: 'Ambient zone', isActive: true },
    { id: 3, code: 'MAIN-OLD-1', name: 'Retired bin', isActive: false },
  ],
  products: [
    { id: 10, sku: 'AYM-COC-003', name: 'Coconut Milk', barcode: '9310072011691' },
    { id: 11, sku: 'AYM-RICE-001', name: 'Jasmine Rice', barcode: null },
    // 12-digit UPC-A, deliberately stored WITHOUT the EAN-13 leading zero.
    { id: 12, sku: 'AYM-SOY-002', name: 'Soy Sauce', barcode: '012345678905' },
  ],
  batches: [{ id: 100, productId: 11, lotCode: 'LOT-A', barcode: 'BATCH-RICE-A' }],
  handlingUnits: [{ id: 500, code: 'HU-000123' }],
}

const index = buildScanIndex(SOURCES)

describe('normalizeScan', () => {
  it('upper-cases and trims', () => {
    expect(normalizeScan('  main-b-4-2-l2 ')).toBe('MAIN-B-4-2-L2')
  })

  it('strips the carriage return a keyboard-wedge scanner appends', () => {
    expect(normalizeScan('MAIN-Z1\r\n')).toBe('MAIN-Z1')
  })

  it('strips NUL and zero-width characters that ride along in some payloads', () => {
    expect(normalizeScan('MAIN\u0000\u200B-Z1\u0009')).toBe('MAIN-Z1')
  })

  it('returns empty for whitespace-only input', () => {
    expect(normalizeScan('   \n')).toBe('')
  })
})

describe('barcodeVariants', () => {
  it('offers the EAN-13 form of a 12-digit UPC-A', () => {
    expect(barcodeVariants('012345678905')).toContain('0012345678905')
  })

  it('offers the UPC-A form of a zero-prefixed EAN-13', () => {
    expect(barcodeVariants('0012345678905')).toContain('012345678905')
  })

  it('leaves non-numeric codes alone', () => {
    expect(barcodeVariants('AYM-COC-003')).toEqual(['AYM-COC-003'])
  })

  it('offers the EAN-13 form of a GTIN-14 whose indicator is zero', () => {
    // Zero-padding a GTIN is an identity, not a convention: the check digit
    // weights digits from the right, so a leading zero leaves the weighted sum
    // untouched and the check digit still valid.
    expect(barcodeVariants('09310072011691')).toContain('9310072011691')
    expect(barcodeVariants('9310072011691')).toContain('09310072011691')
  })

  it('does NOT equate a case pack with the unit inside it', () => {
    // 19310072011698 is an outer carton of 9310072011691. They are different
    // items — folding them together is exactly what would destroy the quantity.
    expect(barcodeVariants('19310072011698')).not.toContain('9310072011691')
    expect(barcodeVariants('9310072011691')).not.toContain('19310072011698')
  })
})

describe('gtinCheckDigit', () => {
  it('matches the published check digit at every GTIN length', () => {
    // Verified by hand against codes already used as fixtures in this file.
    expect(gtinCheckDigit('931007201169')).toBe(1) // EAN-13  9310072011691
    expect(gtinCheckDigit('01234567890')).toBe(5) // UPC-A   012345678905
    expect(gtinCheckDigit('1931007201169')).toBe(8) // ITF-14 19310072011698
  })

  it('accepts a valid code and rejects a corrupted one', () => {
    expect(hasValidGtinCheckDigit('9310072011691')).toBe(true)
    expect(hasValidGtinCheckDigit('9310072011690')).toBe(false)
    expect(hasValidGtinCheckDigit('19310072011698')).toBe(true)
    expect(hasValidGtinCheckDigit('not-a-number')).toBe(false)
  })
})

describe('gtin14Base — Phase 2 groundwork, deliberately unwired', () => {
  it('recovers the unit EAN-13 from an outer carton code', () => {
    // The unit's own check digit does NOT appear in the ITF-14, so recovering
    // it means dropping the last digit and RECOMPUTING. Simply stripping the
    // indicator would give 9310072011698, which is not a valid code at all.
    expect(gtin14Base('19310072011698')).toEqual({ base: '9310072011691', indicator: 1 })
  })

  it('carries the indicator, which is what says how big the pack is', () => {
    // The digit itself is a packaging level, not a quantity — the quantity comes
    // from product_uoms. But without it there is nothing to look the pack up by.
    expect(gtin14Base('19310072011698')!.indicator).toBe(1)
  })

  it('refuses a code with a bad check digit rather than inventing a base', () => {
    // Any 14 digits could be an internal serial. Without this guard one would
    // fold into a 13-digit code that might collide with a real product.
    expect(gtin14Base('19310072011690')).toBeNull()
  })

  it('returns null for indicator zero — that is a padded unit, not a case', () => {
    // barcodeVariants already handles that as plain equality.
    expect(gtin14Base('09310072011691')).toBeNull()
  })

  it('returns null for anything that is not fourteen digits', () => {
    expect(gtin14Base('9310072011691')).toBeNull()
    expect(gtin14Base('AYM-COC-003')).toBeNull()
  })

  it('is NOT consulted by codeMatchesProduct', () => {
    // The load-bearing assertion of this whole group. Scanning a carton must not
    // resolve to "one unit of X" -- that is the bug the per-pack-size design in
    // Phase 2 exists to avoid, and wiring this in would bake it in early.
    const product = { sku: 'AYM-COC-003', barcode: '9310072011691' }
    expect(codeMatchesProduct('19310072011698', product)).toBe(false)
    expect(codeMatchesProduct('9310072011691', product)).toBe(true)
    expect(codeMatchesProduct('09310072011691', product)).toBe(true)
  })
})

describe('resolveScan', () => {
  it('resolves a location code', () => {
    const result = resolveScan('MAIN-B-4-2-L2', index)
    expect(result.kind).toBe('location')
    if (result.kind === 'location') expect(result.location.id).toBe(1)
  })

  it('resolves a location typed in the wrong case', () => {
    const result = resolveScan('main-z1', index)
    expect(result.kind).toBe('location')
  })

  it('still resolves an INACTIVE location, so the UI can say why it is unusable', () => {
    const result = resolveScan('MAIN-OLD-1', index)
    expect(result.kind).toBe('location')
    if (result.kind === 'location') expect(result.location.isActive).toBe(false)
  })

  it('resolves a handling unit code', () => {
    const result = resolveScan('HU-000123', index)
    expect(result.kind).toBe('handlingUnit')
  })

  it('resolves a product by SKU', () => {
    const result = resolveScan('AYM-COC-003', index)
    expect(result.kind).toBe('product')
    if (result.kind === 'product') {
      expect(result.product.id).toBe(10)
      expect(result.matchedOn).toBe('sku')
    }
  })

  it('resolves a product by supplier barcode', () => {
    const result = resolveScan('9310072011691', index)
    expect(result.kind).toBe('product')
    if (result.kind === 'product') expect(result.matchedOn).toBe('barcode')
  })

  it('matches a UPC-A stored barcode when the scanner reports EAN-13', () => {
    const result = resolveScan('0012345678905', index)
    expect(result.kind).toBe('product')
    if (result.kind === 'product') expect(result.product.id).toBe(12)
  })

  it('resolves a batch barcode to its product', () => {
    const result = resolveScan('BATCH-RICE-A', index)
    expect(result.kind).toBe('product')
    if (result.kind === 'product') {
      expect(result.matchedOn).toBe('batchBarcode')
      expect(result.product.id).toBe(11)
      expect(result.batch?.lotCode).toBe('LOT-A')
    }
  })

  it('returns empty for a blank scan', () => {
    expect(resolveScan('  ', index).kind).toBe('empty')
  })

  it('returns unknown for a code in no namespace', () => {
    const result = resolveScan('NOT-A-THING', index)
    expect(result.kind).toBe('unknown')
    if (result.kind === 'unknown') expect(result.normalized).toBe('NOT-A-THING')
  })

  it('reports ambiguity rather than guessing when a code names two things', () => {
    // A location whose code collides with a product SKU — the exact hazard of
    // encoding bare text with no namespace prefix.
    const collided = buildScanIndex({
      locations: [{ id: 9, code: 'SHARED-1', name: 'Bin', isActive: true }],
      products: [{ id: 90, sku: 'SHARED-1', name: 'Product', barcode: null }],
    })
    const result = resolveScan('SHARED-1', collided)
    expect(result.kind).toBe('ambiguous')
    if (result.kind === 'ambiguous') {
      expect(result.candidates).toHaveLength(2)
      // Documented preference order: location first.
      expect(result.candidates[0].kind).toBe('location')
    }
  })

  it('does NOT call a SKU hit and a barcode hit on the same product ambiguous', () => {
    const selfMatch = buildScanIndex({
      products: [{ id: 70, sku: '5012345678900', name: 'Odd one', barcode: '5012345678900' }],
    })
    const result = resolveScan('5012345678900', selfMatch)
    expect(result.kind).toBe('product')
    if (result.kind === 'product') expect(result.matchedOn).toBe('sku')
  })

  it('ignores a batch barcode whose product was not loaded', () => {
    const orphan = buildScanIndex({
      batches: [{ id: 1, productId: 999, lotCode: 'X', barcode: 'ORPHAN-1' }],
    })
    expect(resolveScan('ORPHAN-1', orphan).kind).toBe('unknown')
  })
})

describe('describeScanMatch', () => {
  it('describes each kind', () => {
    expect(describeScanMatch({ kind: 'location', location: SOURCES.locations![0] })).toContain('MAIN-B-4-2-L2')
    expect(describeScanMatch({ kind: 'handlingUnit', handlingUnit: SOURCES.handlingUnits![0] })).toContain('HU-000123')
    expect(
      describeScanMatch({ kind: 'product', product: SOURCES.products![0], matchedOn: 'sku' }),
    ).toContain('Coconut Milk')
  })
})

// ── COLLISIONS WITHIN ONE NAMESPACE ─────────────────────────────────────────
//
// The index buckets were single-valued until 2026-08-17, so `Map.set` silently
// dropped one of any colliding pair and the operator was handed the survivor
// with full confidence. Ambiguity was only ever detected ACROSS namespaces,
// which is the case least likely to happen.
describe('resolveScan — intra-namespace collisions', () => {
  it('reports two products sharing a barcode rather than picking one', () => {
    const index = buildScanIndex({
      products: [
        { id: 1, sku: 'SKU-ONE', name: 'First', barcode: '9310072011691' },
        { id: 2, sku: 'SKU-TWO', name: 'Second', barcode: '9310072011691' },
      ],
    })
    const result = resolveScan('9310072011691', index)
    expect(result.kind).toBe('ambiguous')
    if (result.kind === 'ambiguous') {
      expect(result.candidates).toHaveLength(2)
      expect(result.candidates.every((c) => c.kind === 'product')).toBe(true)
    }
  })

  it('reports a collision reached through DIFFERENT GTIN spellings of one code', () => {
    // One product stores UPC-A, the other the equivalent EAN-13. They are the
    // same number, so a single scan reaches both.
    const index = buildScanIndex({
      products: [
        { id: 1, sku: 'UPC-STORED', name: 'Stored as UPC-A', barcode: '012345678905' },
        { id: 2, sku: 'EAN-STORED', name: 'Stored as EAN-13', barcode: '0012345678905' },
      ],
    })
    const result = resolveScan('012345678905', index)
    expect(result.kind).toBe('ambiguous')
    if (result.kind === 'ambiguous') expect(result.candidates).toHaveLength(2)
  })

  it('counts one product once even when several of its variants match', () => {
    // The failure this guards: collecting per-variant without de-duplicating
    // would make every GTIN-foldable product look like an ambiguity with itself.
    const index = buildScanIndex({
      products: [{ id: 1, sku: 'ONLY', name: 'Sole', barcode: '012345678905' }],
    })
    const result = resolveScan('012345678905', index)
    expect(result.kind).toBe('product')
  })

  it('reports two locations normalising to the same string', () => {
    const index = buildScanIndex({
      locations: [
        { id: 1, code: 'MAIN-B-1', name: 'One', isActive: true },
        { id: 2, code: 'main-b-1', name: 'Two', isActive: true },
      ],
    })
    const result = resolveScan('MAIN-B-1', index)
    expect(result.kind).toBe('ambiguous')
    if (result.kind === 'ambiguous') expect(result.candidates).toHaveLength(2)
  })

  it('still lets a SKU beat a barcode on a different product', () => {
    // The confidence order is unchanged: our own identifier on our own label
    // outranks a supplier's number, so this is NOT an ambiguity.
    const index = buildScanIndex({
      products: [
        { id: 1, sku: '9310072011691', name: 'SKU-shaped', barcode: null },
        { id: 2, sku: 'OTHER', name: 'Barcode holder', barcode: '9310072011691' },
      ],
    })
    const result = resolveScan('9310072011691', index)
    expect(result.kind).toBe('product')
    if (result.kind === 'product') expect(result.product.id).toBe(1)
  })

  it('reports two products sharing a SKU', () => {
    const index = buildScanIndex({
      products: [
        { id: 1, sku: 'DUPE-1', name: 'First', barcode: null },
        { id: 2, sku: 'DUPE-1', name: 'Second', barcode: null },
      ],
    })
    expect(resolveScan('DUPE-1', index).kind).toBe('ambiguous')
  })
})
