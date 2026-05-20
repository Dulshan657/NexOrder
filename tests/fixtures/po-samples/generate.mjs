// Generate sample PO documents (PDFs + DOCX) for end-to-end testing of the
// PO Inbox pipeline.
//
// Run with:  npm run po-fixtures
//
// Output layout:
//   tests/fixtures/po-samples/pdf/05-grand-hotel-auto-approve.pdf
//   tests/fixtures/po-samples/pdf/06-lotus-garden-multi-line.pdf
//   tests/fixtures/po-samples/docx/07-spice-room-bulk-order.docx
//
// Each sample is designed to exercise a specific code path of extract-po +
// the alias resolver. See README.md alongside this script for the expected
// outcome of each sample and how to send them from your email client.

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
import { createWriteStream, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))

// ============================================================================
// Sample specs
// ============================================================================

const samples = [
  {
    kind: 'pdf',
    filename: '05-grand-hotel-auto-approve.pdf',
    spec: {
      company: 'THE GRAND HOTEL',
      tagline: 'Hospitality Group · Sydney',
      addressLines: ['123 Luxury Ave', 'Sydney NSW 2000', 'orders@grandhotelsydney.com.au'],
      poNumber: 'GH-2026-0712',
      orderDate: '2026-05-19',
      requestedDate: '2026-05-23',
      buyer: 'Charles Lim · Procurement',
      shipTo: ['The Grand Hotel', '123 Luxury Ave', 'Sydney NSW 2000'],
      notes:
        'Standard weekly order. Please deliver to loading dock B between 6:30am–9:00am.',
      // Exact AYM SKUs → high-confidence product resolution.
      lines: [
        { code: 'AYM-COC-003', name: 'Coconut Milk 400ml', qty: 12, uom: 'cans', pack: '1 carton (12)' },
        { code: 'AYM-CUR-001', name: 'Thai Red Curry Paste 195g', qty: 6, uom: 'jars', pack: '1 carton (6)' },
        { code: 'AYM-SAU-001', name: 'Oyster Sauce 210ml', qty: 6, uom: 'bottles', pack: '1 carton (6)' },
        { code: 'AYM-CHL-001', name: 'Sweet Chilli Sauce 435ml', qty: 12, uom: 'bottles', pack: '2 cartons (6)' },
      ],
    },
  },
  {
    kind: 'pdf',
    filename: '06-lotus-garden-multi-line.pdf',
    spec: {
      company: 'LOTUS GARDEN RESTAURANT',
      tagline: 'Chinatown · Sydney',
      addressLines: ['12 Dixon St', 'Chinatown NSW 2000', 'kitchen@lotusgarden.com.au'],
      poNumber: 'LG-PO-558',
      orderDate: '2026-05-21',
      requestedDate: '2026-05-26',
      buyer: 'Mei Tan · Head Chef',
      shipTo: ['Lotus Garden Restaurant', '12 Dixon St', 'Chinatown NSW 2000'],
      notes:
        'Please deliver via the rear lane entrance. Call kitchen on arrival.',
      // Customer-side codes + free-text descriptions → AI fuzzy matches per
      // line, alias auto-writes on >=0.9, others sit in needs-review.
      lines: [
        { code: 'LG-301',  name: 'Coconut milk small can',  qty: 24, uom: 'cans',    pack: '2 cartons (12)' },
        { code: 'LG-302',  name: 'Coconut milk big can',    qty: 12, uom: 'cans',    pack: '1 carton (12)' },
        { code: 'LG-501',  name: 'Green curry paste',       qty: 12, uom: 'jars',    pack: '2 cartons (6)' },
        { code: 'LG-501-R', name: 'Red curry paste',         qty: 6,  uom: 'jars',    pack: '1 carton (6)' },
        { code: 'LG-701',  name: 'Fish sauce big',          qty: 6,  uom: 'bottles', pack: '1 carton (6)' },
        { code: 'LG-702',  name: 'Light soy sauce',         qty: 12, uom: 'bottles', pack: '2 cartons (6)' },
        { code: 'LG-901',  name: 'Rice noodles',            qty: 6,  uom: 'packets', pack: '1 carton (12)' },
        { code: 'LG-OTH',  name: 'Sweet corn 425g',         qty: 12, uom: 'cans',    pack: '1 carton (12)' },
      ],
    },
  },
  {
    kind: 'docx',
    filename: '07-spice-room-bulk-order.docx',
    spec: {
      company: 'THE SPICE ROOM',
      tagline: 'Modern Indian Kitchen · Melbourne',
      addressLines: ['88 Chapel St', 'Melbourne VIC 3141', 'procurement@thespiceroom.com.au'],
      poNumber: 'SR-04-2026',
      orderDate: '2026-05-19',
      requestedDate: '2026-05-30',
      buyer: 'Priya Iyer · Operations Manager',
      shipTo: ['The Spice Room', '88 Chapel St', 'Melbourne VIC 3141'],
      notes:
        'Please split this delivery — half by 30 May, the remainder by 6 June. Kitchen door access only between 10am and 2pm.',
      // Free-text descriptions, no customer codes → forces description-based
      // matching, which is lower confidence than code-based.
      lines: [
        { code: '', name: 'Pad Thai Sauce 200g',          qty: 24, uom: 'bottles', pack: '4 cartons (6)' },
        { code: '', name: 'Satay Sauce 250ml',            qty: 12, uom: 'bottles', pack: '2 cartons (6)' },
        { code: '', name: 'Crispy Chilli Oil 200g',       qty: 6,  uom: 'jars',    pack: '1 carton (6)' },
        { code: '', name: 'Sweet Chilli Sauce 435ml',     qty: 18, uom: 'bottles', pack: '3 cartons (6)' },
        { code: '', name: 'Oyster Sauce 210ml',           qty: 12, uom: 'bottles', pack: '2 cartons (6)' },
        { code: '', name: 'Fish Sauce 420ml',             qty: 6,  uom: 'bottles', pack: '1 carton (6)' },
        { code: '', name: 'Rice Noodles 200g',            qty: 24, uom: 'packets', pack: '2 cartons (12)' },
        { code: '', name: 'Coconut Milk 400ml',           qty: 12, uom: 'cans',    pack: '1 carton (12)' },
        { code: '', name: 'Sago Dessert 200g',            qty: 6,  uom: 'jars',    pack: '1 carton (6)' },
        { code: '', name: 'Sweet Corn Kernel 425g',       qty: 12, uom: 'cans',    pack: '1 carton (12)' },
        { code: '', name: 'Sardines in Black Bean Sauce 120g', qty: 6, uom: 'cans', pack: '1 carton (12)' },
        { code: '', name: 'Light Soy Sauce 210ml',        qty: 6,  uom: 'bottles', pack: '1 carton (6)' },
      ],
    },
  },
]

