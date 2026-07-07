import { describe, it, expect } from 'vitest'

import {
  occupancyFill,
  velocityFill,
  congestionFill,
} from '../components/inventory/warehouse/warehouseOverlays'

describe('occupancyFill buckets', () => {
  it('neutral when capacity is unknown (null)', () => {
    expect(occupancyFill(null)).toBe('#e7e5e4')
    expect(occupancyFill(undefined)).toBe('#e7e5e4')
  })
  it('white when empty', () => {
    expect(occupancyFill(0)).toBe('#ffffff')
  })
  it('ramps emerald → amber → orange → red across the fill range', () => {
    expect(occupancyFill(0.3)).toBe('#6ee7b7')
    expect(occupancyFill(0.6)).toBe('#fcd34d')
    expect(occupancyFill(0.9)).toBe('#fb923c')
    expect(occupancyFill(1)).toBe('#ef4444')
    expect(occupancyFill(1.5)).toBe('#ef4444') // over capacity clamps to red
  })
  it('respects bucket boundaries (0.5 and 0.8 belong to the higher band)', () => {
    expect(occupancyFill(0.5)).toBe('#fcd34d')
    expect(occupancyFill(0.8)).toBe('#fb923c')
  })
})

describe('velocityFill', () => {
  it('colors A/B/C distinctly and neutral when unclassified', () => {
    expect(velocityFill('A')).toBe('#f43f5e')
    expect(velocityFill('B')).toBe('#fbbf24')
    expect(velocityFill('C')).toBe('#7dd3fc')
    expect(velocityFill(null)).toBe('#e7e5e4')
  })
})

describe('congestionFill quintiles', () => {
  it('returns null for no traffic (bin keeps base fill)', () => {
    expect(congestionFill(0, 10)).toBeNull()
    expect(congestionFill(5, 0)).toBeNull()
  })
  it('maps visit ratio into 5 buckets low → high', () => {
    expect(congestionFill(2, 10)).toBe('#bae6fd') // 0.2 → q1
    expect(congestionFill(4, 10)).toBe('#7dd3fc') // 0.4 → q2
    expect(congestionFill(6, 10)).toBe('#fbbf24') // 0.6 → q3
    expect(congestionFill(8, 10)).toBe('#fb923c') // 0.8 → q4
    expect(congestionFill(10, 10)).toBe('#ef4444') // 1.0 → q5
  })
})
