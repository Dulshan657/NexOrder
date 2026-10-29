// The loudness the orb follows: raw RMS from an analyser, mapped onto 0..1 and
// smoothed so the orb jumps with a syllable and eases off after it.

import { describe, expect, it } from 'vitest'
import { rms, rmsToLevel, smoothLevel } from '@/lib/voice/levelSmoothing'

describe('smoothLevel', () => {
  it('rises fast, falls slowly, clamps to 0..1 and settles to 0 on silence', () => {
    expect(smoothLevel(0, 1)).toBeGreaterThan(0.3)
    expect(smoothLevel(1, 0)).toBeGreaterThan(0.85)
    expect(smoothLevel(0, 5)).toBeLessThanOrEqual(1)
    expect(smoothLevel(0.5, -3)).toBeGreaterThanOrEqual(0)

    let level = 1
    for (let frame = 0; frame < 200; frame += 1) level = smoothLevel(level, 0)
    expect(level).toBe(0)
  })
})

describe('rms / rmsToLevel', () => {
  it('reads silence as 0 and a full-scale signal as 1', () => {
    expect(rms(new Float32Array(64))).toBe(0)
    expect(rms(new Float32Array(64).fill(0.5))).toBeCloseTo(0.5)
    expect(rmsToLevel(0)).toBe(0)
    expect(rmsToLevel(1)).toBe(1)
  })

  it('puts ordinary speech in the middle of the range, not at the floor', () => {
    const speech = rmsToLevel(0.05)
    expect(speech).toBeGreaterThan(0.3)
    expect(speech).toBeLessThan(0.9)
  })
})
