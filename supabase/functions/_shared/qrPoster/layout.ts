// Where everything goes on the QR poster. Pure geometry: no pdf-lib, no Deno, no
// I/O. Font metrics are injected (`measure`), so vitest drives this with a trivial
// fake and `generate-qr-poster` drives it with pdf-lib's real widths -- the same
// split as `_shared/labelSheet.ts`.
//
// All coordinates are PDF points with the origin at the BOTTOM-LEFT, matching
// pdf-lib. A `Box` is addressed by its bottom-left corner.
//
// ── THE STACK ───────────────────────────────────────────────────────────────
//
//   brand      the operator's logo, or -- if there is none -- their company name
//   venue      the HoReCa's name, large, up to two lines
//   QR         the code, centred, with a four-module quiet zone INSIDE its box
//   headline   "Scan to reorder"
//   subline    "Enter your staff PIN"
//   ─ ─ ─ ─ ─
//   phone      pinned to the bottom margin
//
// The first five flow down from the top margin; the phone is pinned to the bottom
// so it is where a person looks for it whatever the venue's name does to the
// height above. Space left over is shared between the gaps (up to a limit) and
// the rest split above and below, so a short name does not leave the poster
// bottom-heavy.
//
// THE QR GIVES WAY FIRST. When the stack is taller than the page -- a long name
// on the sticker, say -- the QR box shrinks toward its floor before anything else
// moves. Text is already shrunk to its own floor by `fitLines`; the code is the
// one element with a large margin of safety (a phone reads a 42 mm code as readily
// as a 45 mm one), so it is the right thing to spend.
//
// THE QUIET ZONE IS PART OF THE BOX. `QR_QUIET_MODULES` blank modules surround the
// symbol inside `qr.box`, so the size a reader sees on the page IS the size
// printed and nothing drawn beside the code can intrude on the margin a scanner
// needs. Four modules is the QR specification's minimum.

import { A4_HEIGHT, A4_WIDTH, MM } from '../labelSheet.ts'
import { fitLines, sanitizeForWinAnsi, type Measure, type PosterFont } from './text.ts'

export type PosterFormat = 'a4' | 'sticker'

export const POSTER_FORMATS: ReadonlyArray<PosterFormat> = ['a4', 'sticker']

export const POSTER_HEADLINE = 'Scan to reorder'
export const POSTER_SUBLINE = 'Enter your staff PIN'

/** The QR specification's minimum quiet zone, in modules. */
export const QR_QUIET_MODULES = 4

/** Line height as a multiple of the font size. */
const LEADING = 1.2
/** Distance from the top of a line box to its baseline, as a multiple of the size. */
const BASELINE_FROM_TOP = 0.9

export interface Box {
  x: number
  y: number
  width: number
  height: number
}

export interface TextBlock {
  lines: string[]
  size: number
  font: PosterFont
  lineHeight: number
  /** Every line is centred on this x. */
  centerX: number
  /** One baseline per line, top line first. */
  baselines: number[]
  box: Box
  truncated: boolean
}

export interface QrPlacement {
  /** The code plus its quiet zone. */
  box: Box
  moduleSize: number
  /** Bottom-left of the module grid, i.e. inside the quiet zone. */
  gridX: number
  gridY: number
  gridSize: number
  quietModules: number
}

export interface PosterInput {
  format: PosterFormat
  /** Free text from the manager; sanitised here. */
  venueName: string
  companyName: string
  phone: string
  /** Natural pixel size of the operator's logo, or null for no logo. */
  logo: { width: number; height: number } | null
  /** Side length of the QR matrix in modules, quiet zone excluded. */
  qrModules: number
}

export interface PosterLayout {
  format: PosterFormat
  width: number
  height: number
  margin: number
  logo: Box | null
  company: TextBlock | null
  venue: TextBlock
  qr: QrPlacement
  headline: TextBlock
  subline: TextBlock | null
  phone: TextBlock | null
}

interface TextSpec {
  preferred: number
  min: number
  lines: number
  font: PosterFont
}

interface FormatSpec {
  width: number
  height: number
  margin: number
  gap: number
  /** Largest extra gap the leftover space may add, as a multiple of `gap`. */
  maxGapGrowth: number
  logoMax: { width: number; height: number }
  company: TextSpec
  venue: TextSpec
  headline: TextSpec
  subline: TextSpec
  phone: TextSpec
  qrPreferred: number
  qrMin: number
}

