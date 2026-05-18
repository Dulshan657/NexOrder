import { describe, it, expect } from 'vitest'

import {
  computeCostUsd,
  MODEL_PRICING,
  promptHash,
} from '../supabase/functions/_shared/poInbox/openaiCost'

describe('computeCostUsd', () => {
  it('charges gpt-4o-mini at $0.15 input / $0.60 output per 1M tokens', () => {
    const cost = computeCostUsd('gpt-4o-mini', 1_000_000, 1_000_000)
    expect(cost).toBeCloseTo(0.75, 6)
  })

  it('charges gpt-4o at $2.50 input / $10.00 output per 1M tokens', () => {
    const cost = computeCostUsd('gpt-4o', 1_000_000, 1_000_000)
    expect(cost).toBeCloseTo(12.5, 6)
  })

  it('scales linearly with small token counts', () => {
    const cost = computeCostUsd('gpt-4o-mini', 1000, 500)
    // 1000 in @ 0.15/M + 500 out @ 0.60/M = 0.00015 + 0.0003 = 0.00045
    expect(cost).toBeCloseTo(0.00045, 6)
  })

  it('returns null for an unknown model name', () => {
    expect(computeCostUsd('o1-preview', 100, 100)).toBeNull()
  })

  it('returns null for non-finite or negative inputs (defensive)', () => {
    expect(computeCostUsd('gpt-4o', NaN, 0)).toBeNull()
    expect(computeCostUsd('gpt-4o', 0, Infinity)).toBeNull()
    expect(computeCostUsd('gpt-4o', -1, 0)).toBeNull()
    expect(computeCostUsd('gpt-4o', 0, -1)).toBeNull()
  })

  it('rounds to 6 decimal places', () => {
    // 1 token in @ 0.15/M = 1.5e-7;  1 token out @ 0.60/M = 6.0e-7
    // Sum 7.5e-7 = 0.00000075 → rounds to 6 decimals = 0.000001
    expect(computeCostUsd('gpt-4o-mini', 1, 1)).toBe(0.000001)

    // Sub-rounding value: 1 token in/out on gpt-4o-mini cost ~7.5e-7 which
    // rounds UP to 0.000001 (half-away-from-zero). Confirm boundary:
    expect(computeCostUsd('gpt-4o-mini', 0, 0)).toBe(0)
  })

  it('snapshot of MODEL_PRICING does not regress accidentally', () => {
    expect(MODEL_PRICING['gpt-4o-mini']).toEqual({ inputPer1M: 0.15, outputPer1M: 0.6 })
    expect(MODEL_PRICING['gpt-4o']).toEqual({ inputPer1M: 2.5, outputPer1M: 10 })
  })
})

describe('promptHash', () => {
  it('returns a 64-char hex digest for a non-empty string', async () => {
    const h = await promptHash('hello world')
    expect(h).toMatch(/^[0-9a-f]{64}$/)
  })

  it('is deterministic', async () => {
    const a = await promptHash('extract this purchase order')
    const b = await promptHash('extract this purchase order')
    expect(a).toBe(b)
  })

  it('returns empty string for empty input', async () => {
    expect(await promptHash('')).toBe('')
  })
})
