// Real-world sizes for the 3D live map (NX-0035). Pure: no three, no React.
//
// A rack level has no height column, and by owner decision there is no migration
// for one. Every level is therefore exactly one pallet tall — the pallet spec
// app_settings already carries (mig 00125) plus a fixed lift clearance — which
// means a carton shelf renders as tall as a pallet level. That is the accepted
// trade-off, not an oversight.

import { AU_STANDARD_PALLET } from '@/lib/palletFit'

/** Headroom above a loaded pallet for the forks to lift it off the beam. */
export const LEVEL_CLEARANCE_MM = 200

export interface PalletHeightSpec {
  baseHeightMm: number
  maxLoadHeightMm: number
}

/** One rack level's height in metres. `null` (settings not loaded yet) falls back
 *  to the AU standard pallet, the same default palletSpecFromSettings uses. */
export function levelHeightM(spec: PalletHeightSpec | null | undefined): number {
  const base = spec?.baseHeightMm ?? AU_STANDARD_PALLET.baseHeightMm
  const load = spec?.maxLoadHeightMm ?? AU_STANDARD_PALLET.maxLoadHeightMm
  return (base + load + LEVEL_CLEARANCE_MM) / 1000
}

/** Grid x → world X and grid y → world Z, in metres. Y is up in the 3D scene. */
export function cellToWorld(x: number, y: number, cellSizeM: number): { x: number; z: number } {
  return { x: round(x * cellSizeM), z: round(y * cellSizeM) }
}

/** Kills float noise (3 × 1.2 = 3.5999999999999996) so specs compare exactly. */
function round(n: number): number {
  return Math.round(n * 1e6) / 1e6
}
