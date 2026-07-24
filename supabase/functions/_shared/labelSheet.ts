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
 * Geometry for one label's contents: a square QR on the left, the human-readable
 * code and context text to its right.
 *
 * A QR-only label is unreadable the moment it is scuffed, wet or badly lit, and
 * an operator who cannot read the code cannot type it either — so the text is
 * not decoration, it is the fallback path.
 */
export interface LabelArtwork {
  qr: { x: number; y: number; size: number }
  code: { x: number; y: number; maxWidth: number; fontSize: number }
  context: { x: number; y: number; maxWidth: number; fontSize: number } | null
}

export function labelArtwork(cell: LabelCell, opts?: { withContext?: boolean }): LabelArtwork {
  const { inner } = cell
  const withContext = opts?.withContext ?? true

  // The QR is square and as tall as the cell allows, capped so it never eats
  // more than 40% of the width on a wide label.
  const qrSize = Math.min(inner.height, inner.width * 0.4)
  const qr = { x: inner.x, y: inner.y + (inner.height - qrSize) / 2, size: qrSize }

  const textX = inner.x + qrSize + 6
  const textWidth = Math.max(0, inner.x + inner.width - textX)

  // Code size scales with the space left over, floored so it stays legible and
  // ceilinged so a short code on a big label doesn't look like a ransom note.
  const codeFontSize = clamp(inner.height * 0.34, 6, 15)
  const contextFontSize = clamp(codeFontSize * 0.62, 4.5, 8)

  const code = withContext
    ? { x: textX, y: inner.y + inner.height / 2, maxWidth: textWidth, fontSize: codeFontSize }
    : {
        x: textX,
        y: inner.y + (inner.height - codeFontSize) / 2,
        maxWidth: textWidth,
        fontSize: codeFontSize,
      }

  const context = withContext
    ? {
        x: textX,
        y: inner.y + inner.height / 2 - contextFontSize - 3,
        maxWidth: textWidth,
        fontSize: contextFontSize,
      }
    : null

  return { qr, code, context }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
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