const SPECS: Readonly<Record<PosterFormat, FormatSpec>> = {
  // A4 for the wall by the pass: the code is the thing, ~120 mm.
  a4: {
    width: A4_WIDTH,
    height: A4_HEIGHT,
    margin: 18 * MM,
    gap: 8 * MM,
    maxGapGrowth: 1.5,
    logoMax: { width: 80 * MM, height: 30 * MM },
    company: { preferred: 28, min: 14, lines: 1, font: 'bold' },
    venue: { preferred: 44, min: 22, lines: 2, font: 'bold' },
    headline: { preferred: 32, min: 20, lines: 1, font: 'bold' },
    subline: { preferred: 20, min: 12, lines: 1, font: 'regular' },
    phone: { preferred: 16, min: 9, lines: 1, font: 'regular' },
    qrPreferred: 120 * MM,
    qrMin: 80 * MM,
  },
  // 60 x 80 mm for a till, a fridge door, a tablet case. Condensed: everything
  // except the code is small, and the code is ~45 mm.
  sticker: {
    width: 60 * MM,
    height: 80 * MM,
    margin: 2.5 * MM,
    gap: 1 * MM,
    maxGapGrowth: 1.5,
    logoMax: { width: 30 * MM, height: 7 * MM },
    company: { preferred: 8, min: 5.5, lines: 1, font: 'bold' },
    venue: { preferred: 10.5, min: 6.5, lines: 2, font: 'bold' },
    headline: { preferred: 9.5, min: 6.5, lines: 1, font: 'bold' },
    subline: { preferred: 6.5, min: 5, lines: 1, font: 'regular' },
    phone: { preferred: 6.5, min: 5, lines: 1, font: 'regular' },
    qrPreferred: 44 * MM,
    qrMin: 32 * MM,
  },
}

export function posterSpec(format: PosterFormat): Readonly<FormatSpec> {
  return SPECS[format]
}

export function isPosterFormat(value: unknown): value is PosterFormat {
  return value === 'a4' || value === 'sticker'
}

// ── text blocks ─────────────────────────────────────────────────────────────

interface PendingText {
  lines: string[]
  size: number
  font: PosterFont
  lineHeight: number
  height: number
  truncated: boolean
}

function prepareText(text: string, spec: TextSpec, maxWidth: number, measure: Measure): PendingText | null {
  const clean = sanitizeForWinAnsi(text)
  if (!clean) return null
  const fitted = fitLines(
    clean,
    { maxWidth, preferredSize: spec.preferred, minSize: spec.min, maxLines: spec.lines, font: spec.font },
    measure,
  )
  if (fitted.lines.length === 0) return null
  const lineHeight = fitted.size * LEADING
  return {
    lines: fitted.lines,
    size: fitted.size,
    font: spec.font,
    lineHeight,
    height: lineHeight * fitted.lines.length,
    truncated: fitted.truncated,
  }
}

/** Place prepared text with its TOP edge at `top` (points from the page's top). */
function placeText(p: PendingText, top: number, pageHeight: number, centerX: number, maxWidth: number): TextBlock {
  const boxTop = pageHeight - top
  return {
    lines: p.lines,
    size: p.size,
    font: p.font,
    lineHeight: p.lineHeight,
    centerX,
    baselines: p.lines.map((_, i) => boxTop - i * p.lineHeight - p.size * BASELINE_FROM_TOP),
    box: { x: centerX - maxWidth / 2, y: boxTop - p.height, width: maxWidth, height: p.height },
    truncated: p.truncated,
  }
}

// ── the layout ──────────────────────────────────────────────────────────────

/** The logo box that fits `max` while keeping the image's own aspect ratio. */
function fitLogo(
  natural: { width: number; height: number } | null,
  max: { width: number; height: number },
): { width: number; height: number } | null {
  if (!natural || !(natural.width > 0) || !(natural.height > 0)) return null
  const scale = Math.min(max.width / natural.width, max.height / natural.height)
  return { width: natural.width * scale, height: natural.height * scale }
}

type Item =
  | { kind: 'logo'; height: number; width: number }
  | { kind: 'company'; height: number; text: PendingText }
  | { kind: 'venue'; height: number; text: PendingText }
  | { kind: 'qr'; height: number }
  | { kind: 'headline'; height: number; text: PendingText }
  | { kind: 'subline'; height: number; text: PendingText }

