// NX-0039 A10: the places holding a found product, outlined on the 2D map.

import { afterEach, describe, it, expect } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import type { LayoutPlacement } from '@/types'
import { holdingMarkers } from '@/components/inventory/warehouse/warehouseMarkers'

afterEach(() => cleanup())

const placement = (locationId: number, floor: number, x: number, y: number) =>
  ({ id: locationId, layoutId: 1, locationId, floor, x, y, w: 1, h: 1, rotation: 0 }) as unknown as LayoutPlacement

describe('holdingMarkers', () => {
  it('outlines every place holding the product on the floor being viewed', () => {
    const placements = new Map<number, LayoutPlacement>([
      [10, placement(10, 0, 2, 3)],
      [11, placement(11, 0, 5, 3)],
      [12, placement(12, 1, 5, 3)], // another floor
    ])
    // 1 is the warehouse root (the dock): no placement, nothing to outline.
    const { container } = render(<svg>{holdingMarkers(20, 1, [10, 11, 12, 1], placements, 0)}</svg>)
    const outlined = [...container.querySelectorAll('[data-holding]')].map((el) => el.getAttribute('data-holding'))
    expect(outlined.sort()).toEqual(['10', '11'])
    const r = container.querySelector('[data-holding="10"]')!
    expect(Number(r.getAttribute('x'))).toBeLessThanOrEqual(40)
    expect(Number(r.getAttribute('y'))).toBeLessThanOrEqual(60)
  })
})
