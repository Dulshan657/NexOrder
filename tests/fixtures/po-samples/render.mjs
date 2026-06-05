// Shared PO document renderers, used by both the on-disk fixture generator
// (generate.mjs) and the live injector (inject.mjs).
//
// Each renderer returns the document as a Uint8Array so the injector can
// upload bytes straight to Storage without a disk round-trip; generate.mjs
// writes the same bytes to files.

import PDFDocument from 'pdfkit'
import {
  AlignmentType,
  BorderStyle,
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from 'docx'
import { createCanvas } from '@napi-rs/canvas'

// ============================================================================
// PDF (pdfkit) — collected into a Buffer instead of streamed to disk
// ============================================================================

/** @returns {Promise<Uint8Array>} */
export function renderPdf(spec) {
  return new Promise((resolveDone, rejectDone) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 })
    const chunks = []
    doc.on('data', c => chunks.push(c))
    doc.on('end', () => resolveDone(new Uint8Array(Buffer.concat(chunks))))
    doc.on('error', rejectDone)

    // Letterhead
    doc.font('Helvetica-Bold').fontSize(18).text(spec.company, { align: 'left' })
    doc.font('Helvetica').fontSize(10).fillColor('#555').text(spec.tagline, { align: 'left' })
    doc.moveDown(0.4)
    doc.fontSize(9).fillColor('#333')
    for (const line of spec.addressLines) doc.text(line)
    doc.moveDown(0.8)

    // Divider rule
    doc.strokeColor('#333').lineWidth(0.5).moveTo(50, doc.y).lineTo(545, doc.y).stroke()
    doc.moveDown(0.6)

    // PO title block
    doc.fillColor('#000').font('Helvetica-Bold').fontSize(14).text('PURCHASE ORDER')
    doc.moveDown(0.4)
    doc.font('Helvetica').fontSize(10)
    doc.text(`PO Number:       ${spec.poNumber}`)
    doc.text(`Order date:      ${spec.orderDate}`)
    doc.text(`Requested date:  ${spec.requestedDate}`)
    doc.text(`Buyer:           ${spec.buyer}`)
    doc.moveDown(0.4)

    // Ship to
    doc.font('Helvetica-Bold').fontSize(10).text('Ship to:')
    doc.font('Helvetica')
    for (const line of spec.shipTo) doc.text(`  ${line}`)
    doc.moveDown(0.8)

    // Line-item table — manual since pdfkit has no table primitive
    const colX = { code: 50, name: 140, qty: 360, uom: 405, pack: 460 }
    const headerY = doc.y
    doc.font('Helvetica-Bold').fontSize(9).fillColor('#222')
    doc.text('Code', colX.code, headerY)
    doc.text('Description', colX.name, headerY)
    doc.text('Qty', colX.qty, headerY, { width: 40, align: 'right' })
    doc.text('UoM', colX.uom, headerY)
    doc.text('Pack', colX.pack, headerY)
    doc.moveTo(50, doc.y + 4).lineTo(545, doc.y + 4).stroke()
    doc.moveDown(0.5)

    doc.font('Helvetica').fontSize(9).fillColor('#222')
    for (const line of spec.lines) {
      const rowY = doc.y
      doc.text(line.code || '—', colX.code, rowY, { width: 85 })
      doc.text(line.name, colX.name, rowY, { width: 215 })
      doc.text(String(line.qty), colX.qty, rowY, { width: 40, align: 'right' })
      doc.text(line.uom, colX.uom, rowY, { width: 50 })
      doc.text(line.pack, colX.pack, rowY, { width: 85 })
      doc.moveDown(0.7)
    }

    doc.moveDown(0.4)
    doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke()
    doc.moveDown(0.6)

    if (spec.notes) {
      doc.font('Helvetica-Bold').fontSize(10).text('Notes')
      doc.font('Helvetica').fontSize(9).fillColor('#444').text(spec.notes, { width: 495 })
      doc.moveDown(1)
    }

    doc.fontSize(8).fillColor('#999').text(
      'Please confirm receipt by reply. Contact procurement for any substitutions.',
      { align: 'center' },
    )

    doc.end()
  })
}

// ============================================================================
// DOCX (docx package)
// ============================================================================

function makeParagraph(text, opts = {}) {
  return new Paragraph({
    children: [new TextRun({ text, bold: opts.bold, size: opts.size, color: opts.color })],
    alignment: opts.alignment,
    spacing: opts.spacing,
  })
}

