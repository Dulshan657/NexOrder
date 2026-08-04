// Level-of-detail rules for text drawn on the layout grid. Pure, no React —
// shared by the read-only viewer (WarehouseCanvas) and the editor (LayoutCanvas)
// so a bin is labelled the same way on both.
//
// WHY THIS EXISTS. The two canvases apply zoom differently: the designer scales
// its cell (`cell = BASE_CELL * zoom`) while the viewer keeps `cell = BASE_CELL`
// and scales the whole scene via an SVG `<g transform>`. The designer's guards
// (`cell >= 22`) were copied into the viewer, where `cell` is a constant 26 and
// they are therefore ALWAYS true — so the viewer had no level of detail at all,
// and its text rendered ~3.5 screen px at min zoom and 26px at max.
//
// The fix is to express both in the same currency: how many SCREEN pixels one
// grid cell currently covers.
//   viewer:   labelTier(BASE_CELL * viewport.scale)
//   designer: labelTier(BASE_CELL * zoom)          // == labelTier(cell)
// and to counter-scale font sizes with `screenFont` wherever the surrounding
// group is scaled, so a glyph is a fixed size on screen at every zoom.

/** How much text a placement has room for. */
export type LabelTier = 'none' | 'code' | 'full'

// Measured against the PLACEMENT's rect, not against one cell.
//
// Calibrating on a single cell was wrong and shipped a map with no labels on it:
// MAIN's perimeter walls span its whole 60x40 grid, so the default `fit()` lands
// around scale 0.55-0.61 — about 15 screen px per cell, under any sane per-cell
// threshold. But MAIN's bays are 2 cells WIDE, giving them ~31px of usable
// width, which is comfortably enough for a short code. A rule that cannot see
// the difference between a 1x1 bin and a 2x1 bay will always be wrong for one
// of them.

/** A line of 9px text needs about this much height to sit in a rect. */
export const MIN_LINE_PX = 9
/** Narrower than this and even an elided code is noise rather than a label. */
export const TIER_CODE_MIN_W_PX = 22
/** Two stacked lines (code + detail) need roughly this much height... */
export const TIER_FULL_MIN_H_PX = 20
/** ...and enough width to be worth splitting. */
export const TIER_FULL_MIN_W_PX = 30

/**
 * Approximate glyph advance as a fraction of font size, for the monospace face
 * the grid labels use. JetBrains Mono's advance is 0.6em; measuring properly
 * would need a canvas 2d context, which this module deliberately does not take
 * (it must stay pure and testable). Slightly over-estimating is the safe
 * direction — it truncates a little early rather than overflowing the cell.
 */
const MONO_ADVANCE = 0.6

/**
 * The same estimate for the PROPORTIONAL face that friendly names render in
 * (mig 00094). DM Sans averages a little under 0.52em across mixed-case text.
 *
 * It needs its own constant because a name is 2–4× the length of a code and
 * measuring it with the monospace advance over-estimates by ~15% — which sounds
 * conservative until you remember these labels sit inside a rect, where
 * over-estimating truncates a legible name that would have fitted.
 */
const SANS_ADVANCE = 0.52

/**
 * A placement's on-screen size → how much text it can carry.
 *
 * Both dimensions are in SCREEN px: `rect user units × viewport.scale` for the
 * viewer, or `rect × cell` for the designer (whose cell already is screen px).
 * Width still only gets a floor here — the exact horizontal fit is `fitCode`'s
 * job, and it returns '' when not even an elided code fits.
 */
export function labelTier(rectPxW: number, rectPxH: number): LabelTier {
  if (!Number.isFinite(rectPxW) || !Number.isFinite(rectPxH)) return 'none'
  if (rectPxH < MIN_LINE_PX || rectPxW < TIER_CODE_MIN_W_PX) return 'none'
  return rectPxH >= TIER_FULL_MIN_H_PX && rectPxW >= TIER_FULL_MIN_W_PX ? 'full' : 'code'
}

/**
 * Font size to hand an SVG `<text>` inside a `<g>` scaled by `scale`, so the
 * glyph renders at `basePx` on screen regardless of zoom.
 *
 * A degenerate scale (0, negative, NaN — none of which `clampScale` can produce,
 * but a caller could pass) falls back to the base size rather than dividing by
 * zero and emitting `fontSize="Infinity"`.
 */
export function screenFont(basePx: number, scale: number): number {
  if (!Number.isFinite(scale) || scale <= 0) return basePx
  return basePx / scale
}

