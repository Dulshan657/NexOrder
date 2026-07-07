// Render the two Tridon hardware-demo POs to PDF, ready to email into the demo
// inbox.
//
//   npm run demo:tridon:pdfs
//
// Output (committed alongside this script so they're easy to attach to an email):
//   tridon-demo/tridon-sydney-auto.pdf     → auto-approves
//   tridon-demo/tridon-sydney-review.pdf   → held for review (one uncatalogued tool)
//
// Rendering reuses the shared pdfkit renderer from the fixtures toolchain so the
// demo POs look identical to the rest of the sample set.

import { writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { renderPdf } from '../tests/fixtures/po-samples/render.mjs'
import { TRIDON_SYDNEY_AUTO, TRIDON_SYDNEY_REVIEW } from './specs.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))

const samples = [
  { filename: 'tridon-sydney-auto.pdf', spec: TRIDON_SYDNEY_AUTO },
  { filename: 'tridon-sydney-review.pdf', spec: TRIDON_SYDNEY_REVIEW },
]

async function main() {
  for (const sample of samples) {
    const outPath = resolve(HERE, sample.filename)
    const bytes = await renderPdf(sample.spec)
    writeFileSync(outPath, bytes)
    console.log(`Wrote tridon-demo/${sample.filename} (${bytes.length} bytes)`)
  }
}

main().catch(err => {
  console.error('tridon-demo generate failed:', err)
  process.exit(1)
})
