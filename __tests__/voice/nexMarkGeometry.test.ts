// The Nex mark's geometry, measured from the logo (public/assets/Nex-Order-no-bg-logo.png).
// What is pinned is what the owner signed off on in the preview: the logo's 60-degree
// construction, an even gap between the two Ns, an arrowhead centred on its shaft,
// the inward fold at the front N's foot, and no sharp corner anywhere.

import { describe, expect, it } from 'vitest'
import { NEX_MARK, NEX_MARK_COLOURS, contrastRatio, pointString } from '@/components/voice/nexMarkGeometry'
import type { Pt } from '@/components/voice/nexMarkGeometry'

const W = NEX_MARK.stroke

/** Angle of the segment a -> b from horizontal, folded into 0..90 degrees. */
function slopeDeg(a: Pt, b: Pt): number {
  const deg = (Math.atan2(Math.abs(b[1] - a[1]), Math.abs(b[0] - a[0])) * 180) / Math.PI
  return deg
}

/** Perpendicular distance from p to the infinite line through a and b. */
function distToLine(p: Pt, a: Pt, b: Pt): number {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  return Math.abs(dx * (a[1] - p[1]) - (a[0] - p[0]) * dy) / Math.hypot(dx, dy)
}

function inradius(t: readonly Pt[]): number {
  const [a, b, c] = t
  const la = Math.hypot(b[0] - c[0], b[1] - c[1])
  const lb = Math.hypot(a[0] - c[0], a[1] - c[1])
  const lc = Math.hypot(a[0] - b[0], a[1] - b[1])
  const area = Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1])) / 2
  return (2 * area) / (la + lb + lc)
}

describe('nexMarkGeometry', () => {
  it('runs every diagonal at 60 degrees', () => {
    const m = NEX_MARK
    const segments: Array<[Pt, Pt]> = [
      [m.backApex, m.backLeftEnd],
      [m.backApex, m.backRightEnd],
      [m.frontApex, m.legFoot],
      [m.frontApex, m.valley],
      [m.valley, m.arrow.base],
    ]
    for (const [a, b] of segments) expect(slopeDeg(a, b)).toBeCloseTo(60, 6)
  })

  it('keeps the gap between the two Ns equal on both sides', () => {
    const m = NEX_MARK
    const left = distToLine(m.frontApex, m.backApex, m.backLeftEnd)
    const right = distToLine(m.frontApex, m.backApex, m.backRightEnd)
    expect(left).toBeCloseTo(right, 6)
    // White between them, and not more than a stroke of it.
    expect(left - W).toBeGreaterThan(0)
    expect(left - W).toBeLessThanOrEqual(W)
  })

  it('centres the arrowhead on the shaft axis', () => {
    const { arrow, valley } = NEX_MARK
    expect(distToLine(arrow.tip, valley, arrow.base)).toBeLessThan(1e-6)
    const [c1, c2] = arrow.corners
    expect(distToLine(c1, valley, arrow.base)).toBeCloseTo(distToLine(c2, valley, arrow.base), 6)
    const length = Math.hypot(arrow.tip[0] - arrow.base[0], arrow.tip[1] - arrow.base[1])
    const width = Math.hypot(c1[0] - c2[0], c1[1] - c2[1])
    expect(length / W).toBeCloseTo(2.8, 1)
    expect(width / W).toBeCloseTo(3.4, 1)
  })

  it("curls the front N's foot inwards, clear of both legs", () => {
    const m = NEX_MARK
    // The curl ends inside the front N's arch: below the apex and between the legs...
    expect(m.curlEnd[1]).toBeGreaterThan(m.frontApex[1])
    expect(m.curlEnd[1]).toBeLessThan(m.legFoot[1])
    // ...with white between its rounded end and each leg.
    expect(distToLine(m.curlEnd, m.frontApex, m.legFoot)).toBeGreaterThan(W)
    expect(distToLine(m.curlEnd, m.frontApex, m.valley)).toBeGreaterThan(W)
    // It turns back on itself: the foot's arc sweeps well past a right angle.
    expect(m.footTurnDeg).toBeGreaterThan(150)
    expect(m.paths.front.startsWith(`M${pointString(m.curlEnd)}`)).toBe(true)
  })

  it('rounds the inside of the front peak and the valley', () => {
    const m = NEX_MARK
    expect(m.innerFillets).toHaveLength(2)
    const legs: Array<[Pt, Pt, Pt]> = [
      [m.frontApex, m.legFoot, m.valley],
      [m.valley, m.frontApex, m.arrow.base],
    ]
    m.innerFillets.forEach((fillet, i) => {
      const [vertex, a, b] = legs[i]
      expect(fillet.vertex).toEqual(vertex)
      expect(fillet.radius).toBeGreaterThan(0)
      // Tangent to the inner edge of both strokes: centre W/2 + r from each centreline.
      expect(distToLine(fillet.centre, vertex, a)).toBeCloseTo(W / 2 + fillet.radius, 6)
      expect(distToLine(fillet.centre, vertex, b)).toBeCloseTo(W / 2 + fillet.radius, 6)
      // The outer edge is unchanged: the stroke still turns on the vertex itself.
      expect(m.paths.front).toContain(`L${pointString(vertex)}`)
    })
  })

  it('has no sharp corner anywhere', () => {
    const m = NEX_MARK
    // The arrowhead is the same triangle with round corners: an inset copy stroked round.
    expect(m.arrow.round).toBeGreaterThan(0)
    expect(inradius(m.arrow.drawn) + m.arrow.round).toBeCloseTo(inradius([m.arrow.tip, ...m.arrow.corners]), 6)
    // The two square inside corners where the shaft meets the head are filled.
    expect(m.joinFillets).toHaveLength(2)
    for (const j of m.joinFillets) expect(j.radius).toBeGreaterThan(0)
    // The fold's arc is wider than half the stroke, so the sliver inside it ends in a curve.
    expect(m.footRadius).toBeGreaterThan(W / 2)
    expect(m.linecap).toBe('round')
    expect(m.linejoin).toBe('round')
  })

  it('keeps the ink at 3:1 or better against the disc', () => {
    for (const ink of NEX_MARK_COLOURS.ink) {
      for (const disc of NEX_MARK_COLOURS.disc) expect(contrastRatio(ink, disc)).toBeGreaterThanOrEqual(3)
    }
    expect(contrastRatio('#ffffff', '#000000')).toBeCloseTo(21, 6)
  })
})
