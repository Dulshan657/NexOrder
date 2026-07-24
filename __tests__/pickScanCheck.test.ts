import { describe, it, expect } from 'vitest'
import { checkPickScan, type PickTaskContext } from '@/supabase/functions/_shared/pickScanCheck'
import { codeMatchesProduct } from '@/supabase/functions/_shared/scanNormalize'

const TASK: PickTaskContext = {
  taskLocationCode: 'MAIN-B-4-2-L2',
  product: { id: 10, sku: 'AYM-COC-003', name: 'Coconut Milk', barcode: '9310072011691' },
  remainingQty: 6,
}

describe('checkPickScan — quantity', () => {
  it('refuses a zero or negative pick', () => {
    const v = checkPickScan(TASK, {}, 0)
    expect(v.ok).toBe(false)
    if (v.ok === false) expect(v.code).toBe('INVALID_QTY')
  })

  it('refuses more than the task needs', () => {
    const v = checkPickScan(TASK, {}, 7)
    expect(v.ok).toBe(false)
    if (v.ok === false) {
      expect(v.code).toBe('INVALID_QTY')
      expect(v.message).toContain('6')
    }
  })

  it('allows exactly the remaining quantity', () => {
    expect(checkPickScan(TASK, {}, 6).ok).toBe(true)
  })
})

describe('checkPickScan — bin', () => {
  it('accepts the directed bin', () => {
    const v = checkPickScan(TASK, { locationCode: 'MAIN-B-4-2-L2', productCode: 'AYM-COC-003' }, 1)
    expect(v.ok).toBe(true)
    if (v.ok) expect(v.verified).toBe(true)
  })

  it('accepts a bin scanned in the wrong case', () => {
    const v = checkPickScan(TASK, { locationCode: 'main-b-4-2-l2', productCode: 'AYM-COC-003' }, 1)
    expect(v.ok).toBe(true)
  })

  it('tolerates the carriage return a wedge gun appends', () => {
    const v = checkPickScan(TASK, { locationCode: 'MAIN-B-4-2-L2\r\n', productCode: 'AYM-COC-003' }, 1)
    expect(v.ok).toBe(true)
  })

  it('REFUSES a different bin, naming both', () => {
    const v = checkPickScan(TASK, { locationCode: 'MAIN-B-9-9-L1', productCode: 'AYM-COC-003' }, 1)
    expect(v.ok).toBe(false)
    if (v.ok === false) {
      expect(v.code).toBe('WRONG_BIN')
      expect(v.message).toContain('MAIN-B-9-9-L1')
      expect(v.message).toContain('MAIN-B-4-2-L2')
    }
  })

  it('refuses a neighbouring level — the whole point of levelled racks', () => {
    const v = checkPickScan(TASK, { locationCode: 'MAIN-B-4-2-L3', productCode: 'AYM-COC-003' }, 1)
    expect(v.ok).toBe(false)
  })
})

describe('checkPickScan — product', () => {
  it('accepts the SKU', () => {
    expect(checkPickScan(TASK, { locationCode: 'MAIN-B-4-2-L2', productCode: 'AYM-COC-003' }, 1).ok).toBe(true)
  })

  it('accepts the supplier barcode', () => {
    expect(checkPickScan(TASK, { locationCode: 'MAIN-B-4-2-L2', productCode: '9310072011691' }, 1).ok).toBe(true)
  })

  it('REFUSES a different product', () => {
    const v = checkPickScan(TASK, { locationCode: 'MAIN-B-4-2-L2', productCode: 'AYM-RICE-001' }, 1)
    expect(v.ok).toBe(false)
    if (v.ok === false) {
      expect(v.code).toBe('WRONG_PRODUCT')
      expect(v.message).toContain('AYM-COC-003')
    }
  })

  it('refuses a barcode belonging to another product', () => {
    const v = checkPickScan(TASK, { locationCode: 'MAIN-B-4-2-L2', productCode: '5000000000000' }, 1)
    expect(v.ok).toBe(false)
  })
})

describe('checkPickScan — verification status', () => {
  it('is unverified when nothing was scanned', () => {
    const v = checkPickScan(TASK, {}, 1)
    expect(v.ok).toBe(true)
    if (v.ok) expect(v.verified).toBe(false)
  })

  it('is UNVERIFIED on a bin scan alone', () => {
    // Standing in the right aisle does not prove the right SKU came off the
    // shelf — which is the more common and more expensive error.
    const v = checkPickScan(TASK, { locationCode: 'MAIN-B-4-2-L2' }, 1)
    expect(v.ok).toBe(true)
    if (v.ok) expect(v.verified).toBe(false)
  })

  it('is unverified on a product scan alone', () => {
    const v = checkPickScan(TASK, { productCode: 'AYM-COC-003' }, 1)
    expect(v.ok).toBe(true)
    if (v.ok) expect(v.verified).toBe(false)
  })

  it('is verified only when both were scanned and both matched', () => {
    const v = checkPickScan(TASK, { locationCode: 'MAIN-B-4-2-L2', productCode: 'AYM-COC-003' }, 1)
    expect(v.ok).toBe(true)
    if (v.ok) expect(v.verified).toBe(true)
  })

  it('still validates a partial scan — a wrong bin alone is refused', () => {
    expect(checkPickScan(TASK, { locationCode: 'WRONG-BIN' }, 1).ok).toBe(false)
  })
})

describe('codeMatchesProduct', () => {
  it('matches a UPC-A scan against an EAN-13 stored barcode', () => {
    expect(codeMatchesProduct('012345678905', { sku: 'X', barcode: '0012345678905' })).toBe(true)
  })

  it('matches an EAN-13 scan against a UPC-A stored barcode', () => {
    expect(codeMatchesProduct('0012345678905', { sku: 'X', barcode: '012345678905' })).toBe(true)
  })

  it('does not match a product with no barcode by an arbitrary number', () => {
    expect(codeMatchesProduct('9999999999999', { sku: 'X', barcode: null })).toBe(false)
  })

  it('never matches an empty scan', () => {
    expect(codeMatchesProduct('', { sku: 'X', barcode: 'Y' })).toBe(false)
  })
})
