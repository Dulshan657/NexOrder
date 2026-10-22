// The motion math behind a fluid orb: frame-rate independent easing, a burst that
// speeds up and settles instead of snapping, and an eased cross-fade.

import { describe, expect, it } from 'vitest'
import { MAX_STEP_SEC, approach, burstVelocity, easeInOut, stateTempo } from '@/components/voice/orbMotion'

describe('approach', () => {
  it('is frame-rate independent: two half steps land where one full step does', () => {
    const once = approach(0, 1, 0.032, 0.2)
    const twice = approach(approach(0, 1, 0.016, 0.2), 1, 0.016, 0.2)
    expect(twice).toBeCloseTo(once, 10)
  })

  it('moves part of the way, never past the target, and holds still at dt 0', () => {
    const next = approach(0, 1, 0.016, 0.2)
    expect(next).toBeGreaterThan(0)
    expect(next).toBeLessThan(1)
    expect(approach(0.4, 1, 0, 0.2)).toBe(0.4)
    expect(approach(0, 1, 0.05, 0.001)).toBeCloseTo(1, 6)
  })

  it('caps a long gap (a dropped frame, a returning tab) at one short step', () => {
    expect(approach(0, 1, 5, 1)).toBeCloseTo(approach(0, 1, MAX_STEP_SEC, 1), 10)
  })
})

describe('burstVelocity', () => {
  it('starts and ends at rest, peaks mid-burst, and averages 1', () => {
    expect(burstVelocity(0)).toBeCloseTo(0, 10)
    expect(burstVelocity(1)).toBeCloseTo(0, 10)
    expect(burstVelocity(0.5)).toBeGreaterThan(burstVelocity(0.25))
    const steps = 1000
    let sum = 0
    for (let i = 0; i < steps; i += 1) sum += burstVelocity((i + 0.5) / steps)
    expect(sum / steps).toBeCloseTo(1, 3)
    expect(burstVelocity(-1)).toBe(0)
    expect(burstVelocity(2)).toBe(0)
  })
})

describe('easeInOut', () => {
  it('is smooth at both ends and symmetric', () => {
    expect(easeInOut(0)).toBe(0)
    expect(easeInOut(1)).toBe(1)
    expect(easeInOut(0.5)).toBeCloseTo(0.5, 10)
    expect(easeInOut(0.1)).toBeLessThan(0.1)
    expect(easeInOut(0.9)).toBeGreaterThan(0.9)
  })
})

describe('stateTempo', () => {
  it('evens out the presets so a state change does not jerk the tempo', () => {
    const speeds = [1.885, 2.34, 3.24, 3.315, 4.388]
    const effective = speeds.map((s) => s * stateTempo(s))
    expect(Math.max(...effective) / Math.min(...effective)).toBeLessThan(1.6)
    expect(Math.max(...speeds) / Math.min(...speeds)).toBeGreaterThan(2)
  })
})
