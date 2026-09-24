// scripts/demo-video/screencast.mjs
//
// Captures a Chromium tab via CDP Page.startScreencast and turns the result
// into a constant-30fps H.264 mp4.
//
// Screencast only emits a new frame when the page actually repaints, so the
// frame count says nothing about elapsed time — two frames five seconds
// apart (an idle moment with no animation) are as valid as two frames five
// milliseconds apart. The fix is to never assume a frame rate on the way in:
// every captured frame gets a `duration` in the ffmpeg concat demuxer's
// input list equal to the gap to the *next* frame's timestamp, and only the
// final `-r 30` output stage resamples that variable-duration slideshow to a
// constant rate. That's what keeps an idle page's video duration matching
// wall-clock time instead of collapsing to "however many frames arrived".
//
// CDP's screencastFrame.metadata.timestamp is Unix seconds — the same clock
// as Date.now() / 1000 — so wall-clock deltas and frame-to-frame deltas are
// directly comparable.

import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runFfmpeg } from './ffmpegRun.mjs'
import { VIEWPORT, FPS } from './config.mjs'

/** Frame held at the very end once the storyboard stops driving the page. */
const MIN_TAIL_HOLD_SEC = 1.0

export class ScreenRecorder {
  /** @param {import('@playwright/test').Page} page */
  constructor(page) {
    this.page = page
    /** @type {{ file: string, timestamp: number }[]} */
    this.frames = []
    this.frameDir = null
    this.session = null
    this.frameIndex = 0
    this.running = false
    this._pendingWrites = []
  }

  async start() {
    this.frameDir = await mkdtemp(join(tmpdir(), 'nexorder-demo-frames-'))
    await this._attach()
    this.running = true
  }

  /**
   * Re-attach after a navigation to another origin. Site isolation moves the
   * tab to a new renderer process, and the old screencast silently stops
   * emitting frames — the video would freeze on the last frame of the old
   * page. Call this right after such a page.goto().
   */
  async restart() {
    if (!this.running) return
    await this.session?.send('Page.stopScreencast').catch(() => {})
    await this.session?.detach().catch(() => {})
    await this._attach()
  }

  async _attach() {
    this.session = await this.page.context().newCDPSession(this.page)
    this.session.on('Page.screencastFrame', frame => this._onFrame(frame))
    await this.session.send('Page.startScreencast', {
      format: 'jpeg',
      quality: 95,
      maxWidth: VIEWPORT.width,
      maxHeight: VIEWPORT.height,
      everyNthFrame: 1,
    })
  }

  _onFrame(frame) {
    const idx = this.frameIndex++
    const file = join(this.frameDir, `frame-${String(idx).padStart(6, '0')}.jpg`)
    const write = writeFile(file, Buffer.from(frame.data, 'base64')).then(() => {
      this.frames.push({ file, timestamp: frame.metadata.timestamp })
    })
    this._pendingWrites.push(write)
    // Must ack every frame or the browser stops sending more.
    this.session.send('Page.screencastFrameAck', { sessionId: frame.sessionId }).catch(() => {})
  }

  /** Stop capturing. Safe to call once; further frames are ignored. */
  async stop() {
    if (!this.running) return
    this.running = false
    await this.session.send('Page.stopScreencast').catch(() => {})
    this.stopWallClockSec = Date.now() / 1000
    await Promise.all(this._pendingWrites)
    this.frames.sort((a, b) => a.timestamp - b.timestamp)
  }

  /**
   * Encode the captured frames into a constant-FPS mp4 at `outPath`.
   * @param {string} outPath
   */
  async encode(outPath) {
    if (this.running) throw new Error('call stop() before encode()')
    if (this.frames.length === 0) {
      throw new Error(
        'No screencast frames were captured — the page may never have repainted, or CDP screencast failed to start.',
      )
    }

    const listPath = join(this.frameDir, 'concat.txt')
    const lines = []
    for (let i = 0; i < this.frames.length; i++) {
      const cur = this.frames[i]
      const next = this.frames[i + 1]
      const duration =
        next != null
          ? Math.max(next.timestamp - cur.timestamp, 1 / FPS)
          : Math.max(this.stopWallClockSec - cur.timestamp, MIN_TAIL_HOLD_SEC)
      lines.push(`file '${toConcatPath(cur.file)}'`)
      lines.push(`duration ${duration.toFixed(6)}`)
    }
    // The concat demuxer only applies a file's `duration` once it sees the
    // NEXT `file` line — so the last entry's duration is otherwise dropped.
    // Repeating the final file with no duration line closes it out.
    lines.push(`file '${toConcatPath(this.frames[this.frames.length - 1].file)}'`)
    await writeFile(listPath, lines.join('\n') + '\n', 'utf8')

    await runFfmpeg([
      '-f', 'concat',
      '-safe', '0',
      '-i', listPath,
      '-vf', `scale=${VIEWPORT.width}:${VIEWPORT.height}:force_original_aspect_ratio=decrease,pad=${VIEWPORT.width}:${VIEWPORT.height}:(ow-iw)/2:(oh-ih)/2:color=black`,
      '-c:v', 'libx264',
      '-pix_fmt', 'yuv420p',
      '-crf', '18',
      '-r', String(FPS),
      outPath,
    ])
  }

  /** Wall-clock seconds the recording ran for (start() to stop()). */
  get wallClockDurationSec() {
    if (this.frames.length === 0) return 0
    return Math.max(this.stopWallClockSec - this.frames[0].timestamp, 0)
  }

  async cleanup() {
    if (this.frameDir) await rm(this.frameDir, { recursive: true, force: true }).catch(() => {})
  }
}

function toConcatPath(absPath) {
  // ffmpeg's concat demuxer parses forward slashes fine on Windows and this
  // sidesteps backslash-as-escape-character ambiguity inside the quoted path.
  return absPath.replace(/\\/g, '/').replace(/'/g, "'\\''")
}
