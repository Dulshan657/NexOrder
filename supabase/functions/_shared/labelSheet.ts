// N-up label sheet geometry. Pure — no pdf-lib, no Deno, no I/O — so the same
// module the generate-labels Edge Function renders with is unit-tested by
// vitest in the frontend (same contract as _shared/wie/*).
//
// All coordinates are PDF points with the origin at the BOTTOM-LEFT, matching
// pdf-lib. Labels are laid out top-to-bottom, left-to-right, because that is the
// order a human reads a sheet of stickers while peeling them — getting this
// backwards means the codes come off the sheet in an order nobody expects.

/** A4 in PDF points (72dpi): 210mm x 297mm. */
export const A4_WIDTH = 595.28
export const A4_HEIGHT = 841.89

export const MM = 72 / 25.4

export interface LabelSheetSpec {
  /** Page size in points. */
  pageWidth: number
  pageHeight: number
  marginX: number
  marginY: number
  columns: number
  rows: number
  /** Space between adjacent cells. */
  gutterX: number
  gutterY: number
  /** Blank space inside each cell, so artwork never runs to the die-cut edge. */
  padding: number
}

export interface LabelCell {
  /** Index within the whole run, not within the page. */
  index: number
  /** Cell origin (bottom-left) in PDF points. */
  x: number
  y: number
  width: number
  height: number
  /** The drawable area inside the cell, after padding. */
  inner: { x: number; y: number; width: number; height: number }
}

export interface LabelPage {
  pageIndex: number
  cells: LabelCell[]
}

/**
 * Sheet presets. Sizes are chosen to land on common Avery-style A4 die-cuts;
 * `a4-24` (63.5 x 33.9mm) is the default because it is the cheapest widely
 * stocked sticker sheet and a bin label does not need to be bigger.
 *
 * `a4-8` exists for aisle/zone wayfinding signs, which are read from across a
 * warehouse rather than at arm's length.
 */
export const SHEET_PRESETS = {
  'a4-24': { columns: 3, rows: 8, marginX: 7 * MM, marginY: 13 * MM, gutterX: 2.5 * MM, gutterY: 0, padding: 4 },
  'a4-14': { columns: 2, rows: 7, marginX: 5 * MM, marginY: 15 * MM, gutterX: 2.5 * MM, gutterY: 0, padding: 6 },
  'a4-8':  { columns: 2, rows: 4, marginX: 5 * MM, marginY: 12 * MM, gutterX: 2.5 * MM, gutterY: 0, padding: 10 },
} as const

export type SheetPresetName = keyof typeof SHEET_PRESETS

export function sheetSpec(preset: SheetPresetName): LabelSheetSpec {
  const p = SHEET_PRESETS[preset]
  return { pageWidth: A4_WIDTH, pageHeight: A4_HEIGHT, ...p }
}

export function labelsPerPage(spec: LabelSheetSpec): number {
  return spec.columns * spec.rows
}

/**
 * Lay `count` labels out across as many pages as needed.
 *
 * `startOffset` skips that many cells on the FIRST page only — the practical
 * reason being a part-used sticker sheet. Reprinting six labels onto a sheet
 * that already has its first row peeled off is the difference between the
 * feature being usable and everyone printing full sheets and binning them.
 */
export function layoutLabels(count: number, spec: LabelSheetSpec, startOffset = 0): LabelPage[] {
  if (count <= 0) return []
  if (spec.columns <= 0 || spec.rows <= 0) {
    throw new Error('labelSheet: columns and rows must both be positive')
  }
  const perPage = labelsPerPage(spec)
  const offset = Math.max(0, Math.min(startOffset, perPage - 1))

  const cellWidth =
    (spec.pageWidth - 2 * spec.marginX - spec.gutterX * (spec.columns - 1)) / spec.columns
  const cellHeight =
    (spec.pageHeight - 2 * spec.marginY - spec.gutterY * (spec.rows - 1)) / spec.rows

  if (cellWidth <= 0 || cellHeight <= 0) {
    throw new Error('labelSheet: margins and gutters exceed the page size')
  }

  const pages: LabelPage[] = []
  let placed = 0
  let pageIndex = 0

  while (placed < count) {
    const cells: LabelCell[] = []
    // Only the first page honours the offset; later pages start at slot 0.
    const firstSlot = pageIndex === 0 ? offset : 0

    for (let slot = firstSlot; slot < perPage && placed < count; slot++) {
      const col = slot % spec.columns
      const row = Math.floor(slot / spec.columns)

      const x = spec.marginX + col * (cellWidth + spec.gutterX)
      // Row 0 is the TOP row, but PDF y grows upward — hence measuring down
      // from the top edge rather than up from the margin.
      const y = spec.pageHeight - spec.marginY - (row + 1) * cellHeight - row * spec.gutterY

      cells.push({
        index: placed,
        x,
        y,
        width: cellWidth,
        height: cellHeight,
        inner: {
          x: x + spec.padding,
          y: y + spec.padding,
          width: cellWidth - 2 * spec.padding,
          height: cellHeight - 2 * spec.padding,
        },
      })
      placed++
    }

    pages.push({ pageIndex, cells })
    pageIndex++
  }

  return pages
}

