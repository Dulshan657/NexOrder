// scripts/demo-video/ffmpegPath.mjs
//
// Resolves the ffmpeg / ffprobe binaries for the demo-video pipeline.
//
// ffmpeg 9 is installed via WinGet at a path outside the default child-process
// PATH, so a bare `spawn('ffmpeg', …)` fails here even though `ffmpeg -version`
// works in an interactive shell. Resolution order, each checked by actually
// running `-version` rather than just existsSync (a stale symlink or a wrong
// architecture binary would otherwise fail much later, mid-encode):
//
//   1. FFMPEG_PATH / FFPROBE_PATH env var override
//   2. the known WinGet Links path
//   3. bare 'ffmpeg' / 'ffprobe' (already on PATH)

import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'

const WINGET_LINKS = process.env.LOCALAPPDATA
  ? `${process.env.LOCALAPPDATA}\\Microsoft\\WinGet\\Links`
  : null

/**
 * @param {string} envVar
 * @param {string} binaryName - 'ffmpeg' or 'ffprobe'
 * @returns {string}
 */
function resolveBinary(envVar, binaryName) {
  const candidates = [
    process.env[envVar],
    WINGET_LINKS ? `${WINGET_LINKS}\\${binaryName}.exe` : null,
    binaryName,
  ].filter(Boolean)

  for (const candidate of candidates) {
    if (candidate !== binaryName && !existsSync(candidate)) continue
    const result = spawnSync(candidate, ['-version'], { stdio: 'ignore' })
    if (result.status === 0) return candidate
  }

  throw new Error(
    `Could not resolve a working ${binaryName} binary. Tried: ${candidates.join(', ')}. ` +
      `Set ${envVar} explicitly if it lives somewhere else.`,
  )
}

export const FFMPEG_PATH = resolveBinary('FFMPEG_PATH', 'ffmpeg')
export const FFPROBE_PATH = resolveBinary('FFPROBE_PATH', 'ffprobe')
