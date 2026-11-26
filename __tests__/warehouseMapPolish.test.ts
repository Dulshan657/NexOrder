// NX-0047 — the visual half of "the 2D map feels premium".
//
// Source assertions, for the same reason mapSceneIsolation.test.ts uses them:
// each failure mode here is a future edit quietly re-typing a hex colour, a
// generic font or a 10px legend, and none of those throws. What can be asserted
// on the DOM is asserted there instead (warehouseCanvasLabels.test.tsx).

import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/** A missing file reads as empty, so a test fails on its assertion (naming what
 *  is missing) rather than on an ENOENT. */
const read = (rel: string) => {
  const path = resolve(process.cwd(), rel)
  return existsSync(path) ? readFileSync(path, 'utf8') : ''
}
const DIR = 'components/inventory/warehouse'

/** A hex colour sitting in a colour position: a quoted string literal. Comments
 *  ("#62", "mig 00094") and `url(#id)` references are deliberately not matched. */
const HEX_LITERAL = /['"`]#[0-9a-fA-F]{3,8}['"`]/g
const GENERIC_FONT = /fontFamily\s*[=:]\s*\{?\s*['"`](sans-serif|monospace|serif)['"`]/

describe('warehouse map polish', () => {
  it('the canvas and markers use tokens and the app fonts', () => {
    for (const file of ['WarehouseCanvas.tsx', 'warehouseMarkers.tsx']) {
      const src = read(`${DIR}/${file}`)
      expect(src.match(HEX_LITERAL) ?? [], `${file} hard-codes a hex colour`).toEqual([])
      expect(src, `${file} hard-codes rgba()`).not.toMatch(/['"`]rgba?\(/)
      expect(src, `${file} uses a generic font family`).not.toMatch(GENERIC_FONT)
      expect(src, `${file} does not import the map tokens`).toMatch(/from '\.\/mapTokens'/)
    }
    // The token module is where the var() references live, and both app fonts.
    const tokens = read(`${DIR}/mapTokens.ts`)
    expect(tokens).toMatch(/var\(--color-map-ink\)/)
    expect(tokens).toMatch(/var\(--font-mono\)/)
    expect(tokens).toMatch(/var\(--font-sans\)/)

    // One source of truth: every custom property the module names is defined in
    // index.css, and the two values JS needs numerically match their CSS twins.
    const css = read('index.css')
    const named = new Set(Array.from(tokens.matchAll(/var\((--color-map-[a-z-]+)\)/g), (m) => m[1]))
    expect(named.size).toBeGreaterThan(6)
    for (const name of named) expect(css, `${name} is not defined in index.css`).toContain(`${name}:`)
    for (const [prop, constant] of [['--color-map-ink', 'MAP_INK_HEX'], ['--color-map-ink-muted', 'MAP_INK_MUTED_HEX']]) {
      const hex = new RegExp(`${constant} = '(#[0-9a-f]{6})'`).exec(tokens)?.[1]
      expect(hex, `${constant} missing`).toBeTruthy()
      expect(css).toContain(`${prop}: ${hex};`)
    }
  })

  it('the legend sits on the map as a map control', () => {
    const stage = read(`${DIR}/MapStage.tsx`)
    const legend = read(`${DIR}/MapLegend.tsx`)
    expect(stage).toMatch(/<MapLegend\b/)
    expect(legend).toMatch(/data-map-control/)
    expect(legend).toMatch(/map-panel\b/)
    // Occupancy reads as one continuous bar, not six swatches — and the bar is
    // built from the ramp's own stops, so it cannot drift from the map.
    expect(legend).toMatch(/backgroundImage: OCCUPANCY_GRADIENT_CSS/)
    expect(read(`${DIR}/warehouseOverlays.ts`)).toMatch(/OCCUPANCY_GRADIENT_CSS =\s*`linear-gradient\(/)
    // 12px floor: no arbitrary sub-12 sizes anywhere in the legend.
    expect(legend).not.toMatch(/text-\[(?:[0-9]|1[01])px\]/)
    expect(read(`${DIR}/OverlayControls.tsx`)).not.toMatch(/text-\[10px\]/)
  })

  it('the hover card is placed by popoverPosition and shows the friendly name', () => {
    const stage = read(`${DIR}/MapStage.tsx`)
    const card = read(`${DIR}/BinHoverCard.tsx`)
    expect(stage).toMatch(/<BinHoverCard\b/)
    expect(card).toMatch(/import \{[^}]*\bplacePopover\b[^}]*\} from '@\/lib\/popoverPosition'/)
    expect(card).toMatch(/import \{[^}]*\blocationTitle\b[^}]*\} from '@\/lib\/locationDisplay'/)
    expect(card).toMatch(/placePopover\(/)
    expect(card).toMatch(/locationTitle\(/)
    expect(card).toMatch(/locationSubtitle\(/)
    // The old placement: a fixed translate above the cell, which clipped on row 0.
    expect(stage + card).not.toMatch(/-translate-y-full/)
  })

  it('the controls are touch-sized with key-hint tooltips', () => {
    const src = read(`${DIR}/MapControls.tsx`)
    expect(src).toMatch(/from '@\/components\/ui\/Tooltip'/)
    // 36px at rest, 44px under a coarse pointer.
    expect(src).toMatch(/\bh-9 w-9\b/)
    expect(src).toMatch(/pointer-coarse:h-11 pointer-coarse:w-11/)
    expect(src).toMatch(/tabular-nums/)
    for (const hint of ['Zoom in (+)', 'Zoom out (−)', 'Fit to view (0)']) expect(src).toContain(hint)
    // The names the e2e walk and screen readers rely on are untouched.
    for (const name of ['Zoom in', 'Zoom out', 'Fit to view']) expect(src).toContain(`aria-label="${name}"`)
    expect(src).toMatch(/data-map-control/)
  })
})
