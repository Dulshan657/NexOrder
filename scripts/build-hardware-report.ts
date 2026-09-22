// Render a markdown report into a branded, print-ready A4 PDF.
//
//   npm run report:hardware
//     → docs/hardware/NexOrder-Scan-Gun-Options-Amadiya.pdf
//
//   npm run report:hardware -- --in=docs/foo.md --out=docs/foo.pdf --title="..."
//
// `--html=<path>` also writes the intermediate document. The PDF is hard to
// inspect (Chromium compresses its font tables into object streams, so even
// `/BaseFont` greps lie about what embedded), and the HTML is the only
// artifact you can open and read directly when the output looks wrong.
//
// ── WHY THE MARKDOWN IS THE SOURCE ──────────────────────────────────────────
//
// The obvious way to produce a client PDF is to author it in a word processor.
// That gives you a file nobody can diff, review or regenerate, and a second
// copy of the same words that immediately starts drifting from the first.
//
// So the report lives as markdown in the repo — reviewable, greppable, and the
// single source of truth — and this script is the only thing that turns it into
// something you would send a client. Edit the markdown, re-run, and the PDF
// cannot disagree with it.
//
// ── WHY THE FONTS ARE INLINED AS BASE64 ─────────────────────────────────────
//
// Chromium will not load a `file://` font from a `data:`/`setContent` document
// — it is a cross-origin request from an opaque origin, and it fails silently,
// leaving the PDF in Times New Roman with no error anywhere. Inlining the
// woff2 bytes as data URIs sidesteps the origin question entirely and also
// means the build needs no network and no dev server.
//
// The `unicode-range` values are copied from index.css deliberately: the faces
// are variable and split latin / latin-ext, and dropping the ranges would make
// the browser pick one file and miss the other's glyphs.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import MarkdownIt from 'markdown-it'
import { chromium } from '@playwright/test'

const ROOT = resolve(import.meta.dirname, '..')

const DEFAULTS = {
  in: 'docs/hardware/scan-guns-for-amadiya.md',
  out: 'docs/hardware/NexOrder-Scan-Gun-Options-Amadiya.pdf',
  title: 'Handheld scanner options',
  subtitle: 'Hardware evaluation and purchasing recommendation',
  client: 'Amadiya Agro Products',
}

/** `--key=value` only. A bare `--key value` is rejected rather than half-read. */
function arg(name: string, fallback: string): string {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : fallback
}

/** A woff2 on disk as a data URI, or null if the file is absent. */
function fontDataUri(file: string): string | null {
  const path = resolve(ROOT, 'public/fonts', file)
  if (!existsSync(path)) return null
  return `data:font/woff2;base64,${readFileSync(path).toString('base64')}`
}

const LATIN =
  'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD'
const LATIN_EXT =
  'U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF'

interface FaceSpec {
  readonly family: string
  readonly file: string
  readonly weight: string
  readonly range: string
}

const FACES: readonly FaceSpec[] = [
  { family: 'DM Sans', file: 'dm-sans-latin.woff2', weight: '300 700', range: LATIN },
  { family: 'DM Sans', file: 'dm-sans-latin-ext.woff2', weight: '300 700', range: LATIN_EXT },
  { family: 'Plus Jakarta Sans', file: 'plus-jakarta-sans-latin.woff2', weight: '300 800', range: LATIN },
  { family: 'Plus Jakarta Sans', file: 'plus-jakarta-sans-latin-ext.woff2', weight: '300 800', range: LATIN_EXT },
  { family: 'JetBrains Mono', file: 'jetbrains-mono-latin.woff2', weight: '400 500', range: LATIN },
]

function fontFaceCss(): string {
  const blocks: string[] = []
  for (const face of FACES) {
    const uri = fontDataUri(face.file)
    if (!uri) {
      process.stderr.write(`[report] WARNING: missing font ${face.file} — falling back\n`)
      continue
    }
    blocks.push(
      `@font-face{font-family:'${face.family}';font-style:normal;` +
        `font-weight:${face.weight};src:url(${uri}) format('woff2');` +
        `unicode-range:${face.range};}`,
    )
  }
  return blocks.join('\n')
}

/**
 * Brand tokens, copied from index.css. Kept as literals rather than parsed out
 * of the stylesheet: this script must run with no build step and no Tailwind.
 */
