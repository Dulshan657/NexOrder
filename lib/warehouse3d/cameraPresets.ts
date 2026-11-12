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
