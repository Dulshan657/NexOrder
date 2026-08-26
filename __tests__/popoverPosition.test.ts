/**
 * Where a trigger-anchored panel lands on a small screen.
 *
 * The defect this module exists for: the notification panel was
 * `absolute left-0 w-72 max-w-[calc(100vw-1.5rem)]`, hanging off a bell inside
 * the 208px sidebar. On a 360px handheld the panel started at x≈120 and ran to
 * x≈408 — 48px off the edge — while the `max-w` guard computed to 336px against
 * a 288px panel and so never engaged. A width cap is not a clamp; nothing was
 * constraining where the box STARTED.
 *
 * These are the cases that had to be true for the CipherLab RS35 (360×720 CSS,
 * ~664px visible in Chrome).
 */
import { describe, it, expect } from 'vitest'
import { placePopover, type TriggerRect } from '@/lib/popoverPosition'

/** The bell inside the sidebar header, as it actually sits on a 360px screen. */
const BELL: TriggerRect = { top: 20, bottom: 56, left: 120, right: 156 }

const RS35 = { viewportWidth: 360, viewportHeight: 664 }

describe('placePopover — horizontal clamping', () => {
  it('keeps a right-aligned panel fully on a 360px screen', () => {
    const p = placePopover({
      trigger: BELL,
      preferredWidth: 288,
      align: 'right',
      preferredMaxHeight: 440,
      ...RS35,
    })
    expect(p.left).toBeGreaterThanOrEqual(0)
    expect(p.left + p.width).toBeLessThanOrEqual(360)
  })

  it('is the regression guard for the reported bug: left-aligned would have overflowed', () => {
    // The old behaviour, expressed as the input that produced it.
    const naiveLeft = BELL.left
    const naiveRight = naiveLeft + 288
    expect(naiveRight).toBeGreaterThan(360) // 408 — this is what shipped

    const p = placePopover({ trigger: BELL, preferredWidth: 288, align: 'left', ...RS35 })
    expect(p.left + p.width).toBeLessThanOrEqual(360)
  })

  it('narrows a panel wider than the viewport rather than letting it overhang', () => {
    const p = placePopover({ trigger: BELL, preferredWidth: 420, ...RS35 })
    expect(p.width).toBe(360 - 16) // margin both sides
    expect(p.left).toBe(8)
  })

  it('leaves a desktop panel at its preferred edge — no clamping where none is needed', () => {
    const p = placePopover({
      trigger: { top: 20, bottom: 56, left: 1500, right: 1536 },
      preferredWidth: 288,
      align: 'right',
      viewportWidth: 1920,
      viewportHeight: 1080,
    })
    expect(p.left).toBe(1536 - 288)
    expect(p.width).toBe(288)
  })

  it('pins the LEFT edge on screen when the panel cannot fit at all', () => {
    // Losing the right edge is recoverable; losing the left hides where the
    // text starts.
    const p = placePopover({ trigger: BELL, preferredWidth: 288, viewportWidth: 100, viewportHeight: 664 })
    expect(p.left).toBe(8)
  })
})

describe('placePopover — vertical capping', () => {
  it('caps maxHeight to the space below, never returning Infinity', () => {
    const p = placePopover({
      trigger: BELL,
      preferredWidth: 288,
      preferredMaxHeight: 440,
      ...RS35,
    })
    expect(p.placement).toBe('below')
    // 440 fits under a bell whose bottom is 56 on a 664px screen.
    expect(p.maxHeight).toBe(440)
    expect(p.top + p.maxHeight).toBeLessThanOrEqual(664)
  })

  it('never lets the panel extend past the fold', () => {
    // A bell low on the screen — the case Tooltip still gets wrong.
    const low: TriggerRect = { top: 600, bottom: 636, left: 120, right: 156 }
    const p = placePopover({ trigger: low, preferredWidth: 288, preferredMaxHeight: 440, ...RS35 })
    if (p.placement === 'below') {
      expect(p.top + p.maxHeight).toBeLessThanOrEqual(664)
    } else {
      expect(p.top).toBeGreaterThanOrEqual(0)
    }
    expect(p.maxHeight).toBeGreaterThan(0)
  })

  it('flips above only when below is both too small AND worse', () => {
    const low: TriggerRect = { top: 600, bottom: 636, left: 120, right: 156 }
    const p = placePopover({ trigger: low, preferredWidth: 288, preferredMaxHeight: 440, ...RS35 })
    expect(p.placement).toBe('above')
    expect(p.top).toBeGreaterThanOrEqual(8)
  })

  it('does not flip merely because it could — a full panel near the top stays below', () => {
    const p = placePopover({ trigger: BELL, preferredWidth: 288, preferredMaxHeight: 440, ...RS35 })
    expect(p.placement).toBe('below')
  })

  it('an unconstrained panel still gets a finite, on-screen maxHeight', () => {
    const p = placePopover({ trigger: BELL, preferredWidth: 288, ...RS35 })
    expect(Number.isFinite(p.maxHeight)).toBe(true)
    expect(p.top + p.maxHeight).toBeLessThanOrEqual(664)
  })
})
