// The loudness Nex Assistant's orb follows, as pure math over analyser samples.
// audioLevel.ts owns the Web Audio side; this file is the part a test can pin.
//
//   rms         - root mean square of one block of time-domain samples (-1..1)
//   rmsToLevel  - RMS onto 0..1 on a decibel scale: speech sits mid-range rather
//                 than hugging the floor, which a linear map would do
//   smoothLevel - one frame of attack/release: jump with a syllable, ease off after

/** Quieter than this many dB below full scale reads as silence. */
const FLOOR_DB = 50
/** Share of the gap closed per frame while getting louder, and while getting quieter. */
const ATTACK = 0.5
const RELEASE = 0.08
/** Below this the level snaps to 0, so a silent orb actually comes to rest. */
const REST = 0.001

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value))

export function rms(samples: ArrayLike<number>): number {
  if (samples.length === 0) return 0
  let sum = 0
  for (let i = 0; i < samples.length; i += 1) sum += samples[i] * samples[i]
  return Math.sqrt(sum / samples.length)
}

export function rmsToLevel(value: number): number {
  if (!(value > 0)) return 0
  const db = 20 * Math.log10(value)
  return clamp01((db + FLOOR_DB) / FLOOR_DB)
}

export function smoothLevel(previous: number, target: number): number {
  const goal = clamp01(target)
  const rate = goal > previous ? ATTACK : RELEASE
  const next = previous + (goal - previous) * rate
  return next < REST ? 0 : clamp01(next)
}
