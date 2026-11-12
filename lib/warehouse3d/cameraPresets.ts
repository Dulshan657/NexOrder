// Camera presets for the 3D live map (NX-0035). Pure: no three, no React.

import type { SceneBounds, Vec3 } from './buildScene'

export type CameraPresetName = 'top' | 'iso' | 'aisle'

/** Standing eye height of a person on the floor. */
export const AISLE_EYE_HEIGHT_M = 1.7
/** How far back from the selected rack the aisle view stands. */
const AISLE_STANDOFF_M = 4

export interface CameraPose {
  position: Vec3
  target: Vec3
}

/**
 * - `top`: straight down over the scene centre, high enough to frame the floor.
 *   A hair of Z offset keeps orbit controls from hitting the pole singularity.
 * - `iso`: an oblique corner view, the "digital twin" default.
 * - `aisle`: eye height, looking at the selected rack (scene centre when none).
 */
export function cameraPreset(name: CameraPresetName, bounds: SceneBounds, focus?: Vec3 | null): CameraPose {
  const [cx, , cz] = bounds.center
  const span = Math.max(bounds.width, bounds.depth, 1)

  if (name === 'top') {
    return { position: [cx, span * 1.25, cz + 0.001], target: [cx, 0, cz] }
  }
  if (name === 'iso') {
    const d = span * 0.75
    return { position: [cx + d, span * 0.7, cz + d], target: [cx, 0, cz] }
  }
  const fx = focus ? focus[0] : cx
  const fz = focus ? focus[2] : cz
  return {
    position: [fx, AISLE_EYE_HEIGHT_M, fz + AISLE_STANDOFF_M],
    target: [fx, AISLE_EYE_HEIGHT_M, fz],
  }
}

/** How far back to stand, as a multiple of the spread of the points. Comfortably
 *  over what a 45° field of view needs to keep a sphere of that radius in frame. */
const FRAME_STANDOFF = 2.4
/** Never closer than this, so one matching level is not filled edge to edge. */
const FRAME_MIN_DISTANCE_M = 8

/**
 * Frame a set of points (find stock, NX-0036): look at their centroid from the
 * iso direction, far enough back to see them all. No points → the iso preset.
 */
export function framePoints(points: readonly Vec3[], bounds: SceneBounds): CameraPose {
  if (points.length === 0) return cameraPreset('iso', bounds)
  const n = points.length
  const target: Vec3 = [
    points.reduce((s, p) => s + p[0], 0) / n,
    points.reduce((s, p) => s + p[1], 0) / n,
    points.reduce((s, p) => s + p[2], 0) / n,
  ]
  const radius = Math.max(
    0,
    ...points.map((p) => Math.hypot(p[0] - target[0], p[1] - target[1], p[2] - target[2])),
  )
  const dist = Math.max(radius * FRAME_STANDOFF, FRAME_MIN_DISTANCE_M)
  // The iso direction, normalised: equal parts +X, up and +Z.
  const k = dist / Math.sqrt(3)
  return { position: [target[0] + k, target[1] + k, target[2] + k], target }
}

