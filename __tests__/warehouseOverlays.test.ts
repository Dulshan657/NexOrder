import { describe, it, expect } from 'vitest'

import {
  occupancyFill,
  occupancyBucket,
  occupancyPill,
  velocityFill,
  congestionFill,
  DEFAULT_BIN_FILL,
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

describe('occupancyBucket boundaries', () => {
  it('none for null/undefined', () => {
    expect(occupancyBucket(null)).toBe('none')
    expect(occupancyBucket(undefined)).toBe('none')
  })
  it('empty at and below 0', () => {
    expect(occupancyBucket(0)).toBe('empty')
  })
  it('low for [0, 0.5)', () => {
    expect(occupancyBucket(0.49)).toBe('low')
  })
  it('mid starts at 0.5, runs to (0.8)', () => {
    expect(occupancyBucket(0.5)).toBe('mid')
    expect(occupancyBucket(0.79)).toBe('mid')
  })
  it('high starts at 0.8, runs to (1)', () => {
    expect(occupancyBucket(0.8)).toBe('high')
    expect(occupancyBucket(0.99)).toBe('high')
  })
  it('full at and above 1', () => {
    expect(occupancyBucket(1.0)).toBe('full')
    expect(occupancyBucket(1.5)).toBe('full')
  })
})

describe('occupancyPill', () => {
  it('maps buckets to tailwind classes matching the tree pill', () => {
    expect(occupancyPill(null)).toBe('bg-stone-100 text-stone-500')
    expect(occupancyPill(0)).toBe('bg-stone-100 text-stone-600')
    expect(occupancyPill(0.3)).toBe('bg-emerald-100 text-emerald-700')
    expect(occupancyPill(0.6)).toBe('bg-amber-100 text-amber-700')
    expect(occupancyPill(0.9)).toBe('bg-orange-100 text-orange-700')
    expect(occupancyPill(1)).toBe('bg-red-100 text-red-700')
  })
})

describe('DEFAULT_BIN_FILL vs occupancyFill', () => {
  it('is never byte-identical to ANY occupancy overlay colour (regression guard)', () => {
    // This used to check only occupancyFill(0.3) — the `low` bucket — while
    // asserting the literal '#e7e5e4', which is precisely occupancyFill(null).
    // So the guard passed while the invariant it names was violated: an
    // unresolvable bin and a "No capacity" bin rendered the same colour. Cover
    // every bucket boundary, so the next collision cannot slip through.
    for (const pct of [null, undefined, 0, 0.3, 0.6, 0.9, 1, 1.5]) {
      expect(DEFAULT_BIN_FILL).not.toBe(occupancyFill(pct))
    }
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
