#!/usr/bin/env node
// scripts/demo-video/encode.mjs
//
// Muxes the CC0 background track onto a silent screen recording to produce
// the guided cut's final mp4. Used as a library by record.mjs (--annotated
// calls muxMusic() directly after encoding the raw video) and standalone:
//
//   node scripts/demo-video/encode.mjs --in=raw.mp4 --out=guided.mp4 [--music=music/track.mp3]

import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import { existsSync } from 'node:fs'
import { runFfmpeg, probeVideo } from './ffmpegRun.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const DEFAULT_MUSIC = join(HERE, 'music', 'track.mp3')

const FADE_IN_SEC = 2
const FADE_OUT_SEC = 3
const MUSIC_VOLUME = 0.6

/**
 * @param {{ inPath: string, outPath: string, musicPath?: string }} opts
 */
export async function muxMusic({ inPath, outPath, musicPath = DEFAULT_MUSIC }) {
  if (!existsSync(inPath)) throw new Error(`Input video not found: ${inPath}`)
  if (!existsSync(musicPath)) throw new Error(`Music track not found: ${musicPath}`)

  const info = await probeVideo(inPath)
  if (!Number.isFinite(info.durationSec) || info.durationSec <= 0) {
    throw new Error(`Could not read a duration for ${inPath}`)
  }
  const fadeOutStart = Math.max(info.durationSec - FADE_OUT_SEC, 0)

  const audioFilter =
    `[1:a]volume=${MUSIC_VOLUME},afade=t=in:st=0:d=${FADE_IN_SEC},` +
    `afade=t=out:st=${fadeOutStart.toFixed(3)}:d=${FADE_OUT_SEC}[aout]`

  await runFfmpeg([
    '-i', inPath,
    '-stream_loop', '-1',
    '-i', musicPath,
    '-filter_complex', audioFilter,
    '-map', '0:v',
    '-map', '[aout]',
    '-c:v', 'copy',
    '-c:a', 'aac',
    '-b:a', '192k',
    '-shortest',
    outPath,
  ])
}

function parseArgs(argv) {
  const out = {}
  for (const arg of argv) {
    const m = arg.match(/^--([a-z]+)=(.*)$/)
    if (m) out[m[1]] = m[2]
  }
  return out
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  const args = parseArgs(process.argv.slice(2))
  if (!args.in || !args.out) {
    console.error('Usage: node encode.mjs --in=<raw.mp4> --out=<final.mp4> [--music=<track.mp3>]')
    process.exit(1)
  }
  const musicPath = args.music ? resolve(args.music) : DEFAULT_MUSIC
  muxMusic({ inPath: resolve(args.in), outPath: resolve(args.out), musicPath })
    .then(() => console.log(`Wrote ${args.out}`))
    .catch(err => {
      console.error(err instanceof Error ? err.message : err)
      process.exit(1)
    })
}
