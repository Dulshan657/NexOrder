// Build a printable Code 128 test sheet from REAL codes in the demo database.
//
//   npm run scan:sheet          → writes scan-gun-test-sheet.html at the repo root
//
// ── WHY THIS USES THE APP'S OWN ENCODER ─────────────────────────────────────
//
// It would be easier to render these with an online barcode generator. That
// would also make the sheet worthless as a test: if our encoder had a bug, a
// sheet drawn by someone else's would scan perfectly and tell us nothing.
//
// Drawing it with `_shared/labels/code128.ts` means a successful scan proves
// the encoder, the check digit, the Set B/C switching and the quiet zones — the
// same code path that renders the real Avery labels, minus only pdf-lib. That
// is why this is a `.ts` run through tsx rather than a `.mjs`: it must import
// the actual module, not a copy of it.
//
// The codes are read live from the demo so the sheet can never drift from the
// database. A sticker for a bin that no longer exists is worse than no sticker.

import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { encodeCode128, darkRuns, QUIET_ZONE_MODULES } from '../supabase/functions/_shared/labels/code128'
import { CALIBRATION_WIDTHS_MM } from '../supabase/functions/_shared/labels/sizing'
import { requireDevTarget, orExitAsync } from './lib/fixtureGuard.mjs'
import { runSql } from './lib/managementApi.mjs'

/**
 * Module width for the main sheet.
 *
 * `MIN_X_FOR_DISTANCE.arms_length` in sizing.ts is 0.33 mm. 0.40 gives an
 * honest margin over that on a domestic laser printer, whose toner spread is
 * worse than the label printer these are normally rendered for. The ladder at
 * the bottom is where the real limit gets found.
 */
const SHEET_X_MM = 0.4
const BAR_HEIGHT_MM = 14

interface Item {
  readonly code: string
  readonly note: string
}

interface Section {
  readonly title: string
  readonly blurb: string
  readonly items: readonly Item[]
  readonly xMm?: number
}

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/**
 * One barcode as inline SVG, sized in millimetres so it prints at a known
 * physical scale regardless of screen DPI.
 *
 * The viewBox is in MODULES, so the browser does the scaling and every bar
 * lands on an exact multiple of the module width — the same reason
 * generate-labels multiplies from a shared origin instead of accumulating.
 */
function barcodeSvg(code: string, xMm: number): string {
  let symbol
  try {
    symbol = encodeCode128(code)
  } catch (e) {
    return `<p class="unencodable">Cannot encode <code>${esc(code)}</code>: ${esc(
      e instanceof Error ? e.message : String(e),
    )}</p>`
  }

  const total = symbol.modules + 2 * QUIET_ZONE_MODULES
  const widthMm = total * xMm
  // Bar height in viewBox units, so the aspect ratio survives the mm scaling.
  const heightUnits = BAR_HEIGHT_MM / xMm

  const rects = darkRuns(symbol)
    .map(
      (run) =>
        `<rect x="${QUIET_ZONE_MODULES + run.start}" y="0" width="${run.width}" height="${heightUnits}"/>`,
    )
    .join('')

  return (
    `<svg class="bc" width="${widthMm.toFixed(2)}mm" height="${BAR_HEIGHT_MM}mm" ` +
    `viewBox="0 0 ${total} ${heightUnits.toFixed(2)}" preserveAspectRatio="none" ` +
    `shape-rendering="crispEdges" role="img" aria-label="Code 128: ${esc(code)}">` +
    `<rect x="0" y="0" width="${total}" height="${heightUnits.toFixed(2)}" fill="#fff"/>` +
    `<g fill="#000">${rects}</g></svg>`
  )
}

function renderItem(item: Item, xMm: number): string {
  return (
    `<figure class="label">${barcodeSvg(item.code, xMm)}` +
    `<figcaption><span class="code">${esc(item.code)}</span>` +
    `<span class="note">${esc(item.note)}</span></figcaption></figure>`
  )
}

function renderSection(section: Section): string {
  const x = section.xMm ?? SHEET_X_MM
  return (
    `<section><h2>${esc(section.title)}</h2><p class="blurb">${section.blurb}</p>` +
    `<div class="grid">${section.items.map((i) => renderItem(i, x)).join('')}</div></section>`
  )
}

