// NX-0050: a carton whose label says one product but holds another.
//
// planWrongProduct decides, before anything is written, whether the stop can be
// re-recorded and what the two stock legs are; mismatchNotice is the words the
// desk reads. Made-up products only. The module is loaded inside each test: on
// the base commit it does not exist, and a top-level import would stop the
// file loading.

import { describe, expect, it } from 'vitest'

const load = () => import('../supabase/functions/_shared/labelMismatch')

const task = {
  id: 77, productId: 1, quantity: 40, warehouseId: 9, handlingUnitId: 500, status: 'assigned',
}

describe('planWrongProduct', () => {
  it('takes the label product off and puts the real product on, at the warehouse root', async () => {
    const { planWrongProduct } = await load()
    expect(planWrongProduct({ task, realProductId: 2, quantity: 70, plateProductIds: [1] })).toEqual({
      ok: true,
      legs: [
        { productId: 1, locationId: 9, delta: -40, handlingUnitId: 500 },
        { productId: 2, locationId: 9, delta: 70, handlingUnitId: 500 },
      ],
    })
    // A loose line has no plate.
    expect(planWrongProduct({
      task: { ...task, handlingUnitId: null }, realProductId: 2, quantity: 5, plateProductIds: [],
    })).toEqual({
      ok: true,
      legs: [
        { productId: 1, locationId: 9, delta: -40, handlingUnitId: null },
        { productId: 2, locationId: 9, delta: 5, handlingUnitId: null },
      ],
    })
  })

  it('refuses the same product, a non-whole or non-positive quantity, and a mixed plate', async () => {
    const { planWrongProduct } = await load()
    expect(planWrongProduct({ task, realProductId: 1, quantity: 5, plateProductIds: [1] }))
      .toEqual({ ok: false, code: 'INVALID_INPUT', message: 'That is the same product. Pick what is really in the carton.' })
    for (const q of [0, -3, 2.5, Number.NaN]) {
      expect(planWrongProduct({ task, realProductId: 2, quantity: q, plateProductIds: [1] }))
        .toEqual({ ok: false, code: 'INVALID_INPUT', message: 'Enter how many there are, as a whole number.' })
    }
    expect(planWrongProduct({ task, realProductId: 2, quantity: 5, plateProductIds: [1, 3] }))
      .toEqual({ ok: false, code: 'CONFLICT', message: 'Break this pallet down first.' })
    expect(planWrongProduct({ task: { ...task, status: 'accepted' }, realProductId: 2, quantity: 5, plateProductIds: [1] }))
      .toEqual({ ok: false, code: 'CONFLICT', message: 'This stop is already done.' })
  })
})

describe('mismatchNotice', () => {
  it('names the scanned code, both products and what to do', async () => {
    const { mismatchNotice } = await load()
    expect(mismatchNotice({ scannedCode: '9999000000139', labelSku: 'TST-CHL-200', realSku: 'TST-GRK-100' }))
      .toBe('Label mismatch: 9999000000139 scanned as TST-CHL-200, but the carton was TST-GRK-100. Check the barcode.')
  })
})
