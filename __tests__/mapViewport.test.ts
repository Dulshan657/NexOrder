import { describe, it, expect } from 'vitest'

import {
  MIN_SCALE,
  MAX_SCALE,
  FLOOR_MIN_SCALE,
  clampScale,
  zoomAtPoint,
  zoomByFactor,
  panBy,
  applyPinch,
  contentBounds,
  fitToBounds,
  interpolateViewport,
  easeOutCubic,
  clampViewport,
  scaleLimitsForFit,
  type Viewport,
} from '../components/inventory/warehouse/mapViewport'
import type { LayoutPlacement, LayoutObject } from '../types'

function worldPoint(vp: Viewport, cx: number, cy: number) {
  return { x: (cx - vp.tx) / vp.scale, y: (cy - vp.ty) / vp.scale }
}

describe('clampScale', () => {
  it('passes through values inside the range', () => {
    expect(clampScale(1)).toBe(1)
    expect(clampScale((MIN_SCALE + MAX_SCALE) / 2)).toBe((MIN_SCALE + MAX_SCALE) / 2)
  })
  it('clamps below MIN_SCALE', () => {
    expect(clampScale(0)).toBe(MIN_SCALE)
    expect(clampScale(-5)).toBe(MIN_SCALE)
  })
  it('clamps above MAX_SCALE', () => {
    expect(clampScale(10)).toBe(MAX_SCALE)
  })
  it('clamps exactly at the bounds unchanged', () => {
    expect(clampScale(MIN_SCALE)).toBe(MIN_SCALE)
    expect(clampScale(MAX_SCALE)).toBe(MAX_SCALE)
  })
  it('falls back to MIN_SCALE for non-finite input', () => {
    expect(clampScale(NaN)).toBe(MIN_SCALE)
    expect(clampScale(Infinity)).toBe(MIN_SCALE)
    expect(clampScale(-Infinity)).toBe(MIN_SCALE)
  })
})

describe('zoomAtPoint — cursor-anchored zoom invariant', () => {
  const viewports: Viewport[] = [
    { scale: 1, tx: 0, ty: 0 },
    { scale: 1.5, tx: 50, ty: -20 },
    { scale: 0.6, tx: -100, ty: 200 },
    { scale: 2.4, tx: 300, ty: 300 },
  ]
  const points: Array<[number, number]> = [
    [0, 0],
    [100, 50],
    [400, 250],
    [-30, 80],
  ]

  it('keeps the world coordinate under the cursor fixed when zooming in', () => {
    for (const vp of viewports) {
      for (const [cx, cy] of points) {
        const before = worldPoint(vp, cx, cy)
        const after = zoomAtPoint(vp, vp.scale * 1.1, cx, cy)
        const afterWorld = worldPoint(after, cx, cy)
        expect(afterWorld.x).toBeCloseTo(before.x, 9)
        expect(afterWorld.y).toBeCloseTo(before.y, 9)
      }
    }
  })

  it('keeps the world coordinate under the cursor fixed when zooming out', () => {
    for (const vp of viewports) {
      for (const [cx, cy] of points) {
        const before = worldPoint(vp, cx, cy)
        const after = zoomAtPoint(vp, vp.scale / 1.1, cx, cy)
        const afterWorld = worldPoint(after, cx, cy)
        expect(afterWorld.x).toBeCloseTo(before.x, 9)
        expect(afterWorld.y).toBeCloseTo(before.y, 9)
      }
    }
  })

  it('does not mutate the input viewport', () => {
    const vp: Viewport = { scale: 1, tx: 10, ty: 20 }
    const snapshot = { ...vp }
    zoomAtPoint(vp, 2, 100, 100)
    expect(vp).toEqual(snapshot)
  })

  it('produces an unchanged viewport when the target scale clamps to the current (already-at-limit) scale', () => {
    const atMax: Viewport = { scale: MAX_SCALE, tx: 42, ty: -7 }
    const stillMax = zoomAtPoint(atMax, MAX_SCALE * 5, 100, 100)
    expect(stillMax).toEqual(atMax)

    const atMin: Viewport = { scale: MIN_SCALE, tx: 12, ty: 8 }
    const stillMin = zoomAtPoint(atMin, MIN_SCALE / 5, 60, 60)
    expect(stillMin).toEqual(atMin)
  })

  it('clamps a requested scale beyond the limits while still anchoring the cursor', () => {
    const vp: Viewport = { scale: MAX_SCALE - 0.1, tx: 0, ty: 0 }
    const before = worldPoint(vp, 200, 150)
    const after = zoomAtPoint(vp, MAX_SCALE * 10, 200, 150)
    expect(after.scale).toBe(MAX_SCALE)
    const afterWorld = worldPoint(after, 200, 150)
    expect(afterWorld.x).toBeCloseTo(before.x, 9)
    expect(afterWorld.y).toBeCloseTo(before.y, 9)
  })
})

