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
  // NX-0047: the fill is a continuous ramp now (mint → sand → apricot → coral),
  // so these pin the ramp's own stops and interpolated points between them.
  it('ramps mint → sand → apricot → coral across the fill range', () => {
    expect(occupancyFill(0.3)).toBe('#cae3ce')
    expect(occupancyFill(0.6)).toBe('#ebcd8b')
    expect(occupancyFill(0.9)).toBe('#f4ad8a')
    expect(occupancyFill(1)).toBe('#f4a091')
    expect(occupancyFill(1.5)).toBe('#f4a091') // over capacity clamps to the last stop
  })
  it('lands exactly on its stops at 0.5 and 0.8', () => {
    expect(occupancyFill(0.5)).toBe('#e5d78f')
    expect(occupancyFill(0.8)).toBe('#f4ba82')
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

// NX-0047 A9. The ramp sits UNDER the bin labels, so every colour it can return
// must carry both label inks. Contrast is computed, not eyeballed.
describe('occupancyColor', () => {
  const luminance = (hex: string) => {
    const [r, g, b] = [1, 3, 5].map((i) => {
      const c = parseInt(hex.slice(i, i + 2), 16) / 255
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
    })
    return 0.2126 * r + 0.7152 * g + 0.0722 * b
  }
  const contrast = (a: string, b: string) => {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
    return (hi + 0.05) / (lo + 0.05)
  }

  it('every stop keeps the label ink at 4.5:1', async () => {
    // The ramp as the map draws it. `occupancyFill` is the existing entry point;
    // `occupancyColor` is the same ramp without the "no capacity" case.
    const overlays: Record<string, unknown> = await import('../components/inventory/warehouse/warehouseOverlays')
    const ramp = (overlays.occupancyColor ?? occupancyFill) as (pct: number) => string
    // One source for the inks: the module the canvas draws its labels from.
    const tokens = await import('../components/inventory/warehouse/mapTokens').catch(() => null)
    expect(tokens, 'components/inventory/warehouse/mapTokens.ts is missing').not.toBeNull()

    const seen = new Set<string>()
    for (let step = 0; step <= 120; step++) {
      const pct = step / 100 // through 100% and on into over-capacity
      const colour = ramp(pct)
      expect(colour).toMatch(/^#[0-9a-f]{6}$/)
      expect(contrast(colour, tokens!.MAP_INK_HEX), `${pct} → ${colour} vs ink`).toBeGreaterThanOrEqual(4.5)
      expect(contrast(colour, tokens!.MAP_INK_MUTED_HEX), `${pct} → ${colour} vs muted ink`).toBeGreaterThanOrEqual(4.5)
      expect(colour).not.toBe(DEFAULT_BIN_FILL)
      seen.add(colour)
    }
    // A ramp, not five buckets: neighbouring fills are distinguishable steps.
    expect(seen.size).toBeGreaterThan(20)
    expect(typeof overlays.occupancyColor).toBe('function')
    // The map fill IS the ramp, so the two can never disagree.
    expect(occupancyFill(0.37)).toBe(ramp(0.37))
  })
})