const CSS = `
:root{
  --blue:#2988de; --blue-dark:#2472C2; --blue-light:#e8f2fc;
  --navy:#0A2E52; --charcoal:#1e293b; --charcoal-light:#334155;
  --stone-50:#fafaf9; --stone-100:#f5f5f4; --stone-200:#e7e5e4;
  --stone-300:#d6d3d1; --stone-600:#57534e; --stone-700:#44403c;
}
@page{ size:A4; margin:18mm 16mm 20mm 16mm; }
*{ box-sizing:border-box; }
html,body{ margin:0; padding:0; }
body{
  font-family:'DM Sans',ui-sans-serif,system-ui,sans-serif;
  font-size:9.6pt; line-height:1.55; color:var(--charcoal);
  -webkit-font-smoothing:antialiased;
}

/* ── Cover ───────────────────────────────────────────────────────────── */
.cover{
  break-after:page;
  height:255mm;                 /* A4 (297mm) less the 18+20mm print margins, with slack */
  display:flex; flex-direction:column; justify-content:space-between;
}
.cover-rule{ height:6px; background:var(--blue); border-radius:3px; width:96px; }
.cover-brand{
  font-family:'Plus Jakarta Sans',sans-serif; font-weight:800;
  font-size:13pt; letter-spacing:-0.01em; color:var(--navy);
}
.cover-brand span{ color:var(--blue); }
.cover-tag{
  font-size:8pt; letter-spacing:0.16em; text-transform:uppercase;
  color:var(--stone-600); margin-top:4px;
}
.cover h1{
  font-family:'Plus Jakarta Sans',sans-serif; font-weight:800;
  font-size:31pt; line-height:1.1; letter-spacing:-0.025em;
  color:var(--navy); margin:0 0 10px;
}
.cover .sub{ font-size:12.5pt; color:var(--charcoal-light); margin:0; max-width:120mm; }
.cover-meta{ border-top:1px solid var(--stone-200); padding-top:14px; font-size:9pt; }
.cover-meta dl{ display:grid; grid-template-columns:auto 1fr; gap:5px 18px; margin:0; }
.cover-meta dt{ color:var(--stone-600); }
.cover-meta dd{ margin:0; font-weight:500; }

/* ── Flow ────────────────────────────────────────────────────────────── */
h1,h2,h3{ font-family:'Plus Jakarta Sans',sans-serif; letter-spacing:-0.015em; color:var(--navy); }
h2{
  font-size:16pt; font-weight:800; margin:0 0 14px;
  padding-bottom:7px; border-bottom:2px solid var(--blue);
  break-after:avoid;
}
/* Each numbered section opens a page. The cover already broke, so the first
   heading must not break again or page 2 comes out blank. */
.body h2{ break-before:page; }
.body h2:first-of-type{ break-before:auto; }
h3{ font-size:11.5pt; font-weight:700; margin:20px 0 7px; break-after:avoid; }
h4{ font-family:'Plus Jakarta Sans',sans-serif; font-size:10pt; margin:16px 0 6px; break-after:avoid; }
p{ margin:0 0 9px; }
strong{ font-weight:700; color:var(--navy); }
em{ color:var(--charcoal-light); }
a{ color:var(--blue-dark); text-decoration:none; }
ul,ol{ margin:0 0 10px; padding-left:19px; }
li{ margin-bottom:4px; }
hr{ border:0; border-top:1px solid var(--stone-200); margin:20px 0; }

/* ── Tables ──────────────────────────────────────────────────────────── */
table{
  width:100%; border-collapse:collapse; margin:10px 0 14px;
  font-size:8.4pt; break-inside:avoid;
}
thead th{
  background:var(--navy); color:#fff; font-family:'Plus Jakarta Sans',sans-serif;
  font-weight:700; font-size:8.2pt; text-align:left;
  padding:7px 8px; vertical-align:bottom;
}
/* A bold cell is navy everywhere else, which on the navy header row renders the
   column names invisible. The comparison matrix bolds every device name, so
   this is not a cosmetic nicety -- without it the table has no headings. */
thead th strong{ color:#fff; }
thead th em{ color:var(--blue-light); font-style:normal; opacity:0.85; }
tbody td{ padding:6px 8px; border-bottom:1px solid var(--stone-200); vertical-align:top; }
tbody tr:nth-child(even) td{ background:var(--stone-50); }
tbody td:first-child{ font-weight:500; color:var(--navy); }
tbody tr{ break-inside:avoid; }
/* A two-column table is a spec sheet, not data: give the label column a tint. */
table.spec tbody td:first-child{ background:var(--blue-light); width:33%; }

code{
  font-family:'JetBrains Mono',ui-monospace,monospace; font-size:8.2pt;
  background:var(--stone-100); padding:1px 4px; border-radius:3px;
  color:var(--charcoal-light);
}

blockquote{
  margin:12px 0; padding:9px 14px;
  background:var(--blue-light); border-left:3px solid var(--blue);
  border-radius:0 4px 4px 0;
}
blockquote p:last-child{ margin-bottom:0; }
`

