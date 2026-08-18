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
 * Sheet presets — every one a die-cut you can actually buy.
 *
 * That constraint is the whole point of a fixed list rather than free
 * millimetres: a mistyped margin does not print a slightly odd label, it prints
 * every sticker half off its backing and wastes the sheet. Sizes here are the
 * Avery A4 range, which is what is stocked in Australia.
 *
 * Which one a given job should use is NOT decided here — see
 * `_shared/labels/sizing.ts`, which is the only file holding a threshold. A
 * bin sticker's size depends on how long its code encodes and how far away it
 * gets scanned, and neither is a property of the paper.
 */
export const SHEET_PRESETS = {
  'a4-65': { columns: 5, rows: 13, marginX: 4.75 * MM, marginY: 10.7 * MM, gutterX: 2.5 * MM, gutterY: 0, padding: 3 },
  'a4-40': { columns: 4, rows: 10, marginX: 9.85 * MM, marginY: 21.5 * MM, gutterX: 2.5 * MM, gutterY: 0, padding: 3 },
  'a4-24': { columns: 3, rows: 8, marginX: 7.25 * MM, marginY: 12.9 * MM, gutterX: 2.5 * MM, gutterY: 0, padding: 4 },
  'a4-21': { columns: 3, rows: 7, marginX: 7.25 * MM, marginY: 15.15 * MM, gutterX: 2.5 * MM, gutterY: 0, padding: 4 },
  'a4-14': { columns: 2, rows: 7, marginX: 4.65 * MM, marginY: 15.15 * MM, gutterX: 2.5 * MM, gutterY: 0, padding: 6 },
  'a4-12': { columns: 2, rows: 6, marginX: 4.65 * MM, marginY: 21.6 * MM, gutterX: 2.5 * MM, gutterY: 0, padding: 6 },
  'a4-8':  { columns: 2, rows: 4, marginX: 4.65 * MM, marginY: 13.1 * MM, gutterX: 2.5 * MM, gutterY: 0, padding: 10 },
  'a4-4':  { columns: 2, rows: 2, marginX: 4.65 * MM, marginY: 9.5 * MM, gutterX: 2.5 * MM, gutterY: 0, padding: 10 },
  'a4-2':  { columns: 1, rows: 2, marginX: 5.2 * MM, marginY: 5 * MM, gutterX: 0, gutterY: 0, padding: 12 },
  'a4-1':  { columns: 1, rows: 1, marginX: 5.2 * MM, marginY: 3.95 * MM, gutterX: 0, gutterY: 0, padding: 14 },
} as const

export type SheetPresetName = keyof typeof SHEET_PRESETS

/**
 * What to call each stock, and what it is good for.
 *
 * Kept beside the geometry but separate from it so `sheetSpec` stays a pure
 * `LabelSheetSpec` — and so the UI stops hard-coding size strings that go stale
 * the moment a preset moves. `bestFor` is a hint for the sizing wizard's list,
 * never a rule: the verdict comes from the code length and the scan distance.
 */
export const SHEET_PRESET_INFO: Record<
  SheetPresetName,
  { perSheet: number; widthMm: number; heightMm: number; averyCode: string; averyLabel: string; bestFor: string }