describe('zoomByFactor', () => {
  it('composes with clampScale — multiplies then clamps, anchored at the point', () => {
    const vp: Viewport = { scale: 1, tx: 0, ty: 0 }
    const before = worldPoint(vp, 50, 50)
    const after = zoomByFactor(vp, 1.1, 50, 50)
    expect(after.scale).toBeCloseTo(1.1, 9)
    const afterWorld = worldPoint(after, 50, 50)
    expect(afterWorld.x).toBeCloseTo(before.x, 9)
    expect(afterWorld.y).toBeCloseTo(before.y, 9)
  })

  it('shrinking factor zooms out', () => {
    const vp: Viewport = { scale: 2, tx: 0, ty: 0 }
    const after = zoomByFactor(vp, 1 / 1.1, 0, 0)
    expect(after.scale).toBeCloseTo(2 / 1.1, 9)
  })

  it('ignores a non-finite or non-positive factor (treated as 1x, no-op scale change)', () => {
    const vp: Viewport = { scale: 1.2, tx: 5, ty: 5 }
    expect(zoomByFactor(vp, NaN, 10, 10).scale).toBeCloseTo(1.2, 9)
    expect(zoomByFactor(vp, 0, 10, 10).scale).toBeCloseTo(1.2, 9)
    expect(zoomByFactor(vp, -3, 10, 10).scale).toBeCloseTo(1.2, 9)
  })
})

describe('panBy', () => {
  it('adds the delta to tx/ty and leaves scale untouched', () => {
    const vp: Viewport = { scale: 1.7, tx: 10, ty: -5 }
    const panned = panBy(vp, 15, -3)
    expect(panned).toEqual({ scale: 1.7, tx: 25, ty: -8 })
  })

  it('is additive across repeated calls', () => {
    let vp: Viewport = { scale: 1, tx: 0, ty: 0 }
    vp = panBy(vp, 5, 5)
    vp = panBy(vp, 5, 5)
    expect(vp).toEqual({ scale: 1, tx: 10, ty: 10 })
  })

  it('does not mutate the input viewport', () => {
    const vp: Viewport = { scale: 1, tx: 0, ty: 0 }
    const snapshot = { ...vp }
    panBy(vp, 10, 10)
    expect(vp).toEqual(snapshot)
  })
})

function placement(overrides: Partial<LayoutPlacement>): LayoutPlacement {
  return {
    id: 1,
    layoutId: 1,
    locationId: 1,
    floor: 0,
    x: 0,
    y: 0,
    w: 1,
    h: 1,
    rotation: 0,
    ...overrides,
  }
}

function object(overrides: Partial<LayoutObject>): LayoutObject {
  return {
    id: 1,
    layoutId: 1,
    objectType: 'wall',
    floor: 0,
    x: 0,
    y: 0,
    w: 1,
    h: 1,
    meta: {},
    ...overrides,
  }
}

describe('contentBounds', () => {
  it('returns null when the floor has no placements or objects', () => {
    expect(contentBounds([], [], 0, 32)).toBeNull()
    const onlyOtherFloor = [placement({ floor: 1, x: 0, y: 0, w: 2, h: 2 })]
    expect(contentBounds(onlyOtherFloor, [], 0, 32)).toBeNull()
  })

  it('filters by floor and combines placements + objects', () => {
    const placements = [
      placement({ id: 1, floor: 0, x: 2, y: 3, w: 2, h: 1 }),
      placement({ id: 2, floor: 1, x: 100, y: 100, w: 1, h: 1 }), // different floor, ignored
    ]
    const objects = [
      object({ id: 1, floor: 0, x: 0, y: 5, w: 1, h: 1 }),
      object({ id: 2, floor: 1, x: -50, y: -50, w: 1, h: 1 }), // different floor, ignored
    ]
    const bounds = contentBounds(placements, objects, 0, 10)
    expect(bounds).not.toBeNull()
    // min x is 0 (object x=0), max x is (2+2)*10=40 (placement); min y is 3*10=30
    // (placement y=3, lower than object's y=5), max y is (5+1)*10=60 (object)
    expect(bounds).toEqual({ minX: 0, minY: 30, maxX: 40, maxY: 60 })
  })

  it('multiplies raw grid coordinates by cell to produce pixel bounds', () => {
    const placements = [placement({ floor: 0, x: 1, y: 1, w: 3, h: 2 })]
    const bounds = contentBounds(placements, [], 0, 16)
    expect(bounds).toEqual({ minX: 16, minY: 16, maxX: 64, maxY: 48 })
  })
})

