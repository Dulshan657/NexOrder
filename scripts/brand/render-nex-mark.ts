// npm run brand:nex-mark - the Nex mark's campaign assets (NX-0011).
//
// Writes the SVG masters to brand/nex-mark/ (committed: they are the source a
// designer opens) and renders, into brand/nex-mark/dist/ (gitignored):
//
//   nex-mark-512.gif, nex-mark-1080.gif   the animated loop, palette-optimised
//   nex-mark-1080.mp4                     the same loop, H.264
//   nex-mark-{disc,bare}-{64..1024}.png   the finished mark, transparent
//
// Frames are rendered by Playwright and stepped deterministically: every CSS
// animation is paused and seeked to the frame's time, so no frame depends on how
// fast this machine is. Needs ffmpeg on PATH for the GIFs and the MP4.

import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'
import type { Page } from '@playwright/test'
import { LOOP_S, bareSvg, discSvg } from './nexMarkSvg'
import { NEX_MARK_COLOURS } from '../../components/voice/nexMarkGeometry'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const OUT = join(ROOT, 'brand', 'nex-mark')
const DIST = join(OUT, 'dist')
const PNG_SIZES = [64, 128, 256, 512, 1024]
const BACKGROUND = '#ffffff'

function requireFfmpeg(): void {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' })
  } catch {
    throw new Error('ffmpeg is not on PATH. Install it (winget install Gyan.FFmpeg) and re-run.')
  }
}

function writeMasters(): void {
  mkdirSync(DIST, { recursive: true })
  writeFileSync(join(OUT, 'nex-mark.svg'), discSvg(true))
  writeFileSync(join(OUT, 'nex-mark-static.svg'), discSvg(false))
  writeFileSync(join(OUT, 'nex-mark-bare.svg'), bareSvg(true))
  writeFileSync(join(OUT, 'nex-mark-bare-static.svg'), bareSvg(false))
  writeFileSync(join(OUT, 'nex-mark-bare-dark-static.svg'), bareSvg(false, NEX_MARK_COLOURS.bareDark))
}

async function load(page: Page, markup: string, px: number, background: string): Promise<void> {
  await page.setViewportSize({ width: px, height: px })
  await page.setContent(
    `<!doctype html><html><body style="margin:0;background:${background}">` +
      `<div id="m" style="width:${px}px;height:${px}px">${markup.replace('<svg ', `<svg width="${px}" height="${px}" `)}</div></body></html>`,
  )
}

async function renderPngs(page: Page): Promise<void> {
  for (const [name, markup] of [
    ['disc', discSvg(false)],
    ['bare', bareSvg(false)],
  ] as const) {
    for (const px of PNG_SIZES) {
      await load(page, markup, px, 'transparent')
      await page.locator('#m').screenshot({ path: join(DIST, `nex-mark-${name}-${px}.png`), omitBackground: true })
    }
  }
}

/** Render one loop at `fps` into a fresh directory; returns it. */
async function renderFrames(page: Page, px: number, fps: number): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), 'nex-mark-'))
  await load(page, discSvg(true), px, BACKGROUND)
  const frames = Math.round(LOOP_S * fps)
  for (let i = 0; i < frames; i += 1) {
    const ms = (i * 1000) / fps
    await page.evaluate((t: number) => {
      for (const a of document.getAnimations()) {
        a.pause()
        a.currentTime = t
      }
    }, ms)
    await page.locator('#m').screenshot({ path: join(dir, `f${String(i).padStart(4, '0')}.png`) })
  }
  return dir
}

function encodeGif(frames: string, fps: number, out: string): void {
  const input = ['-y', '-framerate', String(fps), '-i', join(frames, 'f%04d.png')]
  const palette = join(frames, 'palette.png')
  execFileSync('ffmpeg', [...input, '-vf', 'palettegen=stats_mode=diff', palette], { stdio: 'ignore' })
  execFileSync(
    'ffmpeg',
    [...input, '-i', palette, '-lavfi', 'paletteuse=dither=sierra2_4a', '-loop', '0', out],
    { stdio: 'ignore' },
  )
}

function encodeMp4(frames: string, fps: number, out: string): void {
  execFileSync(
    'ffmpeg',
    ['-y', '-framerate', String(fps), '-i', join(frames, 'f%04d.png'), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '16', '-movflags', '+faststart', out],
    { stdio: 'ignore' },
  )
}

async function main(): Promise<void> {
  requireFfmpeg()
  writeMasters()
  const browser = await chromium.launch()
  const page = await browser.newPage()
  try {
    await renderPngs(page)
    for (const px of [512, 1080]) {
      const gifFrames = await renderFrames(page, px, 30)
      encodeGif(gifFrames, 30, join(DIST, `nex-mark-${px}.gif`))
      rmSync(gifFrames, { recursive: true, force: true })
    }
    const mp4Frames = await renderFrames(page, 1080, 60)
    encodeMp4(mp4Frames, 60, join(DIST, 'nex-mark-1080.mp4'))
    rmSync(mp4Frames, { recursive: true, force: true })
  } finally {
    await browser.close()
  }
  console.log(`[brand:nex-mark] masters in ${OUT}, renders in ${DIST}`)
}

main().catch((error: unknown) => {
  console.error('[brand:nex-mark] failed:', error instanceof Error ? error.message : error)
  process.exit(1)
})