> = {
  'a4-65': { perSheet: 65, widthMm: 38.1, heightMm: 21.2, averyCode: 'L7651', averyLabel: '65 per sheet, 38x21mm', bestFor: 'Very short codes only' },
  'a4-40': { perSheet: 40, widthMm: 45.7, heightMm: 25.4, averyCode: 'L7654', averyLabel: '40 per sheet, 46x25mm', bestFor: 'Short codes, carton plates' },
  'a4-24': { perSheet: 24, widthMm: 63.5, heightMm: 33.9, averyCode: 'L7159', averyLabel: '24 per sheet, 64x34mm', bestFor: 'Pallet and carton plates' },
  'a4-21': { perSheet: 21, widthMm: 63.5, heightMm: 38.1, averyCode: 'L7160', averyLabel: '21 per sheet, 64x38mm', bestFor: 'Pallet plates, taller face' },
  'a4-14': { perSheet: 14, widthMm: 99.1, heightMm: 38.1, averyCode: 'L7163', averyLabel: '14 per sheet, 99x38mm', bestFor: 'Bins and rack levels' },
  'a4-12': { perSheet: 12, widthMm: 99.1, heightMm: 42.3, averyCode: 'L7164', averyLabel: '12 per sheet, 99x42mm', bestFor: 'Bins with a long context line' },
  'a4-8':  { perSheet: 8, widthMm: 99.1, heightMm: 67.7, averyCode: 'L7165', averyLabel: '8 per sheet, 99x68mm', bestFor: 'Aisle and zone signs' },
  'a4-4':  { perSheet: 4, widthMm: 99.1, heightMm: 139, averyCode: 'L7169', averyLabel: '4 per sheet, 99x139mm', bestFor: 'Large wayfinding signs' },
  'a4-2':  { perSheet: 2, widthMm: 199.6, heightMm: 143.5, averyCode: 'L7168', averyLabel: '2 per sheet, 200x144mm', bestFor: 'Aisle-end signage' },
  'a4-1':  { perSheet: 1, widthMm: 199.6, heightMm: 289.1, averyCode: 'L7167', averyLabel: '1 per sheet, 200x289mm', bestFor: 'Full-page dock signage' },
}

/**
 * The last usable slot on one sheet of a given stock, and therefore the largest
 * `startOffset` that means anything on it.
 *
 * Every bound on the offset — both inputs and the server's schema — derives from
 * here. A hand-typed literal is exactly how the UI cap of 47 outlived the 24-up
 * sheet it was sized for: it was simultaneously too LOW for `a4-65` and three to
 * six times too HIGH for `a4-14` and `a4-8`, the two stocks the system actually
 * defaults to. `layoutLabels` clamps silently, so an operator who typed 20 onto a
 * 14-up sheet found out at the printer.
 */
export function maxStartOffset(preset: SheetPresetName): number {
  return SHEET_PRESET_INFO[preset].perSheet - 1
}

/**
 * The largest legal offset anywhere in the library — the server's ceiling, where
 * the preset is not yet known at validation time.
 *
 * Derived, never typed: an eleventh preset must not leave a stale literal behind.
 */
export const MAX_START_OFFSET: number = Math.max(
  ...(Object.keys(SHEET_PRESET_INFO) as SheetPresetName[]).map(maxStartOffset),
)

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
 * Geometry for one label's contents: a Code 128 barcode across the top, the
 * human-readable code and context text centred beneath it.
 *
 * A barcode-only label is unreadable the moment it is scuffed, wet or badly lit,
 * and an operator who cannot read the code cannot type it either — so the text is
 * not decoration, it is the fallback path. Which is exactly why the text used to
 * sit in a column beside the symbol and no longer does: on the 24-up bin sheet
 * that column was 97.5pt, and a code in Courier-Bold at 15pt costs 9pt per
 * character, so it held 10.8 of them. MAIN's bin codes are 11-12 characters.
 * Every sticker printed `MAIN-O01-…`, and half a code is not a fallback.
 *
 * Stacked, the text gets the whole inner width — 172.5pt on that sheet, 77% more.
 * The symbol wants that width even more than the text does: a linear barcode's
 * readability IS its width, so the two wants point the same way.
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

/** Where the bars go, and how wide a single module ended up. */
export interface BarcodeFit {
  /** Left edge of the FIRST BAR — the quiet zone is already excluded. */
  x: number
  /** Bottom of the bars. */
  y: number
  /** modules * moduleWidth. Excludes the quiet zones. */
  width: number
  height: number
  /** The X-dimension, in points. This is the number that decides readability. */
  moduleWidth: number
  /** Blank granted either side, in points. */
  quietZone: number
}

export interface LabelArtwork {
  barcode: BarcodeFit
  code: LabelTextSlot
  context: LabelTextSlot | null
}

