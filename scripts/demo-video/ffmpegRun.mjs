// scripts/demo-video/ffmpegRun.mjs
//
// Thin async spawn wrappers around ffmpeg/ffprobe, shared by screencast.mjs
// (frames -> mp4) and encode.mjs (mp4 + music -> final mp4).

import { spawn } from 'node:child_process'
import { FFMPEG_PATH, FFPROBE_PATH } from './ffmpegPath.mjs'

/**
 * Run ffmpeg with the given args, rejecting on a non-zero exit code. stderr
 * is where ffmpeg writes both progress and errors, so it's always captured
 * and included in a failure's message.
 * @param {string[]} args
 * @param {{ log?: boolean }} [opts]
 * @returns {Promise<void>}
 */
export function runFfmpeg(args, opts = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(FFMPEG_PATH, ['-hide_banner', '-y', ...args], { stdio: ['ignore', 'ignore', 'pipe'] })
    let stderr = ''
    child.stderr.on('data', chunk => {
      stderr += chunk.toString()
      if (opts.log) process.stderr.write(chunk)
    })
    child.on('error', reject)
    child.on('close', code => {
      if (code === 0) resolvePromise()
      else reject(new Error(`ffmpeg exited ${code}\n${stderr.slice(-4000)}`))
    })
  })
}

/**
 * Run ffprobe and return its stdout parsed as JSON.
 * @param {string[]} args
 * @returns {Promise<any>}
 */
export function runFfprobeJson(args) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(FFPROBE_PATH, [...args, '-of', 'json'], { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', chunk => (stdout += chunk.toString()))
    child.stderr.on('data', chunk => (stderr += chunk.toString()))
    child.on('error', reject)
    child.on('close', code => {
      if (code !== 0) {
        reject(new Error(`ffprobe exited ${code}\n${stderr.slice(-2000)}`))
        return
      }
      try {
        resolvePromise(JSON.parse(stdout))
      } catch (err) {
        reject(new Error(`ffprobe produced non-JSON output: ${err instanceof Error ? err.message : String(err)}`))
      }
    })
  })
}

/** Probe a video's format + first video stream. Convenience wrapper used by
 *  record.mjs's self-test and by anything that wants a quick sanity check. */
export async function probeVideo(filePath) {
  const data = await runFfprobeJson(['-v', 'error', '-show_format', '-show_streams', filePath])
  const videoStream = (data.streams || []).find(s => s.codec_type === 'video')
  const audioStream = (data.streams || []).find(s => s.codec_type === 'audio')
  return {
    durationSec: data.format ? parseFloat(data.format.duration) : NaN,
    width: videoStream?.width ?? null,
    height: videoStream?.height ?? null,
    fps: videoStream?.r_frame_rate ? evalFrameRate(videoStream.r_frame_rate) : null,
    hasAudio: Boolean(audioStream),
    raw: data,
  }
}

function evalFrameRate(rFrameRate) {
  const [num, den] = rFrameRate.split('/').map(Number)
  if (!den) return num
  return num / den
}