function makeHeading(text, level = HeadingLevel.HEADING_2) {
  return new Paragraph({
    children: [new TextRun({ text, bold: true })],
    heading: level,
    spacing: { before: 200, after: 100 },
  })
}

function makeTable(headerLabels, rows) {
  const cellPad = { top: 80, bottom: 80, left: 120, right: 120 }
  const border = { style: BorderStyle.SINGLE, size: 4, color: 'AAAAAA' }

  const headerRow = new TableRow({
    children: headerLabels.map(label =>
      new TableCell({
        children: [makeParagraph(label, { bold: true, size: 18 })],
        margins: cellPad,
        shading: { fill: 'EEEEEE' },
      }),
    ),
    tableHeader: true,
  })

  const bodyRows = rows.map(cells =>
    new TableRow({
      children: cells.map(c =>
        new TableCell({ children: [makeParagraph(c, { size: 18 })], margins: cellPad }),
      ),
    }),
  )

  return new Table({
    rows: [headerRow, ...bodyRows],
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: border,
      bottom: border,
      left: border,
      right: border,
      insideHorizontal: border,
      insideVertical: border,
    },
  })
}

/** @returns {Promise<Uint8Array>} */
export async function renderDocx(spec) {
  const children = [
    makeParagraph(spec.company, { bold: true, size: 32 }),
    makeParagraph(spec.tagline, { size: 18, color: '666666' }),
    ...spec.addressLines.map(line => makeParagraph(line, { size: 18 })),
    makeParagraph(''),
    makeHeading('Purchase Order', HeadingLevel.HEADING_1),
    makeParagraph(`PO Number:       ${spec.poNumber}`),
    makeParagraph(`Order date:      ${spec.orderDate}`),
    makeParagraph(`Requested date:  ${spec.requestedDate}`),
    makeParagraph(`Buyer:           ${spec.buyer}`),
    makeParagraph(''),
    makeParagraph('Ship to:', { bold: true }),
    ...spec.shipTo.map(line => makeParagraph(`  ${line}`)),
    makeParagraph(''),
    makeHeading('Line items', HeadingLevel.HEADING_2),
    makeTable(
      ['Code', 'Description', 'Qty', 'UoM', 'Pack'],
      spec.lines.map(line => [line.code || '—', line.name, String(line.qty), line.uom, line.pack]),
    ),
    makeParagraph(''),
  ]

  if (spec.notes) {
    children.push(makeHeading('Notes', HeadingLevel.HEADING_2))
    children.push(makeParagraph(spec.notes))
    children.push(makeParagraph(''))
  }

  children.push(
    makeParagraph(
      'Please confirm receipt by reply. Contact procurement for any substitutions.',
      { color: '888888', alignment: AlignmentType.CENTER, size: 16 },
    ),
  )

  const docxDoc = new Document({
    creator: 'NexOrder PO Fixture Generator',
    title: `PO ${spec.poNumber}`,
    description: 'Sample purchase order for end-to-end testing of the PO Inbox pipeline',
    sections: [{ children }],
  })

  const buffer = await Packer.toBuffer(docxDoc)
  return new Uint8Array(buffer)
}

// ============================================================================
// Image PO (canvas → PNG) — feeds the GPT-4o vision extraction path
// ============================================================================

