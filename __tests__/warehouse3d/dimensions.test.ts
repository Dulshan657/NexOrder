// NX-0035 A3: how tall a rack level is in the 3D view.
//
// There is no height column (no migration, by owner decision), so every level is
// one pallet tall: base + max load height + a fixed lift clearance, read from the
// same pallet spec app_settings already carries (mig 00125).

import { describe, it, expect } from 'vitest'
import { levelHeightM, cellToWorld, LEVEL_CLEARANCE_MM } from '@/lib/warehouse3d/dimensions'

describe('levelHeightM', () => {
  it('is pallet base plus max load height plus clearance, in metres', () => {
    expect(levelHeightM({ baseHeightMm: 150, maxLoadHeightMm: 1650 })).toBeCloseTo(
      (150 + 1650 + LEVEL_CLEARANCE_MM) / 1000,
      6,
    )
    expect(levelHeightM({ baseHeightMm: 100, maxLoadHeightMm: 1000 })).toBeCloseTo(
      (100 + 1000 + LEVEL_CLEARANCE_MM) / 1000,
      6,
    )
  })

  it('falls back to the AU standard pallet when no spec has loaded', () => {
    expect(levelHeightM(null)).toBeCloseTo((150 + 1650 + LEVEL_CLEARANCE_MM) / 1000, 6)
  })
})

describe('cellToWorld', () => {
  it('maps grid x to world X and grid y to world Z, in metres', () => {
    expect(cellToWorld(3, 5, 1.2)).toEqual({ x: 3.6, z: 6 })
  })
})
