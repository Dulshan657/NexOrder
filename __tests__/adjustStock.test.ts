import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  computeAdjustPreview,
  validateAdjustInput,
  buildAdjustPayload,
  friendlyAdjustError,
  type AdjustStockFormInput,
} from '../lib/stockAdjustment'

// ---------------------------------------------------------------------------
// lib/stockAdjustment.ts — pure helpers (delta/set-count math, validation,
// payload building, friendly error mapping). No network, no rendering.
// ---------------------------------------------------------------------------

describe('computeAdjustPreview', () => {
  it('delta mode: adds the signed amount to current on-hand', () => {
    expect(computeAdjustPreview('delta', '5', 20)).toEqual({ delta: 5, newOnHand: 25 })
    expect(computeAdjustPreview('delta', '-3', 20)).toEqual({ delta: -3, newOnHand: 17 })
  })

  it('set_count mode: delta is the difference from current on-hand', () => {
    expect(computeAdjustPreview('set_count', '47', 50)).toEqual({ delta: -3, newOnHand: 47 })
    expect(computeAdjustPreview('set_count', '50', 50)).toEqual({ delta: 0, newOnHand: 50 })
  })

  it('returns null for empty or non-numeric input (not yet previewable)', () => {
    expect(computeAdjustPreview('delta', '', 20)).toBeNull()
    expect(computeAdjustPreview('delta', '   ', 20)).toBeNull()
    expect(computeAdjustPreview('delta', 'abc', 20)).toBeNull()
  })
})

describe('validateAdjustInput', () => {
  const base: AdjustStockFormInput = {
    productId: 1,
    locationId: 2,
    batchId: null,
    mode: 'delta',
    amountText: '5',
    reason: 'Damaged in transit',
    currentOnHand: 20,
  }

  it('passes for a valid delta adjustment', () => {
    expect(validateAdjustInput(base)).toBeNull()
  })

  it('requires a non-blank reason', () => {
    expect(validateAdjustInput({ ...base, reason: '' })).toMatch(/reason is required/i)
    expect(validateAdjustInput({ ...base, reason: '   ' })).toMatch(/reason is required/i)
  })

  it('requires a parseable, non-zero amount in delta mode', () => {
    expect(validateAdjustInput({ ...base, amountText: '' })).toMatch(/enter a quantity/i)
    expect(validateAdjustInput({ ...base, amountText: '0' })).toMatch(/non-zero quantity/i)
  })

  it('requires a parseable counted total in set_count mode, rejecting a no-op count', () => {
    expect(validateAdjustInput({ ...base, mode: 'set_count', amountText: '' })).toMatch(/enter the counted total/i)
    expect(validateAdjustInput({ ...base, mode: 'set_count', amountText: '20' })).toMatch(/nothing to adjust/i)
  })

  it('rejects a delta that would take on-hand below zero', () => {
    expect(validateAdjustInput({ ...base, amountText: '-100' })).toMatch(/below zero/i)
  })
})

describe('buildAdjustPayload', () => {
  it('builds a delta payload defaulting movementType to "adjustment"', () => {
    const payload = buildAdjustPayload({
      productId: 1,
      locationId: 2,
      batchId: null,
      mode: 'delta',
      amountText: '-3',
      reason: '  Damaged in transit  ',
      currentOnHand: 20,
    })
    expect(payload).toEqual({
      productId: 1,
      locationId: 2,
      batchId: null,
      mode: 'delta',
      qtyDelta: -3,
      reason: 'Damaged in transit',
      movementType: 'adjustment',
    })
  })

  it('honors an explicit movementType override in delta mode', () => {
    const payload = buildAdjustPayload({
      productId: 1,
      locationId: 2,
      batchId: 9,
      mode: 'delta',
      amountText: '4',
      reason: 'Found stock',
      currentOnHand: 10,
      movementType: 'stocktake_variance',
    })
    expect(payload.movementType).toBe('stocktake_variance')
    expect(payload.batchId).toBe(9)
  })

  it('builds a set_count payload with newCount and forces stocktake_variance', () => {
    const payload = buildAdjustPayload({
      productId: 1,
      locationId: 2,
      batchId: null,
      mode: 'set_count',
      amountText: '47',
      reason: 'Cycle count',
      currentOnHand: 50,
      // Even if a caller passed 'adjustment' here, set_count always forces
      // 'stocktake_variance' — the server does the same.
      movementType: 'adjustment',
    })
    expect(payload).toEqual({
      productId: 1,
      locationId: 2,
      batchId: null,
      mode: 'set_count',
      newCount: 47,
      reason: 'Cycle count',
      movementType: 'stocktake_variance',
    })
  })

  it('throws when called on input that would fail validation', () => {
    expect(() =>
      buildAdjustPayload({
        productId: 1,
        locationId: 2,
        batchId: null,
        mode: 'delta',
        amountText: '0',
        reason: 'x',
        currentOnHand: 20,
      }),
    ).toThrow(/non-zero quantity/i)
  })
})

