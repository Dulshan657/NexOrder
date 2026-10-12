// Draw a laid-out QR poster with pdf-lib. The only file in `qrPoster/` that
// touches a PDF: geometry is `layout.ts` (pure, tested), encoding is `matrix.ts`,
// and this one just paints what they decided.

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFImage } from 'https://esm.sh/pdf-lib@1.17.1'
import type { LogoImage } from '../companyIdentity.ts'
import { layoutPoster, type PosterFormat, type PosterLayout, type TextBlock } from './layout.ts'
import { sanitizeForWinAnsi, type PosterFont } from './text.ts'
import type { QrMatrix } from './matrix.ts'

export interface PosterContent {
  format: PosterFormat
  venueName: string
  companyName: string
  phone: string
  logo: LogoImage | null
  matrix: QrMatrix
}

const INK = rgb(0, 0, 0)
const SOFT_INK = rgb(0.22, 0.2, 0.19)

/**
 * The dark modules as ONE filled path.
 *
 * Drawing each module as its own rectangle leaves hairline seams between
 * neighbours in some PDF viewers, where anti-aliasing blends two touching edges
 * into a pale line; on a code that has to survive a phone camera at an angle,
 * that is noise. A single path with the modules merged into horizontal runs is
 * rasterised as one shape, so there is nothing to seam. The path is in SVG
 * coordinates (origin top-left, y down), which is what `drawSvgPath` expects.
 */
export function modulesToSvgPath(matrix: QrMatrix, moduleSize: number): string {
  const segments: string[] = []
  matrix.forEach((row, r) => {
    let c = 0
    while (c < row.length) {
      if (!row[c]) {
        c += 1
        continue
      }
      const start = c
      while (c < row.length && row[c]) c += 1
      const x = start * moduleSize
      const y = r * moduleSize
      const w = (c - start) * moduleSize
      segments.push(`M${x} ${y}h${w}v${moduleSize}h${-w}Z`)
    }
  })
  return segments.join('')
}

function drawBlock(
  page: ReturnType<PDFDocument['addPage']>,
  block: TextBlock,
  fonts: Record<PosterFont, PDFFont>,
  color: ReturnType<typeof rgb>,
): void {
  const font = fonts[block.font]
  block.lines.forEach((line, i) => {
    const width = font.widthOfTextAtSize(line, block.size)
    page.drawText(line, {
      x: block.centerX - width / 2,
      y: block.baselines[i],
      size: block.size,
      font,
      color,
    })
  })
}

async function embedLogo(pdf: PDFDocument, logo: LogoImage | null): Promise<PDFImage | null> {
  if (!logo) return null
  try {
    return logo.format === 'png' ? await pdf.embedPng(logo.bytes) : await pdf.embedJpg(logo.bytes)
  } catch (e) {
    // A logo that sniffs as PNG/JPEG but will not decode (truncated, odd colour
    // profile) must cost the poster its logo, not the whole poster.
    console.error('[qrPoster] logo could not be embedded:', e instanceof Error ? e.message : e)
    return null
  }
}

/** The PDF bytes, and the layout they were drawn from (for tests and diagnostics). */
export async function renderPoster(content: PosterContent): Promise<{ bytes: Uint8Array; layout: PosterLayout }> {
  const pdf = await PDFDocument.create()
  const fonts: Record<PosterFont, PDFFont> = {
    regular: await pdf.embedFont(StandardFonts.Helvetica),
    bold: await pdf.embedFont(StandardFonts.HelveticaBold),
  }
  const image = await embedLogo(pdf, content.logo)

  const layout = layoutPoster(
    {
      format: content.format,
      venueName: content.venueName,
      companyName: content.companyName,
      phone: content.phone,
      logo: image ? { width: image.width, height: image.height } : null,
      qrModules: content.matrix.length,
    },
    (text, size, font) => fonts[font].widthOfTextAtSize(text, size),
  )

  const venueTitle = sanitizeForWinAnsi(content.venueName) || 'Venue'
  pdf.setTitle(`Reorder QR - ${venueTitle}`)
  pdf.setProducer('Nex Order')

  const page = pdf.addPage([layout.width, layout.height])

  if (image && layout.logo) {
    page.drawImage(image, { x: layout.logo.x, y: layout.logo.y, width: layout.logo.width, height: layout.logo.height })
  }
  if (layout.company) drawBlock(page, layout.company, fonts, SOFT_INK)
  drawBlock(page, layout.venue, fonts, INK)

  // The code. SVG origin = top-left of the module grid.
  page.drawSvgPath(modulesToSvgPath(content.matrix, layout.qr.moduleSize), {
    x: layout.qr.gridX,
    y: layout.qr.gridY + layout.qr.gridSize,
    color: INK,
    borderWidth: 0,
  })

  drawBlock(page, layout.headline, fonts, INK)
  if (layout.subline) drawBlock(page, layout.subline, fonts, SOFT_INK)
  if (layout.phone) drawBlock(page, layout.phone, fonts, SOFT_INK)

  return { bytes: await pdf.save(), layout }
}