describe('fitToBounds', () => {
  it('frames known bounds within padding and centers them', () => {
    const bounds = { minX: 0, minY: 0, maxX: 100, maxY: 50 }
    const container = { width: 400, height: 300 }
    const vp = fitToBounds(bounds, container, 20)

    // scale = min((400-40)/100, (300-40)/50) = min(3.6, 5.2) = 3.6, clamped to MAX_SCALE
    const expectedScale = Math.min(MAX_SCALE, Math.min((400 - 40) / 100, (300 - 40) / 50))
    expect(vp.scale).toBeCloseTo(expectedScale, 9)

    // content center (50,25) should map to container center (200,150)
    expect(vp.tx + 50 * vp.scale).toBeCloseTo(200, 9)
    expect(vp.ty + 25 * vp.scale).toBeCloseTo(150, 9)
  })

  it('clamps scale for a very small bounds (would otherwise zoom in extremely far)', () => {
    const bounds = { minX: 0, minY: 0, maxX: 1, maxY: 1 }
    const container = { width: 1000, height: 1000 }
    const vp = fitToBounds(bounds, container, 10)
    expect(vp.scale).toBe(MAX_SCALE)
    expect(Number.isFinite(vp.tx)).toBe(true)
    expect(Number.isFinite(vp.ty)).toBe(true)
  })

  // NX-0047: the fit is clamped to FLOOR_MIN_SCALE, not MIN_SCALE. A floor that
  // only fits below 0.4 is shown whole; the old clamp left most of it off-screen.
  it('clamps scale for a very large bounds (would otherwise zoom out past FLOOR_MIN_SCALE)', () => {
    const bounds = { minX: 0, minY: 0, maxX: 100000, maxY: 100000 }
    const container = { width: 400, height: 300 }
    const vp = fitToBounds(bounds, container, 10)
    expect(vp.scale).toBe(FLOOR_MIN_SCALE)
    expect(vp.scale).toBeLessThan(MIN_SCALE)
  })

  it('handles a zero-area bounds (a single point) without dividing by zero', () => {
    const bounds = { minX: 50, minY: 50, maxX: 50, maxY: 50 }
    const container = { width: 400, height: 300 }
    const vp = fitToBounds(bounds, container)
    expect(Number.isFinite(vp.scale)).toBe(true)
    expect(Number.isFinite(vp.tx)).toBe(true)
    expect(Number.isFinite(vp.ty)).toBe(true)
    expect(vp.scale).toBe(MAX_SCALE)
    // the point should still land at the container center
    expect(vp.tx + 50 * vp.scale).toBeCloseTo(200, 9)
    expect(vp.ty + 50 * vp.scale).toBeCloseTo(150, 9)
  })

  it('returns an identity, finite viewport for a zero/negative container size', () => {
    const bounds = { minX: 0, minY: 0, maxX: 100, maxY: 100 }
    expect(fitToBounds(bounds, { width: 0, height: 300 })).toEqual({ scale: 1, tx: 0, ty: 0 })
    expect(fitToBounds(bounds, { width: 400, height: 0 })).toEqual({ scale: 1, tx: 0, ty: 0 })
    expect(fitToBounds(bounds, { width: -10, height: -10 })).toEqual({ scale: 1, tx: 0, ty: 0 })
  })

  it('never returns NaN even with negative padding larger than the container', () => {
    const bounds = { minX: 0, minY: 0, maxX: 10, maxY: 10 }
    const vp = fitToBounds(bounds, { width: 20, height: 20 }, 1000)
    expect(Number.isFinite(vp.scale)).toBe(true)
    expect(Number.isFinite(vp.tx)).toBe(true)
    expect(Number.isFinite(vp.ty)).toBe(true)
  })
})

