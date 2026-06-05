// Generate sample PO documents (PDFs, DOCX, image) for end-to-end testing of
// the PO Inbox pipeline.
//
// Run with:  npm run po-fixtures
//
// Output layout:
//   tests/fixtures/po-samples/pdf/05-grand-hotel-auto-approve.pdf
//   tests/fixtures/po-samples/pdf/06-lotus-garden-multi-line.pdf
//   tests/fixtures/po-samples/docx/07-spice-room-bulk-order.docx
//   tests/fixtures/po-samples/image/08-harbour-view-cafe.png
//
// Rendering lives in render.mjs (shared with inject.mjs); the document specs
// live in specs.mjs. This script just writes the bytes to disk so you can
// attach them to a real test email if you prefer the manual path. To run the
// full AI pipeline without touching email, use `npm run po-inject` instead.

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { renderPdf, renderDocx, renderImagePo } from './render.mjs'
import {
  GRAND_HOTEL,
  LOTUS_GARDEN,
  SPICE_ROOM,
  HARBOUR_VIEW_IMAGE,
  GRAND_HOTEL_DEMO_PDF,
  GRAND_HOTEL_DEMO_DOCX,
  CAFE_DEMO_IMAGE,
  ZENITH_UNKNOWN,
} from './specs.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))

const samples = [
  { kind: 'pdf', filename: '05-grand-hotel-auto-approve.pdf', spec: GRAND_HOTEL },
  { kind: 'pdf', filename: '06-lotus-garden-multi-line.pdf', spec: LOTUS_GARDEN },
  { kind: 'docx', filename: '07-spice-room-bulk-order.docx', spec: SPICE_ROOM },
  { kind: 'image', filename: '08-harbour-view-cafe.png', spec: HARBOUR_VIEW_IMAGE },
  // Live-demo handout set (see DEMO.md). Written to demo/ so they're easy to attach.
  { kind: 'pdf', subdir: 'demo', filename: '01-grand-hotel-auto.pdf', spec: GRAND_HOTEL_DEMO_PDF },
  { kind: 'docx', subdir: 'demo', filename: '02-grand-hotel-auto.docx', spec: GRAND_HOTEL_DEMO_DOCX },
  { kind: 'image', subdir: 'demo', filename: '03-cafe-scan-review.png', spec: CAFE_DEMO_IMAGE },
  { kind: 'pdf', subdir: 'demo', filename: '04-zenith-unknown-review.pdf', spec: ZENITH_UNKNOWN },
]

const SUBDIR = { pdf: 'pdf', docx: 'docx', image: 'image' }

async function renderBytes(kind, spec) {
  if (kind === 'pdf') return renderPdf(spec)
  if (kind === 'docx') return renderDocx(spec)
  if (kind === 'image') return renderImagePo(spec)
  throw new Error(`unknown sample kind: ${kind}`)
}

async function main() {
  const dirs = new Set([...Object.values(SUBDIR), ...samples.map(s => s.subdir).filter(Boolean)])
  for (const subdir of dirs) {
    mkdirSync(resolve(HERE, subdir), { recursive: true })
  }

  for (const sample of samples) {
    const subdir = sample.subdir ?? SUBDIR[sample.kind]
    const outPath = resolve(HERE, subdir, sample.filename)
    const bytes = await renderBytes(sample.kind, sample.spec)
    writeFileSync(outPath, bytes)
    // eslint-disable-next-line no-console -- generator script; console output is the UX
    console.log(`Wrote ${subdir}/${sample.filename} (${bytes.length} bytes)`)
  }
}

main().catch(err => {
  // eslint-disable-next-line no-console
  console.error('Generator failed:', err)
  process.exit(1)
})
