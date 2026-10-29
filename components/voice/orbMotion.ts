// The motion math that keeps Nex's orb fluid. Pure, so it can be pinned by tests.
//
//   approach      - exponential ease toward a target, by elapsed TIME, not frames, so
//                   the orb moves the same on a 60 Hz phone and a 120 Hz laptop
//   burstVelocity - a burst's speed over its life: from rest, up, back to rest, so
//                   it never snaps back to the still frame when it ends
//   easeInOut     - the cross-fade curve between two states
//   stateTempo    - evens out the library's per-state speeds (tuned for 20-64 px
//                   spinners, 1.9x to 4.4x apart) so a state change keeps its pace

/** A gap longer than this (a dropped frame, a tab coming back) counts as this. */
export const MAX_STEP_SEC = 0.05
/** The pace every state is pulled toward, in the engine's speed units. */
const TARGET_SPEED = 2.4
/** How far toward TARGET_SPEED a preset is pulled: 0 keeps it, 1 flattens all. */
const EVEN_OUT = 0.6

export function approach(current: number, target: number, dtSec: number, tauSec: number): number {
  const dt = Math.min(Math.max(0, dtSec), MAX_STEP_SEC)
  if (dt === 0 || tauSec <= 0) return dt === 0 ? current : target
  return target + (current - target) * Math.exp(-dt / tauSec)
}

/** Speed at progress p (0..1) of a burst: 2·sin²(πp), which averages exactly 1. */
export function burstVelocity(progress: number): number {
  if (progress <= 0 || progress >= 1) return 0
  const s = Math.sin(Math.PI * progress)
  return 2 * s * s
}

export function easeInOut(t: number): number {
  const x = Math.min(1, Math.max(0, t))
  return x * x * (3 - 2 * x)
}

/** Multiplier on a preset speed that pulls it part-way toward a common pace. */
export function stateTempo(presetSpeed: number): number {
  if (!(presetSpeed > 0)) return 1
  const evened = presetSpeed ** (1 - EVEN_OUT) * TARGET_SPEED ** EVEN_OUT
  return evened / presetSpeed
}