describe('applyPinch', () => {
  const vp: Viewport = { scale: 1, tx: 30, ty: -12 }

  it('keeps the world point under the midpoint fixed when the fingers only spread', () => {
    const before = worldPoint(vp, 200, 140)
    const after = applyPinch(vp, { targetScale: 1.8, midX: 200, midY: 140, dMidX: 0, dMidY: 0 })
    const nowAt = worldPoint(after, 200, 140)
    expect(after.scale).toBeCloseTo(1.8)
    expect(nowAt.x).toBeCloseTo(before.x)
    expect(nowAt.y).toBeCloseTo(before.y)
  })

  it('follows the midpoint, so a pinch that slides also pans', () => {
    const after = applyPinch(vp, { targetScale: 1, midX: 100, midY: 100, dMidX: 25, dMidY: -8 })
    expect(after.scale).toBe(1)
    expect(after.tx).toBeCloseTo(vp.tx + 25)
    expect(after.ty).toBeCloseTo(vp.ty - 8)
  })

  it('clamps the scale at both limits', () => {
    expect(applyPinch(vp, { targetScale: 99, midX: 10, midY: 10, dMidX: 0, dMidY: 0 }).scale)
      .toBe(MAX_SCALE)
    expect(applyPinch(vp, { targetScale: 0.001, midX: 10, midY: 10, dMidX: 0, dMidY: 0 }).scale)
      .toBe(MIN_SCALE)
  })

  // Why applyPinch pans AFTER zooming rather than before: zoomAtPoint returns the
  // viewport UNCHANGED once the scale has clamped, so a pan folded into the zoom
  // would be swallowed and a two-finger drag would go dead at the limits — with the
  // fingers still moving, which reads as the map having frozen.
  it('keeps panning once the zoom has clamped', () => {
    const atLimit: Viewport = { scale: MAX_SCALE, tx: 0, ty: 0 }
    const after = applyPinch(atLimit, { targetScale: MAX_SCALE * 4, midX: 50, midY: 50, dMidX: 12, dMidY: 9 })
    expect(after.scale).toBe(MAX_SCALE)
    expect(after.tx).toBeCloseTo(12)
    expect(after.ty).toBeCloseTo(9)
  })

  it('does not mutate its input', () => {
    const input: Viewport = { scale: 1, tx: 5, ty: 5 }
    applyPinch(input, { targetScale: 2, midX: 1, midY: 1, dMidX: 3, dMidY: 3 })
    expect(input).toEqual({ scale: 1, tx: 5, ty: 5 })
  })

  it('produces no NaN from a degenerate step', () => {
    const after = applyPinch(vp, { targetScale: 1, midX: 0, midY: 0, dMidX: 0, dMidY: 0 })
    expect(Number.isFinite(after.scale)).toBe(true)
    expect(Number.isFinite(after.tx)).toBe(true)
    expect(Number.isFinite(after.ty)).toBe(true)
  })
})

// ── NX-0047 ──────────────────────────────────────────────────────────────────

describe('interpolateViewport', () => {
  it('interpolates zoom in log space and eases out', () => {
    const from: Viewport = { scale: 1, tx: 0, ty: 0 }
    const to: Viewport = { scale: 4, tx: 100, ty: 50 }
    expect(interpolateViewport(from, to, 0)).toEqual(from)
    expect(interpolateViewport(from, to, 1)).toEqual(to)

    const half = interpolateViewport(from, to, 0.5)
    // Log space: equal time is an equal zoom RATIO, so the geometric midpoint (2)
    // rather than the arithmetic one (2.5); eased out, so already past it at 0.5.
    expect(half.scale).toBeCloseTo(4 ** easeOutCubic(0.5), 9)
    expect(half.scale).toBeGreaterThan(2)
    expect(easeOutCubic(0)).toBe(0)
    expect(easeOutCubic(1)).toBe(1)

    // Anchored (a button zoom about the centre): the world point under the anchor
    // stays put on every frame, so the map grows from where you are looking.
    const anchorFrom: Viewport = { scale: 1, tx: 10, ty: 20 }
    const anchorTo = zoomAtPoint(anchorFrom, 3, 200, 150)
    const before = worldPoint(anchorFrom, 200, 150)
    for (const t of [0.1, 0.4, 0.7]) {
      const mid = interpolateViewport(anchorFrom, anchorTo, t, { x: 200, y: 150 })
      expect(worldPoint(mid, 200, 150).x).toBeCloseTo(before.x, 9)
      expect(worldPoint(mid, 200, 150).y).toBeCloseTo(before.y, 9)
    }
  })
})

describe('clampViewport', () => {
  it('lets a floor larger than the screen zoom out past its fit', () => {
    // A 1800 x 900 px floor on a 360 px handheld fits at 0.2, under the old fixed
    // 0.4 minimum, which left most of the warehouse permanently off-screen.
    const fitted = fitToBounds({ minX: 0, minY: 0, maxX: 1800, maxY: 900 }, { width: 360, height: 600 }, 0)
    expect(fitted.scale).toBeCloseTo(0.2, 9)

    const limits = scaleLimitsForFit(fitted.scale)
    expect(limits.min).toBeLessThan(fitted.scale)
    expect(limits.max).toBe(MAX_SCALE)

    const out = zoomByFactor(fitted, 0.8, 180, 300, limits)
    expect(out.scale).toBeCloseTo(0.16, 9)
    expect(clampViewport(out, limits, 180, 300)).toBe(out)

    // ...but not without end.
    expect(clampViewport({ ...fitted, scale: 0.01 }, limits, 180, 300).scale).toBe(limits.min)
    // A small floor keeps the old minimum: no reason to shrink it to a dot.
    expect(scaleLimitsForFit(1.5).min).toBe(MIN_SCALE)
  })
})
