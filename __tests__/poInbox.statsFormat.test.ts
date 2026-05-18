import { describe, it, expect } from 'vitest'

import {
  describeCost,
  describeRatio,
  thresholdTone,
} from '../components/admin/poInboxStatsFormat'

describe('describeRatio', () => {
  it('renders the absolute and percentage together', () => {
    expect(describeRatio(0.5, 7)).toBe('7 · 50%')
  })

  it('rounds the percentage', () => {
    expect(describeRatio(1 / 3, 1)).toBe('1 · 33%')
    expect(describeRatio(2 / 3, 2)).toBe('2 · 67%')
  })

  it('handles 0 and 1 cleanly', () => {
    expect(describeRatio(0, 0)).toBe('0 · 0%')
    expect(describeRatio(1, 10)).toBe('10 · 100%')
  })

  it('clamps non-finite ratios to 0%', () => {
    expect(describeRatio(NaN, 0)).toBe('0 · 0%')
    expect(describeRatio(Infinity, 5)).toBe('5 · 0%')
  })
})

describe('describeCost', () => {
  it('returns em-dash for null', () => {
    expect(describeCost(null)).toBe('—')
  })

  it('uses 4-decimal precision for sub-cent values', () => {
    expect(describeCost(0.0001)).toBe('$0.0001')
    expect(describeCost(0.005)).toBe('$0.0050')
  })

  it('uses 3-decimal precision between $0.01 and $1', () => {
    expect(describeCost(0.0125)).toBe('$0.013')
    expect(describeCost(0.5)).toBe('$0.500')
  })

  it('uses 2-decimal precision for values ≥ $1', () => {
    expect(describeCost(1)).toBe('$1.00')
    expect(describeCost(12.345)).toBe('$12.35')
  })
})

describe('thresholdTone', () => {
  it('returns default when below the lower threshold', () => {
    expect(thresholdTone(0, [1, 5])).toBe('default')
  })

  it('returns amber between the thresholds', () => {
    expect(thresholdTone(1, [1, 5])).toBe('amber')
    expect(thresholdTone(4, [1, 5])).toBe('amber')
  })

  it('returns rose at or above the upper threshold', () => {
    expect(thresholdTone(5, [1, 5])).toBe('rose')
    expect(thresholdTone(100, [1, 5])).toBe('rose')
  })
})
