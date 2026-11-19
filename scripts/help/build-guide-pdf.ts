// Prints the help centre's guide page to an A4 PDF (NX-0038).
//
//   npm run dev                                  # in another terminal
//   npm run guide:pdf                            # -> out/guides/…pdf
//   npm run guide:pdf -- --base=https://nexorder.vercel.app
//
// The PDF is the SAME page a reader sees at /help/print -- one source, two
// outputs. Page size, the full-bleed cover and the running footer all come
// from components/help/helpPrint.css (named @page rules), which is why this
// passes `preferCSSPageSize` and no margins of its own.
//
// Unlike scripts/build-hardware-report.ts there is no font inlining: that one
// renders with setContent and has no origin to load /fonts from; this one loads
// a real page over http.

import { chromium } from '@playwright/test'
import { mkdirSync, statSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

const OUT = resolve('out/guides/nexorder-receipt-putaway-guide.pdf')
/** An emailed guide should stay attachable; the screenshots dominate the size. */
const MAX_BYTES = 5 * 1024 * 1024

function argValue(name: string): string | undefined {
  return process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3)
}

async function main(): Promise<void> {
  const base = (argValue('base') ?? 'http://localhost:3000').replace(/\/+$/, '')
  const url = `${base}/help/print`
  console.log(`Printing ${url}`)

  const browser = await chromium.launch()
  try {
    const page = await browser.newPage()
    await page.goto(url, { waitUntil: 'networkidle' })
    await page.locator('[data-print-cover]').waitFor({ timeout: 30_000 })
    // Every image decoded and every font loaded, or the PDF captures a gap.
    await page.evaluate(async () => {
      await document.fonts.ready
      await Promise.all(Array.from(document.images).map((img) => img.decode().catch(() => undefined)))
    })
    const broken = await page.evaluate(() =>
      Array.from(document.images).filter((i) => !i.complete || i.naturalWidth === 0).map((i) => i.src),
    )
    if (broken.length) throw new Error(`Images failed to load: ${broken.join(', ')}`)

    mkdirSync(dirname(OUT), { recursive: true })
    await page.pdf({ path: OUT, printBackground: true, preferCSSPageSize: true })
  } finally {
    await browser.close()
  }

  const bytes = statSync(OUT).size
  console.log(`Wrote ${OUT} (${(bytes / 1024 / 1024).toFixed(2)} MB)`)
  if (bytes > MAX_BYTES) {
    throw new Error(`The guide is ${(bytes / 1024 / 1024).toFixed(1)} MB, over the 5 MB budget. Shrink the screenshots.`)
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
