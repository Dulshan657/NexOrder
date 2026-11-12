// NX-0035 A5: the three camera presets.

import { describe, it, expect } from 'vitest'
import { cameraPreset, AISLE_EYE_HEIGHT_M } from '@/lib/warehouse3d/cameraPresets'
import type { SceneBounds } from '@/lib/warehouse3d/buildScene'

const bounds: SceneBounds = { width: 30, depth: 20, height: 6, center: [15, 0, 10] }

describe('cameraPreset', () => {
  it('top looks straight down at the scene centre', () => {
    const { position, target } = cameraPreset('top', bounds)
    expect(target).toEqual([15, 0, 10])
    expect(position[0]).toBeCloseTo(15)
    expect(position[2]).toBeCloseTo(10)
    // High enough to see the whole floor.
    expect(position[1]).toBeGreaterThan(Math.max(bounds.width, bounds.depth))
  })

  it('iso views from an oblique corner, above and off both axes', () => {
    const { position, target } = cameraPreset('iso', bounds)
    expect(target).toEqual([15, 0, 10])
    expect(position[1]).toBeGreaterThan(0)
    expect(position[0]).not.toBeCloseTo(15)
    expect(position[2]).not.toBeCloseTo(10)
  })

  it('aisle sits at eye height at the selected rack', () => {
    const { position, target } = cameraPreset('aisle', bounds, [4, 3, 6])
    expect(position[1]).toBeCloseTo(AISLE_EYE_HEIGHT_M)
    expect(target[0]).toBeCloseTo(4)
    expect(target[2]).toBeCloseTo(6)
    expect(target[1]).toBeCloseTo(AISLE_EYE_HEIGHT_M)
    // Stands back from the rack rather than inside it.
    expect(Math.hypot(position[0] - 4, position[2] - 6)).toBeGreaterThan(1)
  })

  it('aisle falls back to the scene centre when nothing is selected', () => {
    const { target } = cameraPreset('aisle', bounds)
    expect(target[0]).toBeCloseTo(15)
    expect(target[2]).toBeCloseTo(10)
  })
})
