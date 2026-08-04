import { describe, it, expect } from 'vitest'

import {
  labelTier,
  screenFont,
  fitCode,
  fitName,
  commonCodePrefix,
  shortCode,
  coarseCode,
  MIN_LINE_PX,
  TIER_CODE_MIN_W_PX,
  TIER_FULL_MIN_H_PX,
  TIER_FULL_MIN_W_PX,
} from '../components/inventory/warehouse/mapLabels'
import { fitToBounds } from '../components/inventory/warehouse/mapViewport'

// MAIN's real scheme (layout 25): warehouse - face/aisle - position.
const MAIN_CODES = ['MAIN-F01-L01', 'MAIN-F01-L02', 'MAIN-F02-L01', 'MAIN-F12-L08']

describe('commonCodePrefix', () => {
  it('finds the shared warehouse root', () => {
    expect(commonCodePrefix(MAIN_CODES)).toBe('MAIN-')
  })

  it('only strips whole segments', () => {
    // LCP of these is "MAIN-F0", but cutting there would leave "1-L01",
    // which reads as a different bay.
    expect(commonCodePrefix(['MAIN-F01-L01', 'MAIN-F02-L01'])).toBe('MAIN-')
  })

  it('returns empty when there is no shared segment', () => {
    expect(commonCodePrefix(['A-1', 'B-1'])).toBe('')
  })

  it('returns empty for fewer than two codes — nothing is shared with itself', () => {
    expect(commonCodePrefix(['MAIN-F01-L01'])).toBe('')
    expect(commonCodePrefix([])).toBe('')
  })
})

describe('shortCode / coarseCode', () => {
  it('drops the shared root', () => {
    expect(shortCode('MAIN-F01-L01', 'MAIN-')).toBe('F01-L01')
  })

  it('leaves a code that does not carry the prefix alone', () => {
    expect(shortCode('WH2-A-1', 'MAIN-')).toBe('WH2-A-1')
  })

  it('never strips a code down to nothing', () => {
    expect(shortCode('MAIN-', 'MAIN-')).toBe('MAIN-')
  })

  // The zoomed-out label must be the AISLE. Every aisle on MAIN has an L01, so
  // the tail identifies nothing when the whole floor is in view.
  it('reduces to the aisle segment for the zoomed-out label', () => {
    expect(coarseCode('MAIN-F01-L01', 'MAIN-')).toBe('F01')
    expect(coarseCode('MAIN-F12-L08', 'MAIN-')).toBe('F12')
  })

  it('handles a code with no separator left', () => {
    expect(coarseCode('MAIN-A', 'MAIN-')).toBe('A')
  })
})

describe('labelTier', () => {
  it('draws nothing when the rect is too short for a line of text', () => {
    expect(labelTier(100, MIN_LINE_PX - 0.01)).toBe('none')
    expect(labelTier(100, 0)).toBe('none')
  })

  it('draws nothing when the rect is too narrow to be worth labelling', () => {
    expect(labelTier(TIER_CODE_MIN_W_PX - 0.01, 100)).toBe('none')
  })

  it('shows the code once both floors are met', () => {
    expect(labelTier(TIER_CODE_MIN_W_PX, MIN_LINE_PX)).toBe('code')
  })

  it('needs both height AND width before splitting onto two lines', () => {
    expect(labelTier(TIER_FULL_MIN_W_PX, TIER_FULL_MIN_H_PX)).toBe('full')
    expect(labelTier(TIER_FULL_MIN_W_PX, TIER_FULL_MIN_H_PX - 0.01)).toBe('code')
    expect(labelTier(TIER_FULL_MIN_W_PX - 0.01, TIER_FULL_MIN_H_PX)).toBe('code')
  })

  // REGRESSION. The first cut measured a single CELL, which shipped a map with
  // no labels: MAIN's perimeter walls span its whole 60x40 grid, so fit() lands
  // near scale 0.6 (~15.6 screen px per cell) — under any per-cell threshold.
  // Its bays are 2x1 though, so they have ~31px of width and can carry a label.
  // A per-cell rule cannot tell those two cases apart.
  it('labels MAIN’s 2x1 bays at the default fitted zoom', () => {
    const BASE_CELL = 26
    const scale = 0.6 // what fit() produces for MAIN's 60x40 content bounds
    const bay = (w: number, h: number): [number, number] =>
      [(w * BASE_CELL - 2) * scale, (h * BASE_CELL - 2) * scale]

    expect(labelTier(...bay(2, 1))).toBe('code') // 30.0 x 14.4 — MAIN's bays
    expect(labelTier(...bay(1, 1))).toBe('none') // 14.4 x 14.4 — genuinely too small
    expect(labelTier(...bay(4, 2))).toBe('full') // 61.2 x 30.0 — a big block
  })

  it('treats non-finite input as unlabellable rather than throwing', () => {
    expect(labelTier(Number.NaN, 50)).toBe('none')
    expect(labelTier(50, Number.POSITIVE_INFINITY)).toBe('none')
  })
})