describe('friendlyAdjustError', () => {
  it('maps ADJUSTMENT_BELOW_ALLOCATED to a user-facing explanation', () => {
    const msg = friendlyAdjustError('ADJUSTMENT_BELOW_ALLOCATED: adjusting product 1 at location 2 by -50 would take on_hand below allocated')
    expect(msg).toMatch(/already reserved for orders/i)
    expect(msg).not.toMatch(/ADJUSTMENT_BELOW_ALLOCATED/)
  })

  it('maps INVALID_ADJUSTMENT to a generic actionable message', () => {
    const msg = friendlyAdjustError('INVALID_ADJUSTMENT: a reason is required')
    expect(msg).toMatch(/invalid adjustment/i)
  })

  it('passes through unrecognized messages unchanged', () => {
    expect(friendlyAdjustError('network error')).toBe('network error')
  })
})

// ---------------------------------------------------------------------------
// services/supabase/adjustStockService.ts — payload shape sent to the
// adjust-stock Edge Function, success mapping, and error-message extraction
// (mirrors __tests__/orderService.placeOrder.test.ts's mocking pattern).
// ---------------------------------------------------------------------------

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }))
vi.mock('@/lib/supabase', () => ({
  supabase: { functions: { invoke } },
}))

import { adjustStock } from '../services/supabase/adjustStockService'

function httpError(status: number, body: unknown): Error {
  // Mirrors supabase-js's FunctionsHttpError: a generic message plus the raw
  // Response (carrying the structured `{ error: { code, message } }` body) on
  // `.context`.
  const err = new Error('Edge Function returned a non-2xx status code')
  ;(err as Error & { context: Response }).context = new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
  return err
}

describe('adjustStock service', () => {
  beforeEach(() => invoke.mockReset())

  it('sends the delta payload as-is to the adjust-stock function', async () => {
    invoke.mockResolvedValue({
      data: {
        ok: true,
        result: {
          product_id: 1,
          location_id: 2,
          batch_id: null,
          movement_type: 'adjustment',
          qty_delta: -3,
          before_on_hand: 20,
          before_allocated: 0,
          after_on_hand: 17,
          after_allocated: 0,
        },
      },
      error: null,
    })

    const payload = {
      productId: 1,
      locationId: 2,
      batchId: null,
      mode: 'delta' as const,
      qtyDelta: -3,
      reason: 'Damaged in transit',
      movementType: 'adjustment' as const,
    }
    const result = await adjustStock(payload)

    expect(invoke).toHaveBeenCalledWith('adjust-stock', { body: payload })
    expect(result).toEqual({
      productId: 1,
      locationId: 2,
      batchId: null,
      movementType: 'adjustment',
      qtyDelta: -3,
      beforeOnHand: 20,
      beforeAllocated: 0,
      afterOnHand: 17,
      afterAllocated: 0,
    })
  })

  it('sends the set_count payload as-is', async () => {
    invoke.mockResolvedValue({
      data: {
        ok: true,
        result: {
          product_id: 1,
          location_id: 2,
          batch_id: 9,
          movement_type: 'stocktake_variance',
          qty_delta: -3,
          before_on_hand: 50,
          before_allocated: 0,
          after_on_hand: 47,
          after_allocated: 0,
        },
      },
      error: null,
    })

    const payload = {
      productId: 1,
      locationId: 2,
      batchId: 9,
      mode: 'set_count' as const,
      newCount: 47,
      reason: 'Cycle count',
      movementType: 'stocktake_variance' as const,
    }
    await adjustStock(payload)

    expect(invoke).toHaveBeenCalledWith('adjust-stock', { body: payload })
  })

  it('surfaces the structured ADJUSTMENT_BELOW_ALLOCATED message, not the generic one', async () => {
    invoke.mockResolvedValue({
      data: null,
      error: httpError(409, {
        error: {
          code: 'CONFLICT',
          message: 'ADJUSTMENT_BELOW_ALLOCATED: adjusting product 1 at location 2 by -50 would take on_hand below allocated',
        },
      }),
    })
    await expect(
      adjustStock({ productId: 1, locationId: 2, mode: 'delta', qtyDelta: -50, reason: 'test' }),
    ).rejects.toThrow(/ADJUSTMENT_BELOW_ALLOCATED/)
  })

  it('does not leak the generic "non-2xx status code" message', async () => {
    invoke.mockResolvedValue({
      data: null,
      error: httpError(400, { error: { code: 'INVALID_INPUT', message: 'INVALID_ADJUSTMENT: a reason is required' } }),
    })
    await expect(
      adjustStock({ productId: 1, locationId: 2, mode: 'delta', qtyDelta: 1, reason: '' }),
    ).rejects.toThrow('INVALID_ADJUSTMENT: a reason is required')
  })
})
