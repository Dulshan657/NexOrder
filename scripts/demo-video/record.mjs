#!/usr/bin/env node
// scripts/demo-video/record.mjs
//
// Produces one of the two ~2:00 1920x1080 30fps sales-demo videos of the PO
// Inbox on the dev demo site:
//
//   node scripts/demo-video/record.mjs                 -> po-inbox-demo-silent.mp4
//   node scripts/demo-video/record.mjs --annotated      -> po-inbox-demo-guided.mp4
//
// Flow: launch headless Chromium at 1920x1080 -> sign in as the demo Admin
// and land on PO Inbox (NOT recorded — see login.mjs) -> start a CDP
// screencast -> drive the storyboard (storyboard.mjs) -> stop -> encode the
// captured frames to a constant-30fps mp4 (screencast.mjs) -> for the
// annotated cut, mux the CC0 background track on top (encode.mjs).
//
// See scripts/demo-video/README.md for the full command sequence, including
// the fixture seed/clean steps this script deliberately does not run itself
// (po-inject is out of scope here — see the top-level task notes).

import { chromium } from '@playwright/test'
import { mkdir, rm } from 'node:fs/promises'
import { resolve, join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { DEFAULT_BASE_URL, DEFAULT_OUT_DIR, VIEWPORT } from './config.mjs'
import { loginAndOpenPoInbox } from './login.mjs'
import { registerErpMockRoute } from './erpRoute.mjs'
import { runStoryboard } from './storyboard.mjs'
import { ScreenRecorder } from './screencast.mjs'
import { muxMusic } from './encode.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const OVERLAY_SCRIPT_PATH = join(HERE, 'overlay.js')

function parseArgs(argv) {
  const parsed = { annotated: false, out: DEFAULT_OUT_DIR, base: DEFAULT_BASE_URL }
  for (const arg of argv) {
    if (arg === '--annotated') parsed.annotated = true
    else if (arg.startsWith('--out=')) parsed.out = arg.slice('--out='.length)
    else if (arg.startsWith('--base=')) parsed.base = arg.slice('--base='.length)
  }
  return parsed
}

/**
 * Runs the full record -> capture -> encode pipeline once, against an
 * already-launched context/page. Exported so a smoke test can drive a
 * shorter storyboard through the same machinery without duplicating the
 * browser/recorder plumbing.
 *
 * @param {{
 *   page: import('@playwright/test').Page,
 *   baseUrl: string,
 *   outDir: string,
 *   annotated: boolean,
 *   storyboard: (page: import('@playwright/test').Page, opts: { annotated: boolean }) => Promise<void>,
 *   outFileName: string,
 * }} opts
 */
export async function recordOne({ page, baseUrl, outDir, annotated, storyboard, outFileName }) {
  console.log('[demo-video] logging in…')
  await loginAndOpenPoInbox(page, baseUrl)

  console.log('[demo-video] starting screencast…')
  const recorder = new ScreenRecorder(page)
  await recorder.start()
  try {
    await storyboard(page, { annotated, recorder })
  } finally {
    await recorder.stop()
  }

  const rawPath = annotated ? join(outDir, `.raw.${outFileName}`) : join(outDir, outFileName)
  console.log(
    `[demo-video] encoding ${recorder.frames.length} frames ` +
      `(~${recorder.wallClockDurationSec.toFixed(1)}s wall clock)…`,
  )
  await recorder.encode(rawPath)
  await recorder.cleanup()

  if (!annotated) {
    console.log(`[demo-video] wrote ${rawPath}`)
    return rawPath
  }

  const finalPath = join(outDir, outFileName)
  console.log('[demo-video] muxing music…')
  await muxMusic({ inPath: rawPath, outPath: finalPath })
  await rm(rawPath, { force: true })
  console.log(`[demo-video] wrote ${finalPath}`)
  return finalPath
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const outDir = resolve(args.out)
  await mkdir(outDir, { recursive: true })

  console.log(`[demo-video] mode=${args.annotated ? 'annotated' : 'silent'} base=${args.base} out=${outDir}`)

  // Headed on purpose: the headless shell has no PDF viewer, so the PO
  // Inbox's embedded PDF preview would render blank. The screencast captures
  // the page itself, so the window's size on the monitor does not matter.
  const browser = await chromium.launch({ headless: false })
  const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1 })
  // Re-injected fresh on every navigation (login page, the app, the ERP
  // mock page) — see overlay.js's own header comment.
  await context.addInitScript({ path: OVERLAY_SCRIPT_PATH })
  await registerErpMockRoute(context)
  const page = await context.newPage()

  try {
    const outFileName = args.annotated ? 'po-inbox-demo-guided.mp4' : 'po-inbox-demo-silent.mp4'
    await recordOne({
      page,
      baseUrl: args.base,
      outDir,
      annotated: args.annotated,
      storyboard: runStoryboard,
      outFileName,
    })
  } finally {
    await browser.close()
  }
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  main().catch(err => {
    console.error('[demo-video] failed:', err instanceof Error ? err.stack : err)
    process.exit(1)
  })
}