export function layoutPoster(input: PosterInput, measure: Measure): PosterLayout {
  const spec = SPECS[input.format]
  const contentWidth = spec.width - 2 * spec.margin
  const centerX = spec.width / 2

  const logo = fitLogo(input.logo, spec.logoMax)
  const company = logo ? null : prepareText(input.companyName, spec.company, contentWidth, measure)
  // A venue with no name still gets a poster, but never an empty heading: the
  // caller (generate-qr-poster) refuses a nameless venue, so this is the fallback
  // for a name that sanitises to nothing.
  const venue =
    prepareText(input.venueName, spec.venue, contentWidth, measure) ??
    prepareText('Your venue', spec.venue, contentWidth, measure)!
  const headline = prepareText(POSTER_HEADLINE, spec.headline, contentWidth, measure)!
  const subline = prepareText(POSTER_SUBLINE, spec.subline, contentWidth, measure)
  const phoneText = sanitizeForWinAnsi(input.phone)
  const phone = phoneText ? prepareText(`Call ${phoneText}`, spec.phone, contentWidth, measure) : null

  // Height available to the stack: inside both margins, above the pinned phone.
  const phoneBlock = phone ? phone.height + spec.gap : 0
  const available = spec.height - 2 * spec.margin - phoneBlock

  // Everything except the code has a height already; the code absorbs any
  // shortfall, between its floor and its preferred size.
  const brandHeight = logo ? logo.height : company ? company.height : 0
  const fixed = brandHeight + venue.height + headline.height + (subline ? subline.height : 0)
  const itemCount = (brandHeight > 0 ? 1 : 0) + 3 + (subline ? 1 : 0)
  const gapCount = itemCount - 1
  const qrRoom = available - fixed - gapCount * spec.gap
  const qrSize = Math.min(spec.qrPreferred, Math.max(spec.qrMin, qrRoom))

  // The flowing stack, top to bottom.
  const items: Item[] = []
  if (logo) items.push({ kind: 'logo', height: logo.height, width: logo.width })
  else if (company) items.push({ kind: 'company', height: company.height, text: company })
  items.push({ kind: 'venue', height: venue.height, text: venue })
  items.push({ kind: 'qr', height: qrSize })
  items.push({ kind: 'headline', height: headline.height, text: headline })
  if (subline) items.push({ kind: 'subline', height: subline.height, text: subline })

  const used = fixed + qrSize + gapCount * spec.gap
  const leftover = Math.max(0, available - used)
  const growth = gapCount > 0 ? Math.min(leftover / gapCount, spec.gap * spec.maxGapGrowth) : 0
  const gap = spec.gap + growth
  const topOffset = Math.max(0, (leftover - growth * gapCount) / 2)

  const out: Partial<PosterLayout> = {}
  let cursor = spec.margin + topOffset // distance from the page's top edge

  for (const it of items) {
    switch (it.kind) {
      case 'logo':
        out.logo = { x: centerX - it.width / 2, y: spec.height - cursor - it.height, width: it.width, height: it.height }
        break
      case 'company':
        out.company = placeText(it.text, cursor, spec.height, centerX, contentWidth)
        break
      case 'venue':
        out.venue = placeText(it.text, cursor, spec.height, centerX, contentWidth)
        break
      case 'qr': {
        const box: Box = { x: centerX - it.height / 2, y: spec.height - cursor - it.height, width: it.height, height: it.height }
        const moduleSize = it.height / (input.qrModules + 2 * QR_QUIET_MODULES)
        const quiet = QR_QUIET_MODULES * moduleSize
        out.qr = {
          box,
          moduleSize,
          gridX: box.x + quiet,
          gridY: box.y + quiet,
          gridSize: input.qrModules * moduleSize,
          quietModules: QR_QUIET_MODULES,
        }
        break
      }
      case 'headline':
        out.headline = placeText(it.text, cursor, spec.height, centerX, contentWidth)
        break
      case 'subline':
        out.subline = placeText(it.text, cursor, spec.height, centerX, contentWidth)
        break
    }
    cursor += it.height + gap
  }

  const phoneLayout = phone
    ? placeText(phone, spec.height - spec.margin - phone.height, spec.height, centerX, contentWidth)
    : null

  return {
    format: input.format,
    width: spec.width,
    height: spec.height,
    margin: spec.margin,
    logo: out.logo ?? null,
    company: out.company ?? null,
    venue: out.venue as TextBlock,
    qr: out.qr as QrPlacement,
    headline: out.headline as TextBlock,
    subline: out.subline ?? null,
    phone: phoneLayout,
  }
}

/** The file name the browser is offered: ascii, lowercase, no path characters. */
export function posterFileName(venueName: string, format: PosterFormat): string {
  const slug = sanitizeForWinAnsi(venueName)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
  return `qr-${slug || 'venue'}-${format}.pdf`
}
