// The live map's visual tokens (NX-0047).
//
// PURE — no React, no DOM. Two kinds of value live here:
//
//   1. `var(--color-map-*)` references. SVG presentation attributes are parsed as
//      CSS, so `fill="var(--color-map-ink)"` resolves against index.css's `:root`
//      block. The canvas and the marker layers take every colour from here; a hex
//      literal in either file fails __tests__/warehouseMapPolish.test.ts.
//   2. The few values JS needs NUMERICALLY — the label inks, which the occupancy
//      ramp is contrast-tested against, and the ramp's own stops. Each has a CSS
//      twin in index.css and the same test asserts the two agree.
//
// Colours that are DATA (a storage form's colour, a level role's, a zone tint)
// are not tokens and do not belong here.

/** stone-900. Bin codes, level codes, sign text. Mirrors `--color-map-ink`. */
export const MAP_INK_HEX = '#1c1917'
/** stone-700. The second label line ("78% · 4L") and row meta. Mirrors
 *  `--color-map-ink-muted`. Not stone-600: that only reaches 4.5:1 on a fill with
 *  a luminance above 0.58, which would rule out every warm stop of the ramp. */
export const MAP_INK_MUTED_HEX = '#44403c'

export const MAP_COLOR = {
  ink: 'var(--color-map-ink)',
  inkMuted: 'var(--color-map-ink-muted)',
  /** Light ink for text on a dark marker. */
  inkInverse: 'var(--color-map-ink-inverse)',
  /** The stroke painted behind wayfinding text, and the plate behind a code. */
  halo: 'var(--color-map-halo)',
  grid: 'var(--color-map-grid)',
  /** Dims the floor behind an exploded rack. */
  scrim: 'var(--color-map-scrim)',
  selection: 'var(--color-map-selection)',
  /** The inner of the two selection rings. */
  selectionInner: 'var(--color-map-selection-inner)',
  rackShadow: 'var(--color-map-rack-shadow)',
  sheenLight: 'var(--color-map-sheen-light)',
  sheenShade: 'var(--color-map-sheen-shade)',
  /** Re-slotting moves. */
  slot: 'var(--color-map-slot)',
  slotInk: 'var(--color-map-slot-ink)',
  /** Dry-run pick route: the walked line and the numbered stops. */
  route: 'var(--color-map-route)',
  routeStop: 'var(--color-map-route-stop)',
  /** Dry-run putaway target and its alternatives. */
  target: 'var(--color-map-target)',
  /** Places holding a found product. */
  holding: 'var(--color-map-holding)',
} as const

/** DM Sans for names, JetBrains Mono for codes and numbers — the app's own
 *  faces, self-hosted from /fonts (index.css). JetBrains Mono ships weights
 *  400–500 only, so nothing set in it may ask for bold. */
export const MAP_FONT = {
  sans: 'var(--font-sans)',
  mono: 'var(--font-mono)',
} as const

/** `url(#…)` targets defined once in WarehouseCanvas's `<defs>`. */
export const MAP_RACK_SHADOW_ID = 'wh-rack-shadow'
export const MAP_SHEEN_ID = 'wh-rack-sheen'

/**
 * The occupancy ramp: cool and calm when there is room, warm as a bin fills.
 *
 * Lightness falls evenly (OKLab L 0.95 → 0.79) so equal steps in fullness read as
 * equal steps in colour, and it stops at a mid coral rather than a saturated red:
 * every stop has to carry BOTH label inks at 4.5:1 or better, because the ramp is
 * the surface the bin codes are printed on. Contrast vs ink / muted ink:
 *
 *   0%   #e6f2f0  15.3 / 9.0        80%  #f4ba82  10.2 / 6.0
 *   25%  #c2e5dc  12.9 / 7.6        100% #f4a091   8.6 / 5.0
 *   50%  #e5d78f  12.0 / 7.1
 */
export const OCCUPANCY_RAMP: readonly (readonly [number, string])[] = [
  [0, '#e6f2f0'],
  [0.25, '#c2e5dc'],
  [0.5, '#e5d78f'],
  [0.8, '#f4ba82'],
  [1, '#f4a091'],
]
