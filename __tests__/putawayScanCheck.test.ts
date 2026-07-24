import { describe, it, expect } from 'vitest'
import { checkPutawayScan, type PutawayTaskContext } from '@/supabase/functions/_shared/putawayScanCheck'

const TASK: PutawayTaskContext = {
  assignedLocationCode: 'MAIN-B-4-2-L2',
  product: { id: 10, sku: 'AYM-COC-003', name: 'Coconut Milk', barcode: '9310072011691' },
  huCode: 'HU-000123',
  remainingQty: 40,
}

/** A line with no plate — legacy stock, and the CSV opening-stock path. */
const LOOSE: PutawayTaskContext = { ...TASK, huCode: null }

describe('checkPutawayScan — quantity', () => {
  it('refuses a zero or negative quantity', () => {
    const v = checkPutawayScan(TASK, {}, 0)
    expect(v.ok).toBe(false)
    if (v.ok === false) expect(v.code).toBe('INVALID_QTY')
  })

  it('refuses more than the task has left', () => {
    const v = checkPutawayScan(TASK, {}, 41)
    expect(v.ok).toBe(false)
    if (v.ok === false) {
      expect(v.code).toBe('INVALID_QTY')
      expect(v.message).toContain('40')
    }
  })

  it('allows exactly the remaining quantity', () => {
    expect(checkPutawayScan(TASK, {}, 40).ok).toBe(true)
  })

  it('allows a partial quantity', () => {
    expect(checkPutawayScan(TASK, {}, 12).ok).toBe(true)
  })
})

describe('checkPutawayScan — the thing being placed', () => {
  it('refuses a product that is not this line', () => {
    const v = checkPutawayScan(TASK, { productCode: 'AYM-RICE-001' }, 1)
    expect(v.ok).toBe(false)
    if (v.ok === false) expect(v.code).toBe('WRONG_PRODUCT')
  })

  it('accepts the SKU regardless of case', () => {
    expect(checkPutawayScan(TASK, { productCode: 'aym-coc-003' }, 1).ok).toBe(true)
  })

  it('accepts the barcode in its UPC-A form when stored as EAN-13', () => {
    const upc: PutawayTaskContext = {
      ...TASK,
      product: { ...TASK.product, barcode: '0012345678905' },
    }
    expect(checkPutawayScan(upc, { productCode: '012345678905' }, 1).ok).toBe(true)
  })

  it('refuses a plate that belongs to another task', () => {
    const v = checkPutawayScan(TASK, { handlingUnitCode: 'HU-000999' }, 1)
    expect(v.ok).toBe(false)
    if (v.ok === false) {
      expect(v.code).toBe('WRONG_PLATE')
      expect(v.message).toContain('HU-000123')
    }
  })

  it('accepts the right plate', () => {
    expect(checkPutawayScan(TASK, { handlingUnitCode: 'hu-000123' }, 1).ok).toBe(true)
  })

  it('ignores a plate scan on a line that names no plate', () => {
    // Scanning the pallet label out of habit must not wedge legacy/loose stock.
    expect(checkPutawayScan(LOOSE, { handlingUnitCode: 'HU-000123' }, 1).ok).toBe(true)
  })

  it('strips a wedge gun trailing return before comparing', () => {
    expect(checkPutawayScan(TASK, { handlingUnitCode: 'HU-000123\r\n' }, 1).ok).toBe(true)
  })
})

describe('checkPutawayScan — the bin', () => {
  it('marks a matching bin as placed where assigned', () => {
    const v = checkPutawayScan(TASK, { locationCode: 'MAIN-B-4-2-L2', handlingUnitCode: 'HU-000123' }, 40)
    expect(v.ok).toBe(true)
    if (v.ok) {
      expect(v.placedElsewhere).toBe(false)
      expect(v.verified).toBe(true)
    }
  })

  it('ALLOWS a different bin and reports where it actually went', () => {
    // The asymmetry with picking: a full or blocked bay is a real thing the
    // walker can see and the desk could not.
    const v = checkPutawayScan(TASK, { locationCode: 'MAIN-C-02-01', handlingUnitCode: 'HU-000123' }, 40)
    expect(v.ok).toBe(true)
    if (v.ok) {
      expect(v.placedElsewhere).toBe(true)
      expect(v.scannedLocationCode).toBe('MAIN-C-02-01')
      expect(v.verified).toBe(true)
    }
  })

  it('treats a case-different bin as the same bin', () => {
    const v = checkPutawayScan(TASK, { locationCode: 'main-b-4-2-l2', productCode: 'AYM-COC-003' }, 1)
    expect(v.ok).toBe(true)
    if (v.ok) expect(v.placedElsewhere).toBe(false)
  })
})

describe('checkPutawayScan — what counts as verified', () => {
  it('is unverified with no evidence at all, but still allowed', () => {
    const v = checkPutawayScan(TASK, {}, 40)
    expect(v.ok).toBe(true)
    if (v.ok) {
      expect(v.verified).toBe(false)
      expect(v.scannedLocationCode).toBeNull()
    }
  })

  it('is unverified when only the bin was scanned', () => {
    // Standing in the right aisle does not prove the right pallet was set down.
    const v = checkPutawayScan(TASK, { locationCode: 'MAIN-B-4-2-L2' }, 40)
    expect(v.ok).toBe(true)
    if (v.ok) expect(v.verified).toBe(false)
  })

  it('is unverified when only the plate was scanned', () => {
    const v = checkPutawayScan(TASK, { handlingUnitCode: 'HU-000123' }, 40)
    expect(v.ok).toBe(true)
    if (v.ok) expect(v.verified).toBe(false)
  })

  it('is verified by bin + product when the line has no plate', () => {
    const v = checkPutawayScan(LOOSE, { locationCode: 'MAIN-B-4-2-L2', productCode: 'AYM-COC-003' }, 40)
    expect(v.ok).toBe(true)
    if (v.ok) expect(v.verified).toBe(true)
  })
})