async function main(): Promise<void> {
  const target = await requireDevTarget({ require: ['SUPABASE_ACCESS_TOKEN'] })

  // Locations that actually hold stock, so a scan on the test sheet lands on a
  // bin the Stocktake screen will have something to show for.
  const bins = await runSql(
    target,
    `SELECT l.code, l.kind, count(*) AS skus
       FROM public.inventory_balances ib
       JOIN public.locations l ON l.id = ib.location_id
      WHERE ib.on_hand > 0 AND l.is_active
      GROUP BY l.code, l.kind
      ORDER BY count(*) DESC, l.code
      LIMIT 8`,
  )

  const warehouses = await runSql(
    target,
    `SELECT code, name FROM public.locations WHERE kind = 'WAREHOUSE' AND is_active ORDER BY id LIMIT 4`,
  )

  const plates = await runSql(
    target,
    `SELECT code, hu_type FROM public.handling_units WHERE status IN ('open','stored') ORDER BY id DESC LIMIT 6`,
  )

  const withBarcode = await runSql(
    target,
    `SELECT sku, name, barcode FROM public.products
      WHERE is_active AND barcode ~ '^[0-9]+$'
      ORDER BY id LIMIT 8`,
  )

  const skus = await runSql(
    target,
    `SELECT sku, name FROM public.products WHERE is_active ORDER BY id LIMIT 6`,
  )

  // The longest code on site, which is what the calibration ladder is measured
  // against — a bar width narrow enough for the longest code is narrow enough
  // for every other one.
  //
  // Throwaway test sites are excluded. The demo carries codes like
  // `TEST-B-339b6e4a-2-1-L26`, a UUID fragment left by an automated run, and
  // calibrating against one would set the label stock for a code that will
  // never be printed and never be scanned.
  const longest = await runSql(
    target,
    `SELECT code FROM public.locations
      WHERE is_active
        AND code !~ '[0-9a-f]{8}'
        AND code NOT LIKE 'TEST%'
        AND code NOT LIKE 'E2E%'
      ORDER BY length(code) DESC, code
      LIMIT 1`,
  )
  const longestCode: string = longest[0]?.code ?? 'AMD-B-12-7-L3'

  const sections: Section[] = [
    {
      title: '1 · Bins that hold stock',
      blurb:
        'Scan one of these on the <strong>Stocktake</strong> screen. Each already has stock in it, ' +
        'so the count sheet will have lines to show. The grey line under each code is the location kind and how many SKUs it holds.',
      items: bins.map((b: any) => ({ code: b.code, note: `${b.kind} · ${b.skus} SKU(s)` })),
    },
    {
      title: '2 · Warehouse roots',
      blurb:
        'A site root is the legal destination for a <strong>receipt</strong>. Scanning one on Receive Stock ' +
        'switches the destination. Scanning a <em>bin</em> there is refused on purpose — stock reaches a bin ' +
        'through Putaway, never through a receipt.',
      items: warehouses.map((w: any) => ({ code: w.code, note: w.name })),
    },
    {
      title: '3 · Pallets and cartons',
      blurb:
        'Handling units. Scan one on the <strong>Putaway</strong> finder — it should jump straight to the ' +
        'queued line for that plate, or say that nothing is waiting on it.',
      items: plates.map((p: any) => ({ code: p.code, note: p.hu_type })),
    },
    {
      title: '4 · Product SKUs',
      blurb: 'Our own identifier, and what the app prints on a product label. Scan on Receive Stock to add a line.',
      items: skus.map((p: any) => ({ code: p.sku, note: p.name })),
    },
    {
      title: '5 · Supplier barcodes (EAN-13 / UPC-A)',
      blurb:
        'Seeded by <code>npm run seed:barcodes:dev</code>. These exercise <code>barcodeVariants</code> — ' +
        'the GTIN folding that makes a 12-digit UPC-A and its 13-digit EAN-13 spelling the same item.',
      items: withBarcode.map((p: any) => ({
        code: p.barcode,
        note: `${p.sku} · ${p.name}`,
      })),
    },
    {
      title: '6 · The same item, spelled three ways',
      blurb:
        'All three of these should resolve to <strong>one product</strong>. This is the single most ' +
        'intricate branch in the resolver and it has never been tested with a real beam. If any one of ' +
        'them resolves to a different product, or to nothing, that is a real bug.',
      items: gtinSpellings(withBarcode),
    },
    {
      title: '7 · Codes that should FAIL',
      blurb:
        'A test that only proves the happy path proves very little. Each of these should be refused with a ' +
        'specific sentence, not a silent no-op and not a generic error.',
      items: [
        { code: 'NOT-A-REAL-CODE', note: 'unknown → "nothing matches…"' },
        { code: 'HU-999999', note: 'plate that does not exist' },
        { code: '9312000099999', note: 'well-formed EAN-13, no such product' },
      ],
    },
  ]

  const ladder: Section[] = CALIBRATION_WIDTHS_MM.map((mm: number) => ({
    title: `${mm.toFixed(2)} mm`,
    blurb: '',
    items: [{ code: longestCode, note: `${mm.toFixed(2)} mm per module` }],
    xMm: mm,
  }))

  const html = page(sections, ladder, longestCode, target.name)
  const out = resolve(process.cwd(), 'scan-gun-test-sheet.html')
  writeFileSync(out, html, 'utf8')
  process.stdout.write(`[scan:sheet] wrote ${out}\n`)
  process.stdout.write(`[scan:sheet] ${sections.reduce((n, s) => n + s.items.length, 0)} codes + ${ladder.length} calibration rows\n`)
  process.stdout.write('[scan:sheet] open it in a browser and print at 100% (NOT "fit to page")\n')
}