// ============================================================================
// PDF rendering (pdfkit)
// ============================================================================

function renderPdf(outPath, spec) {
  return new Promise((resolveDone, rejectDone) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 })
    const stream = createWriteStream(outPath)
    stream.on('finish', resolveDone)
    stream.on('error', rejectDone)
    doc.pipe(stream)

    // Letterhead
    doc.font('Helvetica-Bold').fontSize(18).text(spec.company, { align: 'left' })
    doc.font('Helvetica').fontSize(10).fillColor('#555').text(spec.tagline, { align: 'left' })
    doc.moveDown(0.4)
    doc.fontSize(9).fillColor('#333')
    for (const line of spec.addressLines) doc.text(line)
    doc.moveDown(0.8)

    // Divider rule
    doc.strokeColor('#333')
      .lineWidth(0.5)
      .moveTo(50, doc.y)
      .lineTo(545, doc.y)
      .stroke()
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

    // Line item table — manual since pdfkit has no table primitive
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

    // Notes
    if (spec.notes) {
      doc.font('Helvetica-Bold').fontSize(10).text('Notes')
      doc.font('Helvetica').fontSize(9).fillColor('#444').text(spec.notes, {
        width: 495,
      })
      doc.moveDown(1)
    }

    // Footer
    doc.fontSize(8).fillColor('#999').text(
      'Please confirm receipt by reply. Contact procurement for any substitutions.',
      { align: 'center' },
    )

    doc.end()
  })
}

// ============================================================================
// DOCX rendering (docx package)
// ============================================================================

function makeParagraph(text, opts = {}) {
  return new Paragraph({
    children: [
      new TextRun({
        text,
        bold: opts.bold,
        size: opts.size, // half-points (24 = 12pt)
        color: opts.color,
      }),
    ],
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
  const allBorders = { top: border, bottom: border, left: border, right: border }

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
        new TableCell({
          children: [makeParagraph(c, { size: 18 })],
          margins: cellPad,
        }),
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

async function renderDocx(outPath, spec) {
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
      spec.lines.map(line => [
        line.code || '—',
        line.name,
        String(line.qty),
        line.uom,
        line.pack,
      ]),
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
  writeFileSync(outPath, buffer)
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  // Ensure subdirs exist.
  mkdirSync(resolve(HERE, 'pdf'), { recursive: true })
  mkdirSync(resolve(HERE, 'docx'), { recursive: true })

  for (const sample of samples) {
    const subdir = sample.kind === 'pdf' ? 'pdf' : 'docx'
    const outPath = resolve(HERE, subdir, sample.filename)
    if (sample.kind === 'pdf') {
      await renderPdf(outPath, sample.spec)
    } else {
      await renderDocx(outPath, sample.spec)
    }
    // eslint-disable-next-line no-console -- this is a generator script, console output is the UX
    console.log(`Wrote ${subdir}/${sample.filename}`)
  }
}

main().catch(err => {
  // eslint-disable-next-line no-console
  console.error('Generator failed:', err)
  process.exit(1)
})
