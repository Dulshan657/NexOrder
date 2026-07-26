import { describe, it, expect } from 'vitest'
import { checkReplenScan } from '@/supabase/functions/_shared/replenScanCheck'

// A replenishment has two bins and they are validated in OPPOSITE ways. That
// asymmetry is the design, so it is what these tests pin down:
//
//   SOURCE      — a different bin is ALLOWED and recorded. The assigned bay is
//                 often found empty or blocked, and pulling from the next one
//                 along is the correct call.
//   DESTINATION — a different bin is REFUSED. The task exists because one pick
//                 slot is low; placing elsewhere leaves it exactly as short
//                 while reporting the work as done.

const TASK = {
  assignedFromCode: 'MAIN-B-04-L3',
  toCode: 'MAIN-B-04-L1',
  product: { id: 1, sku: 'CHILLI-1L', name: 'Chilli Oil 1L', barcode: '93123456' },
  huCode: 'HU-000123',
  remainingQty: 20,
}

describe('checkReplenScan', () => {
  it('accepts a clean scan of both bins and the plate', () => {
    const v = checkReplenScan(
      TASK,
      { fromLocationCode: 'MAIN-B-04-L3', toLocationCode: 'MAIN-B-04-L1', handlingUnitCode: 'HU-000123' },
      20,
    )
    expect(v.ok).toBe(true)
    if (v.ok) {
      expect(v.verified).toBe(true)
      expect(v.pulledElsewhere).toBe(false)
    }
  })

  // ── The source is a judgement call ────────────────────────────────────────

  it('ALLOWS a different source and reports it', () => {
    const v = checkReplenScan(
      TASK,
      { fromLocationCode: 'MAIN-B-05-L3', toLocationCode: 'MAIN-B-04-L1' },
      20,
    )
    expect(v.ok).toBe(true)
    if (v.ok) {
      expect(v.pulledElsewhere).toBe(true)
      expect(v.scannedFromCode).toBe('MAIN-B-05-L3')
    }
  })

  it('stops holding the operator to the expected plate once they pulled elsewhere', () => {
    // The plate the detector picked is by definition not the one in their hands
    // now, so enforcing it would refuse every legitimate source override.
    const v = checkReplenScan(
      TASK,
      {
        fromLocationCode: 'MAIN-B-05-L3',
        toLocationCode: 'MAIN-B-04-L1',
        handlingUnitCode: 'HU-000999',
      },
      20,
    )
    expect(v.ok).toBe(true)
  })

  it('still refuses a wrong plate when they pulled from the assigned bin', () => {
    const v = checkReplenScan(
      TASK,
      {
        fromLocationCode: 'MAIN-B-04-L3',
        toLocationCode: 'MAIN-B-04-L1',
        handlingUnitCode: 'HU-000999',
      },
      20,
    )
    expect(v.ok).toBe(false)
    if (!v.ok) expect(v.code).toBe('WRONG_PLATE')
  })

  // ── The destination is not a choice ───────────────────────────────────────

  it('REFUSES a different destination', () => {
    const v = checkReplenScan(
      TASK,
      { fromLocationCode: 'MAIN-B-04-L3', toLocationCode: 'MAIN-B-09-L1' },
      20,
    )
    expect(v.ok).toBe(false)
    if (!v.ok) {
      expect(v.code).toBe('WRONG_DESTINATION')
      // The message has to name the slot that would be left short.
      expect(v.message).toContain('MAIN-B-04-L1')
    }
  })

  // ── Product and quantity ──────────────────────────────────────────────────

  it('refuses a wrong product', () => {
    const v = checkReplenScan(
      TASK,
      { fromLocationCode: 'MAIN-B-04-L3', toLocationCode: 'MAIN-B-04-L1', productCode: 'SOY-500' },
      20,
    )
    expect(v.ok).toBe(false)
    if (!v.ok) expect(v.code).toBe('WRONG_PRODUCT')
  })

  it('accepts the product by barcode as well as by sku', () => {
    const v = checkReplenScan(
      TASK,
      { fromLocationCode: 'MAIN-B-04-L3', toLocationCode: 'MAIN-B-04-L1', productCode: '93123456' },
      20,
    )
    expect(v.ok).toBe(true)
  })

  it('refuses a quantity above what is left on the task', () => {
    const v = checkReplenScan(TASK, { fromLocationCode: 'MAIN-B-04-L3' }, 21)
    expect(v.ok).toBe(false)
    if (!v.ok) expect(v.code).toBe('INVALID_QTY')
  })

  it('refuses a zero or negative quantity', () => {
    for (const q of [0, -1]) {
      const v = checkReplenScan(TASK, { fromLocationCode: 'MAIN-B-04-L3' }, q)
      expect(v.ok).toBe(false)
    }
  })

  it('allows a partial move', () => {
    const v = checkReplenScan(
      TASK,
      { fromLocationCode: 'MAIN-B-04-L3', toLocationCode: 'MAIN-B-04-L1' },
      5,
    )
    expect(v.ok).toBe(true)
  })

  // ── Evidence is optional at this layer; the UI is what makes it mandatory ──

  it('is unverified when nothing was scanned', () => {
    const v = checkReplenScan(TASK, {}, 20)
    expect(v.ok).toBe(true)
    if (v.ok) {
      expect(v.verified).toBe(false)
      expect(v.pulledElsewhere).toBe(false)
    }
  })

  it('needs both bins AND the thing to count as verified', () => {
    const bothBinsOnly = checkReplenScan(
      TASK,
      { fromLocationCode: 'MAIN-B-04-L3', toLocationCode: 'MAIN-B-04-L1' },
      20,
    )
    expect(bothBinsOnly.ok && bothBinsOnly.verified).toBe(false)

    const missingDestination = checkReplenScan(
      TASK,
      { fromLocationCode: 'MAIN-B-04-L3', handlingUnitCode: 'HU-000123' },
      20,
    )
    expect(missingDestination.ok && missingDestination.verified).toBe(false)
  })

  it('folds scan formatting the same way the shared normaliser does', () => {
    const v = checkReplenScan(
      TASK,
      { fromLocationCode: '  main-b-04-l3 ', toLocationCode: 'main-b-04-l1' },
      20,
    )
    expect(v.ok).toBe(true)
    if (v.ok) expect(v.pulledElsewhere).toBe(false)
  })

  it('ignores a plate scan on a task that names none', () => {
    const looseTask = { ...TASK, huCode: null }
    const v = checkReplenScan(
      looseTask,
      { fromLocationCode: 'MAIN-B-04-L3', toLocationCode: 'MAIN-B-04-L1', handlingUnitCode: 'HU-000777' },
      20,
    )
    expect(v.ok).toBe(true)
  })
})