/**
 * The folding demonstration: one product's barcode written at every GTIN width
 * it is equivalent to.
 *
 * Deliberately built from a UPC-A if one is present, because a 12↔13 pair is
 * the case that actually differs — an EAN-13 padded to 14 is the same string
 * with a zero on the front and proves less.
 */
function gtinSpellings(products: readonly any[]): Item[] {
  const upc = products.find((p) => String(p.barcode).length === 12)
  const source = upc ?? products[0]
  if (!source) return []
  const bare = String(source.barcode).replace(/^0+/, '')
  const widths = [12, 13, 14]
  return widths
    .filter((w) => bare.length <= w)
    .map((w) => ({
      code: bare.padStart(w, '0'),
      note: `${w}-digit spelling of ${source.sku}`,
    }))
}

function page(
  sections: readonly Section[],
  ladder: readonly Section[],
  longestCode: string,
  targetName: string,
): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Nex Order — scan gun test sheet</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 12mm 10mm;
    font-family: -apple-system, "Segoe UI", system-ui, sans-serif;
    color: #1c1917; background: #fff;
  }
  h1 { font-size: 20pt; margin: 0 0 2mm; }
  .sub { color: #57534e; font-size: 9pt; margin: 0 0 6mm; }
  section { margin: 0 0 8mm; break-inside: avoid; }
  h2 { font-size: 12pt; margin: 0 0 1mm; border-bottom: 1px solid #d6d3d1; padding-bottom: 1mm; }
  .blurb { font-size: 8.5pt; color: #57534e; margin: 0 0 3mm; line-height: 1.45; }
  .grid { display: flex; flex-wrap: wrap; gap: 4mm 6mm; }
  .label { margin: 0; break-inside: avoid; page-break-inside: avoid; }
  .bc { display: block; }
  figcaption { display: flex; flex-direction: column; margin-top: 1mm; }
  .code { font-family: "JetBrains Mono", ui-monospace, Consolas, monospace; font-size: 9pt; font-weight: 700; }
  .note { font-size: 7.5pt; color: #78716c; }
  .unencodable { color: #b91c1c; font-size: 9pt; }
  .ladder .grid { flex-direction: column; gap: 3mm; }
  .ladder h2 { border: 0; font-size: 9pt; margin: 0; }
  .ladder section { margin: 0 0 3mm; }
  .box { border: 1px solid #d6d3d1; border-radius: 2mm; padding: 4mm; margin: 0 0 6mm; font-size: 9pt; line-height: 1.5; }
  .box strong { display: block; margin-bottom: 1mm; }
  code { font-family: ui-monospace, Consolas, monospace; background: #f5f5f4; padding: 0 1mm; border-radius: 1mm; }
  @media print {
    body { padding: 8mm; }
    .noprint { display: none; }
  }
</style>
</head>
<body>
<h1>Scan gun test sheet</h1>
<p class="sub">
  Code 128, rendered by the app's own encoder
  (<code>supabase/functions/_shared/labels/code128.ts</code>) from live codes in the
  <strong>${esc(targetName)}</strong> database. A successful scan therefore proves the encoder,
  not just the gun.
</p>

<div class="box noprint">
  <strong>Print at 100%.</strong>
  In the print dialog set Scale to 100% or "Actual size" — <em>never</em> "Fit to page", which silently
  changes the bar width and invalidates the calibration ladder at the bottom. Plain white paper, and
  avoid draft/toner-save mode: it thins the bars.
</div>

${sections.map(renderSection).join('\n')}

<section class="ladder">
  <h2>8 · Calibration ladder — find your gun's limit</h2>
  <p class="blurb">
    The same code (<code>${esc(longestCode)}</code>, the longest on site) at each of the six widths in
    <code>CALIBRATION_WIDTHS_MM</code>. Scan from the top down and note the narrowest one that reads
    <strong>first time, at the distance you actually work at</strong>. That figure is what to choose
    label stock against — <code>lib/labels/sizing.ts</code> refuses anything below 0.25&nbsp;mm outright,
    and wants 0.33&nbsp;mm at arm's length and 1.0&nbsp;mm down an aisle.
  </p>
  ${ladder.map((l) => `<section><h2>${esc(l.title)}</h2><div class="grid">${l.items.map((i) => renderItem(i, l.xMm!)).join('')}</div></section>`).join('\n')}
</section>

</body>
</html>
`
}

await orExitAsync(main)