const FOOTER = `
<div style="width:100%;font-family:'DM Sans',sans-serif;font-size:7pt;color:#78716c;
            padding:0 16mm;display:flex;justify-content:space-between;">
  <span>NexGen Innovations &middot; __TITLE__</span>
  <span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span>
</div>`

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

async function main(): Promise<void> {
  const inPath = resolve(ROOT, arg('in', DEFAULTS.in))
  const outPath = resolve(ROOT, arg('out', DEFAULTS.out))
  const title = arg('title', DEFAULTS.title)
  const subtitle = arg('subtitle', DEFAULTS.subtitle)
  const client = arg('client', DEFAULTS.client)

  if (!existsSync(inPath)) {
    process.stderr.write(`[report] no such markdown file: ${inPath}\n`)
    process.exit(1)
  }

  const raw = readFileSync(inPath, 'utf8')

  // The markdown's own H1 and its byline become the cover; everything from the
  // first `---` onward is the body. Authoring the cover separately would mean
  // the .md read as a headless fragment on its own, which defeats the point of
  // it being the readable source.
  const firstRule = raw.indexOf('\n---\n')
  const body = firstRule === -1 ? raw : raw.slice(firstRule + 5)

  const md = new MarkdownIt({ html: true, linkify: true, typographer: true })
  const rendered = md.render(body)

  // Tag two-column tables so the stylesheet can treat them as spec sheets.
  const withSpecTables = rendered.replace(
    /<table>\s*<thead>\s*<tr>\s*<th[^>]*><\/th>\s*<th[^>]*><\/th>\s*<\/tr>\s*<\/thead>/g,
    '<table class="spec"><thead><tr><th></th><th></th></tr></thead>',
  )

  const today = new Date().toLocaleDateString('en-AU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })

  const html = `<!DOCTYPE html>
<html lang="en-AU"><head><meta charset="utf-8">
<title>${esc(title)}</title>
<style>${fontFaceCss()}</style>
<style>${CSS}</style>
</head><body>
  <section class="cover">
    <div>
      <div class="cover-rule"></div>
      <div class="cover-brand" style="margin-top:14px;">NexGen <span>Innovations</span></div>
      <div class="cover-tag">Nex Order &middot; Warehouse module</div>
    </div>
    <div>
      <h1>${esc(title)}</h1>
      <p class="sub">${esc(subtitle)}</p>
    </div>
    <div class="cover-meta">
      <dl>
        <dt>Prepared for</dt><dd>${esc(client)}</dd>
        <dt>Prepared by</dt><dd>NexGen Innovations</dd>
        <dt>Date</dt><dd>${esc(today)}</dd>
        <dt>Status</dt><dd>For management decision &middot; prices indicative, quotation required</dd>
      </dl>
    </div>
  </section>
  <main class="body">${withSpecTables}</main>
</body></html>`

  mkdirSync(dirname(outPath), { recursive: true })

  const htmlPath = arg('html', '')
  if (htmlPath) {
    const p = resolve(ROOT, htmlPath)
    mkdirSync(dirname(p), { recursive: true })
    writeFileSync(p, html, 'utf8')
    process.stdout.write(`[report] html -> ${p}
`)
  }

  const browser = await chromium.launch()
  try {
    const page = await browser.newPage()
    await page.setContent(html, { waitUntil: 'load' })
    // setContent resolves before webfonts are laid out; without this the first
    // render can be measured in the fallback face and paginate differently.
    await page.evaluate(() => document.fonts.ready)
    await page.pdf({
      path: outPath,
      format: 'A4',
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: '<span></span>',
      footerTemplate: FOOTER.replace('__TITLE__', esc(title)),
      margin: { top: '18mm', right: '16mm', bottom: '20mm', left: '16mm' },
    })
  } finally {
    await browser.close()
  }

  process.stdout.write(`[report] ${inPath}\n[report] -> ${outPath}\n`)
}

main().catch((err) => {
  process.stderr.write(`[report] failed: ${err instanceof Error ? err.message : String(err)}\n`)
  process.exit(1)
})