/** Separator between segments of a hierarchical location code. */
const CODE_SEP = '-'

/**
 * The prefix every one of these codes shares, snapped to a segment boundary.
 *
 * Warehouse codes are hierarchical and rooted at the warehouse: MAIN's bays are
 * `MAIN-F01-L01`, `MAIN-F02-L03`, … so `MAIN-` is on every label and identifies
 * nothing. Stripping it is what makes a 4-character label carry 4 useful
 * characters. Returns '' for fewer than two codes (nothing is "shared" with
 * itself) and never returns the whole code.
 */
export function commonCodePrefix(codes: readonly string[]): string {
  if (codes.length < 2) return ''
  let prefix = codes[0]
  for (const code of codes) {
    let i = 0
    while (i < prefix.length && i < code.length && prefix[i] === code[i]) i++
    prefix = prefix.slice(0, i)
    if (!prefix) return ''
  }
  // Only strip whole segments — cutting "MAIN-F0" out of "MAIN-F01-L01" would
  // leave "1-L01", which reads as a different bay.
  const cut = prefix.lastIndexOf(CODE_SEP)
  return cut < 0 ? '' : prefix.slice(0, cut + 1)
}

/** `code` without the shared root, e.g. `MAIN-F01-L01` → `F01-L01`. */
export function shortCode(code: string, sharedPrefix: string): string {
  if (!sharedPrefix || !code.startsWith(sharedPrefix)) return code
  const rest = code.slice(sharedPrefix.length)
  return rest || code
}

/**
 * The coarsest useful locator: the first segment after the shared root.
 *
 * This is the zoomed-out label. `MAIN-F01-L01` → `F01` — the aisle, which is how
 * an operator navigates a 190-bay floor. The position within the aisle (`L01`)
 * is what you read once you are close, and it is identical across every aisle,
 * so it is precisely the wrong thing to show when the whole warehouse is in
 * view. Coarse-then-fine as you zoom is the same rule a road map uses.
 */
export function coarseCode(code: string, sharedPrefix: string): string {
  const short = shortCode(code, sharedPrefix)
  const cut = short.indexOf(CODE_SEP)
  return cut <= 0 ? short : short.slice(0, cut)
}

/**
 * Truncate a location code to the width available, KEEPING THE TAIL.
 *
 * Warehouse codes are hierarchical and share a prefix — every bin in MAIN is
 * `MAIN-…`, every cold bay `MAIN-COLD-…` — so the leading characters are the
 * ones that carry no information at a glance. When only a few characters fit,
 * "…4-2" identifies the bay while "MAIN" identifies nothing. This is why it does
 * not mirror the designer's old `code.slice(0, 6)`.
 *
 * Returns '' rather than a lone '…' when only one character fits: an ellipsis by
 * itself is visual noise that reads as a rendering fault.
 */
export function fitCode(code: string, widthPx: number, fontPx: number): string {
  if (!code) return ''
  if (!Number.isFinite(widthPx) || !Number.isFinite(fontPx) || fontPx <= 0) return ''
  const maxChars = Math.floor(widthPx / (fontPx * MONO_ADVANCE))
  if (maxChars <= 0) return ''
  if (code.length <= maxChars) return code
  if (maxChars < 2) return ''
  return `…${code.slice(-(maxChars - 1))}`
}

/**
 * Truncate a friendly NAME to the width available, KEEPING THE HEAD.
 *
 * The exact opposite of `fitCode`, and for the same underlying reason. Codes
 * share a prefix, so their information is in the tail. A name arriving here has
 * already had its shared part removed — `nameTail` drops the area, which the
 * canvas draws once across the whole region as its own wayfinding layer — so
 * what is left is "Rack 7" or "L4", where the information is at the FRONT.
 * Trimming that to "…7" would throw away the word that says what the number
 * counts.
 *
 * Returns '' rather than a lone '…', matching fitCode: a stub reads as a
 * rendering fault, and the caller's fallback (the code) is better than a stub.
 */
export function fitName(name: string, widthPx: number, fontPx: number): string {
  if (!name) return ''
  if (!Number.isFinite(widthPx) || !Number.isFinite(fontPx) || fontPx <= 0) return ''
  const maxChars = Math.floor(widthPx / (fontPx * SANS_ADVANCE))
  if (maxChars <= 0) return ''
  if (name.length <= maxChars) return name
  if (maxChars < 3) return ''
  return `${name.slice(0, maxChars - 1)}…`
}