/**
 * Blank margin either side of the symbol, in modules — ISO 15417's requirement
 * for Code 128. Note this is NOT the 6.35mm figure quoted for UPC/EAN, which is
 * a different symbology's convention. Too little quiet zone is the commonest
 * cause of a barcode that "scans sometimes".
 */
export const QUIET_ZONE_MODULES = 10

/** A floor under the quiet zone so a very short symbol still gets a visible gutter. */
export const MIN_QUIET_ZONE_PT = 2.54 * MM

/**
 * GS1's ceiling on the X-dimension. Without it a two-character aisle code on a
 * 99x67mm sign would be handed a 1.2mm module and print as a handful of enormous
 * stripes. Capped, it sits centred with generous white either side, which reads
 * as deliberate because it is.
 */
export const MAX_X_DIMENSION_PT = 1.016 * MM

/**
 * Bar height bounds. The floor is the usual 6.35mm minimum; the ceiling stops a
 * tall sign spending its whole face on bars when the extra height buys nothing —
 * a scan line only needs to cross the symbol once.
 */
export const MIN_BAR_HEIGHT_PT = 6.35 * MM
export const MAX_BAR_HEIGHT_PT = 25 * MM

/**
 * Fit a symbol of `modules` modules into `inner`, given the vertical room left
 * over after the text.
 *
 * Closed form, no iteration: whichever of the three constraints binds is the one
 * `Math.min` picks. The quiet zone then falls out as the leftover width, split
 * evenly, and satisfies both its floors by construction.
 *
 * The real quiet zone on a printed sheet is larger than this computes, and
 * deliberately so — the inner box already sits inside the cell's `padding`, and
 * the neighbouring label reserves its own margin symmetrically, so between two
 * columns the actual white gutter is `2 x quietZone + 2 x padding + gutterX`.
 * This is the conservative floor, not the achieved figure.
 */
export function fitBarcode(
  inner: LabelCell['inner'],
  modules: number,
  availableHeight: number,
): BarcodeFit {
  const byQuietRatio = inner.width / (modules + 2 * QUIET_ZONE_MODULES)
  const byQuietFloor = (inner.width - 2 * MIN_QUIET_ZONE_PT) / modules
  const moduleWidth = Math.max(0, Math.min(byQuietRatio, byQuietFloor, MAX_X_DIMENSION_PT))

  const width = modules * moduleWidth
  const quietZone = (inner.width - width) / 2

  // Clearance between the bars and the code beneath them, so a scan line that
  // drifts low reads white rather than the top of a glyph.
  const gap = Math.max(2, 2 * moduleWidth)
  const height = Math.min(Math.max(0, availableHeight - gap), MAX_BAR_HEIGHT_PT)

  return {
    x: inner.x + quietZone,
    // Bars sit flush to the top of the cell, where the QR did.
    y: inner.y + inner.height - height,
    width,
    height,
    moduleWidth,
    quietZone,
  }
}

/**
 * Floors for shrink-to-fit. The code's is higher because it is the line an
 * operator types when a QR will not scan — a code too small to read is no more
 * use than a truncated one, so past this point the ellipsis is honest. The
 * context is supplementary and can afford to go smaller before giving up.
 */
export const MIN_CODE_FONT_SIZE = 7
export const MIN_CONTEXT_FONT_SIZE = 5

/**
 * `modules` is the encoded symbol's width — see `_shared/labels/code128.ts`.
 * The X-dimension depends on the CODE, not just the cell, which is why this
 * needs it and why the sizing wizard can predict a bar width without rendering.
 */
export function labelArtwork(
  cell: LabelCell,
  opts: { modules: number; withContext?: boolean },
): LabelArtwork {
  const { inner } = cell
  const withContext = opts.withContext ?? true

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

  // The bars take what the text leaves. A linear symbol has no VERTICAL quiet
  // zone requirement — only horizontal — so unlike the QR this reserves nothing
  // above or below; fitBarcode handles the two side margins.
  const available = Math.max(0, inner.height - textZone)
  const barcode = fitBarcode(inner, opts.modules, available)

  const centerX = inner.x + inner.width / 2

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

  return { barcode, code, context }
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
