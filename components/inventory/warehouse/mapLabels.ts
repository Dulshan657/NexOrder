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

/** How much text a cell has room for. */
export type LabelTier = 'none' | 'code' | 'full'

/** Below this many screen px per cell, any text is unreadable — draw none. */
export const TIER_CODE_MIN_PX = 18
/** From this many screen px per cell, there is room for a second line. */
export const TIER_FULL_MIN_PX = 34

/**
 * Approximate glyph advance as a fraction of font size, for the monospace face
 * the grid labels use. JetBrains Mono's advance is 0.6em; measuring properly
 * would need a canvas 2d context, which this module deliberately does not take
 * (it must stay pure and testable). Slightly over-estimating is the safe
 * direction — it truncates a little early rather than overflowing the cell.
 */
const MONO_ADVANCE = 0.6

/** Screen px one grid cell covers → how much text it can carry. */
export function labelTier(cellPx: number): LabelTier {
  if (!Number.isFinite(cellPx) || cellPx < TIER_CODE_MIN_PX) return 'none'
  return cellPx >= TIER_FULL_MIN_PX ? 'full' : 'code'
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
