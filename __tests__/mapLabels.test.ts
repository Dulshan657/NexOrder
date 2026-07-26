import { describe, it, expect } from 'vitest'

import {
  labelTier,
  screenFont,
  fitCode,
  TIER_CODE_MIN_PX,
  TIER_FULL_MIN_PX,
} from '../components/inventory/warehouse/mapLabels'

describe('labelTier', () => {
  it('draws nothing when a cell is too small to hold readable text', () => {
    expect(labelTier(0)).toBe('none')
    expect(labelTier(TIER_CODE_MIN_PX - 0.01)).toBe('none')
  })

  it('shows the code from the code threshold up', () => {
    expect(labelTier(TIER_CODE_MIN_PX)).toBe('code')
    expect(labelTier(TIER_FULL_MIN_PX - 0.01)).toBe('code')
  })

  it('shows the full label from the full threshold up', () => {
    expect(labelTier(TIER_FULL_MIN_PX)).toBe('full')
    expect(labelTier(200)).toBe('full')
  })

  // The viewer's `cell` is a constant BASE_CELL (26) and zoom lives in the SVG
  // transform, so the tier MUST be derived from BASE_CELL * scale. These are the
  // real viewport limits from mapViewport.ts (MIN_SCALE 0.4, MAX_SCALE 3).
  it('maps the real viewport scale range onto sensible tiers at BASE_CELL', () => {
    const BASE_CELL = 26
    expect(labelTier(BASE_CELL * 0.4)).toBe('none') // 10.4px — illegible
    expect(labelTier(BASE_CELL * 1.0)).toBe('code') // 26px
    expect(labelTier(BASE_CELL * 3.0)).toBe('full') // 78px
  })

  it('treats non-finite input as unlabellable rather than throwing', () => {
    expect(labelTier(Number.NaN)).toBe('none')
    expect(labelTier(Number.POSITIVE_INFINITY)).toBe('none')
  })
})

describe('screenFont', () => {
  // The whole point: text sits inside a <g> scaled by `scale`, so dividing by
  // scale makes the rendered glyph a constant size on screen at every zoom.
  it('counter-scales so the on-screen size is constant', () => {
    expect(screenFont(9, 1)).toBe(9)
    expect(screenFont(9, 3) * 3).toBeCloseTo(9)
    expect(screenFont(9, 0.4) * 0.4).toBeCloseTo(9)
  })

  it('falls back to the base size for a degenerate scale', () => {
    expect(screenFont(9, 0)).toBe(9)
    expect(screenFont(9, -1)).toBe(9)
    expect(screenFont(9, Number.NaN)).toBe(9)
  })
})

describe('fitCode', () => {
  it('returns the code untouched when it fits', () => {
    expect(fitCode('A-01', 200, 9)).toBe('A-01')
  })

  it('returns empty when not even one character fits', () => {
    expect(fitCode('MAIN-B-4-2', 2, 9)).toBe('')
    expect(fitCode('MAIN-B-4-2', 0, 9)).toBe('')
  })

  // Warehouse codes are hierarchical and share a prefix (every bin in MAIN
  // starts "MAIN-"), so the DISCRIMINATING part is the tail. Truncating the head
  // and keeping the tail is what makes a 4-character label useful at all.
  it('keeps the tail, not the head, because codes share a prefix', () => {
    const out = fitCode('MAIN-B-4-2', 30, 9) // ~5 chars fit
    expect(out.startsWith('…')).toBe(true)
    expect(out.endsWith('4-2')).toBe(true)
    expect(out).not.toContain('MAIN')
  })

  it('never emits a label longer than the space allows', () => {
    for (const width of [10, 20, 40, 80, 160]) {
      const out = fitCode('MAIN-COLD-B-12-3', width, 9)
      expect(out.length * 9 * 0.6).toBeLessThanOrEqual(width + 1e-9)
    }
  })

  it('degrades to empty rather than a lone ellipsis', () => {
    // One character of room: an "…" alone conveys nothing, so prefer nothing.
    expect(fitCode('MAIN-B-4-2', 9 * 0.6 * 1.5, 9)).toBe('')
  })

  it('handles an empty code', () => {
    expect(fitCode('', 100, 9)).toBe('')
  })
})