/**
 * Geometry for one label's contents: a square QR on top, the human-readable code
 * and context text centred beneath it.
 *
 * A QR-only label is unreadable the moment it is scuffed, wet or badly lit, and
 * an operator who cannot read the code cannot type it either — so the text is
 * not decoration, it is the fallback path. Which is exactly why the text used to
 * sit in a column beside the QR and no longer does: on the 24-up bin sheet that
 * column was 97.5pt, and a code in Courier-Bold at 15pt costs 9pt per character,
 * so it held 10.8 of them. MAIN's bin codes are 11-12 characters. Every sticker
 * printed `MAIN-O01-…`, and half a code is not a fallback.
 *
 * Stacked, the text gets the whole inner width — 172.5pt on that sheet, 77% more
 * — at the cost of a QR that shrinks from 24mm to 18mm, which is still a 0.72mm
 * module at 25 modules and far inside what a warehouse scanner reads.
 */
export interface LabelTextSlot {
  /** Horizontal centre of the text column; the caller measures and centres on it. */
  centerX: number
  /** Baseline. */
  y: number
  maxWidth: number
  /** Preferred size. The caller may shrink it to fit — see fitFontSize. */
  fontSize: number
  /** How far that shrinking may go before an ellipsis is the better answer. */
  minFontSize: number
}

export interface LabelArtwork {
  qr: { x: number; y: number; size: number }
  code: LabelTextSlot
  context: LabelTextSlot | null
}

/**
 * Floors for shrink-to-fit. The code's is higher because it is the line an
 * operator types when a QR will not scan — a code too small to read is no more
 * use than a truncated one, so past this point the ellipsis is honest. The
 * context is supplementary and can afford to go smaller before giving up.
 */
export const MIN_CODE_FONT_SIZE = 7
export const MIN_CONTEXT_FONT_SIZE = 5

export function labelArtwork(cell: LabelCell, opts?: { withContext?: boolean }): LabelArtwork {
  const { inner } = cell
  const withContext = opts?.withContext ?? true

  // Sizes scale with the label. The previous ceilings (15pt code, 8pt context)
  // were tuned for the smallest sheet and never revisited, so a 99x67mm aisle
  // sign meant to be read from across a warehouse printed its code no larger
  // than a bin sticker read at arm's length.
  const codeFontSize = clamp(inner.height * 0.17, MIN_CODE_FONT_SIZE, 36)
  const contextFontSize = withContext ? clamp(codeFontSize * 0.55, 5, 18) : 0

  // Height the text needs: each line plus the gap between them and room for
  // descenders below the last baseline.
  const textZone = withContext
    ? 1.22 * codeFontSize + 1.25 * contextFontSize
    : 1.25 * codeFontSize

  // The QR takes what is left, and the /1.16 reserves the rest as its quiet
  // zone. That divisor is load-bearing: qrcode's create() returns the bare
  // symbol with NO quiet zone (its `margin` option belongs to the renderers),
  // which the old layout got for free from the cell padding and the gutter to
  // the text beside it. With text directly underneath, it has to be deliberate.
  // 16% of the symbol is the standard 4 modules at 25 modules across.
  const available = Math.max(0, inner.height - textZone)
  const qrSize = Math.max(0, Math.min(inner.width, available / 1.16))

  const centerX = inner.x + inner.width / 2
  const qr = { x: centerX - qrSize / 2, y: inner.y + inner.height - qrSize, size: qrSize }

  // Baselines are measured up from the bottom of the inner box so the text
  // block sits on the floor of the cell and the slack lands in the quiet zone.
  const codeBaseline = withContext
    ? inner.y + 1.25 * contextFontSize + 0.22 * codeFontSize
    : inner.y + 0.25 * codeFontSize

  const code: LabelTextSlot = {
    centerX,
    y: codeBaseline,
    maxWidth: inner.width,
    fontSize: codeFontSize,
    minFontSize: Math.min(MIN_CODE_FONT_SIZE, codeFontSize),
  }

  const context: LabelTextSlot | null = withContext
    ? {
        centerX,
        y: inner.y + 0.25 * contextFontSize,
        maxWidth: inner.width,
        fontSize: contextFontSize,
        minFontSize: Math.min(MIN_CONTEXT_FONT_SIZE, contextFontSize),
      }
    : null

  return { qr, code, context }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/**
 * Largest size at or below `preferredSize` at which `text` fits `maxWidth`.
 *
 * Shrinking beats truncating: the printed code is what an operator types when a
 * QR will not scan, so a smaller whole code is worth more than a large partial
 * one. Glyph widths are linear in font size, so the answer is one measurement
 * and a division; the loop only guards against a font that reports otherwise.
 *
 * Returns `minSize` when even that overflows — hand the result to `fitText`,
 * which adds the ellipsis for that last case.
 */
export function fitFontSize(
  text: string,
  maxWidth: number,
  preferredSize: number,
  minSize: number,
  measure: (s: string, size: number) => number,
): number {
  if (!text || maxWidth <= 0) return minSize
  const atPreferred = measure(text, preferredSize)
  if (atPreferred <= maxWidth) return preferredSize
  if (atPreferred <= 0) return preferredSize

  let size = clamp((preferredSize * maxWidth) / atPreferred, minSize, preferredSize)
  while (size > minSize && measure(text, size) > maxWidth) {
    size = Math.max(minSize, size - 0.25)
  }
  return size
}

/**
 * Trim a string to fit `maxWidth` given a width-measuring function (pdf-lib's
 * `font.widthOfTextAtSize`). Injected rather than imported so this module stays
 * free of pdf-lib and testable with a trivial fake.
 */
export function fitText(
  text: string,
  maxWidth: number,
  fontSize: number,
  measure: (s: string, size: number) => number,
): string {
  if (!text) return ''
  if (measure(text, fontSize) <= maxWidth) return text
  let out = text
  while (out.length > 1 && measure(`${out}…`, fontSize) > maxWidth) {
    out = out.slice(0, -1)
  }
  return `${out}…`
}