// End-to-end calibration guard: MAIN's real geometry, through the real viewport
// math, into the real tier rule. The first cut of this feature shipped a map
// with no labels on it, and no unit test caught that because every test picked
// its own scale. This one derives the scale the app actually uses.
describe('MAIN at its default fitted zoom', () => {
  const BASE_CELL = 26
  const FIT_PADDING = 32 // useMapViewport.ts

  // Layout 25 ("Main DC"): 60x40 grid, and its perimeter WALLS span the whole
  // grid, so content bounds are the full 60x40 regardless of where bays sit.
  const MAIN_BOUNDS = { minX: 0, minY: 0, maxX: 60 * BASE_CELL, maxY: 40 * BASE_CELL }

  // A 65vh map (RackedWorkspace) on a few real window sizes.
  const CONTAINERS = [
    { name: 'laptop 1440x900', width: 1360, height: 585 },
    { name: 'desktop 1920x1080', width: 1800, height: 702 },
    { name: 'macbook 1512x982', width: 1440, height: 638 },
  ]

  for (const c of CONTAINERS) {
    it(`labels MAIN's 2x1 bays on ${c.name}`, () => {
      const vp = fitToBounds(MAIN_BOUNDS, { width: c.width, height: c.height }, FIT_PADDING)
      const bayW = (2 * BASE_CELL - 2) * vp.scale
      const bayH = (1 * BASE_CELL - 2) * vp.scale
      expect(labelTier(bayW, bayH)).not.toBe('none')

      // ...and the label it gets is the aisle, which fits in that width.
      const font = screenFont(9, vp.scale)
      const rectWUser = 2 * BASE_CELL - 2
      expect(fitCode(coarseCode('MAIN-F01-L01', 'MAIN-'), rectWUser - screenFont(4, vp.scale), font)).toBe('F01')
    })
  }
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

// ── fitName (mig 00094) ──────────────────────────────────────────────────────

describe('fitName', () => {
  it('keeps the HEAD, the opposite of fitCode', () => {
    // A name arriving here has already had its shared part removed (nameTail
    // drops the area), so what is left carries its information at the front:
    // "Rack 7" trimmed to "…7" throws away the word that says what 7 counts.
    expect(fitName('Rack 12', 200, 10)).toBe('Rack 12')
    const tight = fitName('Reserve level 3', 30, 10)
    expect(tight.startsWith('Rese')).toBe(true)
    expect(tight.endsWith('\u2026')).toBe(true)
  })

  it('returns nothing rather than a stub, so the caller can fall back to the code', () => {
    expect(fitName('Rack 12', 8, 10)).toBe('')
    expect(fitName('', 200, 10)).toBe('')
  })

  it('fits more characters than fitCode at the same width, being proportional', () => {
    expect(fitName('AAAAAAAAAA', 52, 10).length).toBeGreaterThan(fitCode('AAAAAAAAAA', 52, 10).length)
  })

  it('survives a degenerate viewport instead of emitting Infinity', () => {
    expect(fitName('Rack 1', Number.NaN, 10)).toBe('')
    expect(fitName('Rack 1', 100, 0)).toBe('')
  })
})
