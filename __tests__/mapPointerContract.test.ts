// Contracts in MapStage that are invisible until a phone is in your hand.
//
// Source assertions for the same reason mapSceneIsolation.test.ts uses them: each
// failure mode here is a future edit dropping one line, and none of them throws.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const src = readFileSync(
  resolve(process.cwd(), 'components/inventory/warehouse/MapStage.tsx'),
  'utf8',
)

describe('MapStage pointer contracts', () => {
  // useMapViewport.track must see EVERY pointer, including ones a stroke swallows
  // before reaching `handlers` — otherwise a pinch that starts under a live brush
  // has only one finger to measure and the gesture silently does nothing.
  it('tracks pointers in all four handlers', () => {
    for (const handler of ['onPointerDown', 'onPointerMove', 'onPointerUp', 'onPointerCancel']) {
      const at = src.indexOf(`${handler}={(e) => {`)
      expect(at, `${handler} is not an inline handler any more`).toBeGreaterThan(-1)
      const body = src.slice(at, at + 400)
      expect(body, `${handler} must call track(e) before anything else`).toMatch(/track\(e\)/)
    }
  })

  // THE reported bug. Without this the browser runs its own text selection across
  // the SVG's <text> nodes during a drag, and because native selection is a
  // document-order RANGE it smears a contiguous run of labels from the anchor to the
  // pointer — which reads as the brush selecting bins it never touched.
  it('suppresses native text selection over the map', () => {
    expect(src).toMatch(/className=\{`relative isolate h-full w-full select-none/)
    // The other half, on the capture-taking path only: `select-none` cannot stop a
    // range that was anchored outside the map from extending into it.
    expect(src).toMatch(/e\.preventDefault\(\)[\s\S]{0,400}?e\.currentTarget\.focus\(\{ preventScroll: true \}\)/)
  })

  // Required for one-finger gestures to survive at all: without it the browser owns
  // the drag and answers our pointerdown with a pointercancel mid-stroke.
  it('claims touch gestures unconditionally', () => {
    expect(src).toMatch(/style=\{\{ touchAction: 'none' \}\}/)
    expect(src).not.toMatch(/gesturesEnabled/)
  })

  // Right-drag erases, so the context menu would eat the gesture — but only while
  // sweeping. Everywhere else the operator keeps their browser.
  it('suppresses the context menu only while sweeping', () => {
    expect(src).toMatch(/onContextMenu=\{\(e\) => \{[\s\S]{0,240}?if \(sweeping\) e\.preventDefault\(\)/)
  })

  // The decision lives in the pure module, not in the handler.
  it('routes pointerdown through decidePointerDown', () => {
    expect(src).toMatch(/const decision = decidePointerDown\(\{/)
    expect(src).toMatch(/cellHasUnits: cell != null && select\?\.hasUnitsAt\(/)
  })
})
