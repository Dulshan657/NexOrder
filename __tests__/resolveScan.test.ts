import { describe, it, expect } from 'vitest'
import {
  barcodeVariants,
  buildScanIndex,
  describeScanMatch,
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