/** @returns {Uint8Array} a legible scanned-style PO rendered as PNG */
export function renderImagePo(spec) {
  const W = 900
  const H = 1273
  // Render at higher resolution so the PNG is comfortably > 50 KB. A real
  // scanned/photographed PO is large; staying under SMALL_IMAGE_BYTES would
  // make selectAttachments() treat even a genuine image PO as a signature.
  const SCALE = 1.7
  const canvas = createCanvas(Math.round(W * SCALE), Math.round(H * SCALE))
  const ctx = canvas.getContext('2d')
  ctx.scale(SCALE, SCALE)

  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, W, H)
  ctx.textBaseline = 'top'

  const M = 60
  let y = M

  // Letterhead
  ctx.fillStyle = '#111111'
  ctx.font = 'bold 30px sans-serif'
  ctx.fillText(spec.company, M, y)
  y += 38
  ctx.fillStyle = '#666666'
  ctx.font = '16px sans-serif'
  ctx.fillText(spec.tagline, M, y)
  y += 26
  ctx.fillStyle = '#333333'
  ctx.font = '15px sans-serif'
  for (const line of spec.addressLines) {
    ctx.fillText(line, M, y)
    y += 21
  }
  y += 14

  // Divider
  ctx.strokeStyle = '#333333'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(M, y)
  ctx.lineTo(W - M, y)
  ctx.stroke()
  y += 24

  // PO title block
  ctx.fillStyle = '#000000'
  ctx.font = 'bold 24px sans-serif'
  ctx.fillText('PURCHASE ORDER', M, y)
  y += 40
  ctx.font = '16px sans-serif'
  for (const [label, value] of [
    ['PO Number:', spec.poNumber],
    ['Order date:', spec.orderDate],
    ['Requested date:', spec.requestedDate],
    ['Buyer:', spec.buyer],
  ]) {
    ctx.fillStyle = '#555555'
    ctx.fillText(label, M, y)
    ctx.fillStyle = '#111111'
    ctx.fillText(String(value), M + 170, y)
    y += 24
  }
  y += 10

  // Ship-to
  ctx.fillStyle = '#000000'
  ctx.font = 'bold 16px sans-serif'
  ctx.fillText('Ship to:', M, y)
  y += 24
  ctx.font = '15px sans-serif'
  ctx.fillStyle = '#333333'
  for (const line of spec.shipTo) {
    ctx.fillText(line, M + 16, y)
    y += 21
  }
  y += 18

  // Line-item table
  const col = { code: M, name: M + 130, qty: M + 470, uom: M + 540, pack: M + 620 }
  ctx.fillStyle = '#222222'
  ctx.font = 'bold 15px sans-serif'
  ctx.fillText('Code', col.code, y)
  ctx.fillText('Description', col.name, y)
  ctx.fillText('Qty', col.qty, y)
  ctx.fillText('UoM', col.uom, y)
  ctx.fillText('Pack', col.pack, y)
  y += 22
  ctx.beginPath()
  ctx.moveTo(M, y)
  ctx.lineTo(W - M, y)
  ctx.stroke()
  y += 12

  ctx.font = '14px sans-serif'
  ctx.fillStyle = '#222222'
  for (const line of spec.lines) {
    ctx.fillText(line.code || '—', col.code, y)
    ctx.fillText(line.name, col.name, y)
    ctx.fillText(String(line.qty), col.qty, y)
    ctx.fillText(line.uom, col.uom, y)
    ctx.fillText(line.pack, col.pack, y)
    y += 26
  }
  y += 10
  ctx.beginPath()
  ctx.moveTo(M, y)
  ctx.lineTo(W - M, y)
  ctx.stroke()
  y += 22

  if (spec.notes) {
    ctx.fillStyle = '#000000'
    ctx.font = 'bold 16px sans-serif'
    ctx.fillText('Notes', M, y)
    y += 24
    ctx.fillStyle = '#444444'
    ctx.font = '14px sans-serif'
    // crude word-wrap
    const words = spec.notes.split(' ')
    let lineStr = ''
    const maxWidth = W - M * 2
    for (const word of words) {
      const trial = lineStr ? `${lineStr} ${word}` : word
      if (ctx.measureText(trial).width > maxWidth) {
        ctx.fillText(lineStr, M, y)
        y += 20
        lineStr = word
      } else {
        lineStr = trial
      }
    }
    if (lineStr) ctx.fillText(lineStr, M, y)
  }

  return new Uint8Array(canvas.toBuffer('image/png'))
}

// ============================================================================
// Placeholder footer / signature images
//
// These never reach the model — selectAttachments() demotes inline/small/gif
// images below any real document. Only their manifest entry matters, so the
// bytes can be trivial. The PNG "logo" is rendered small (and stays < 50 KB,
// tripping the small-image signature rule); the GIF is a 1×1 transparent pixel.
// ============================================================================

/** Small banner-style PNG so storage looks plausible if inspected. */
export function makeLogoPng() {
  const canvas = createCanvas(160, 48)
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#0b5cab'
  ctx.fillRect(0, 0, 160, 48)
  ctx.fillStyle = '#ffffff'
  ctx.font = 'bold 18px sans-serif'
  ctx.textBaseline = 'middle'
  ctx.fillText('LOGO', 16, 26)
  return new Uint8Array(canvas.toBuffer('image/png'))
}

/** 1×1 transparent GIF (43 bytes) — exercises the image/gif signature rule. */
export const SIGNATURE_GIF_BYTES = new Uint8Array(
  Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64'),
)
