import { describe, it, expect } from 'vitest'

import { validateUoms, type UomInput } from '../supabase/functions/_shared/uomValidation'

function base(overrides: Partial<UomInput> = {}): UomInput {
  return { code: 'each', factor_to_base: 1, is_base: true, price: 5, ...overrides }
}
function pack(overrides: Partial<UomInput> = {}): UomInput {
  return { code: 'carton', factor_to_base: 12, is_base: false, price: 55, ...overrides }
}

describe('validateUoms', () => {
  it('accepts a valid base + carton list', () => {
    expect(validateUoms([base(), pack()])).toEqual({ ok: true })
  })

  it('rejects an empty list', () => {
    expect(validateUoms([])).toMatchObject({ ok: false })
  })

  it('accepts an omitted, null or zero per-UOM volume', () => {
    expect(validateUoms([base(), pack()])).toEqual({ ok: true })
    expect(validateUoms([base(), pack({ cubic_meters: null })])).toEqual({ ok: true })
    expect(validateUoms([base(), pack({ cubic_meters: 0 })])).toEqual({ ok: true })
    expect(validateUoms([base(), pack({ cubic_meters: 0.0195 })])).toEqual({ ok: true })
  })

  it('rejects a negative or non-finite per-UOM volume', () => {
    expect(validateUoms([base(), pack({ cubic_meters: -1 })])).toMatchObject({ ok: false })
    expect(validateUoms([base(), pack({ cubic_meters: NaN })])).toMatchObject({ ok: false })
  })

  it('rejects zero base rows', () => {
    const r = validateUoms([pack()])
    expect(r.ok).toBe(false)
  })

  it('rejects more than one base row', () => {
    const r = validateUoms([base(), base({ code: 'unit' })])
    expect(r.ok).toBe(false)
  })

  it('rejects a base with factor != 1', () => {
    const r = validateUoms([base({ factor_to_base: 6 }), pack()])
    expect(r.ok).toBe(false)
  })

  it('rejects duplicate codes case-insensitively', () => {
    const r = validateUoms([base(), pack({ code: 'Each' })])
    expect(r.ok).toBe(false)
  })

  it('rejects a blank code', () => {
    const r = validateUoms([base(), pack({ code: '   ' })])
    expect(r.ok).toBe(false)
  })

  it('rejects a fractional factor (R1: INT pack_size round-trip)', () => {
    const r = validateUoms([base(), pack({ factor_to_base: 1.5 })])
    expect(r.ok).toBe(false)
  })

  it('rejects a non-positive factor', () => {
    expect(validateUoms([base(), pack({ factor_to_base: 0 })]).ok).toBe(false)
  })

  it('rejects a negative price', () => {
    expect(validateUoms([base(), pack({ price: -1 })]).ok).toBe(false)
  })
})
