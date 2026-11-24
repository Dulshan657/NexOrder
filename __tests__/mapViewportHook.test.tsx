// NX-0046 A1: the map keeps the operator's zoom while they work.
//
// The hook used to re-fit whenever the object list changed IDENTITY, and painting
// one area cell builds a new list — so every painted cell threw the operator back
// to the whole floor. A re-fit belongs to first size, a floor change, the first
// content to arrive, and the Fit button.

import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { LayoutObject, LayoutPlacement } from '@/types'
import { useMapViewport } from '@/components/inventory/warehouse/useMapViewport'

afterEach(() => cleanup())

// jsdom has no layout: give the stage a real size or fit() is a no-op.
beforeAll(() => {
  Element.prototype.getBoundingClientRect = function () {
    return { x: 0, y: 0, left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600, toJSON: () => ({}) } as DOMRect
  }
})

const placements = [
  { id: 1, layoutId: 1, locationId: 1, floor: 0, x: 0, y: 0, w: 2, h: 1, rotation: 0 },
  { id: 2, layoutId: 1, locationId: 2, floor: 0, x: 60, y: 40, w: 2, h: 1, rotation: 0 },
  { id: 3, layoutId: 1, locationId: 3, floor: 1, x: 0, y: 0, w: 2, h: 1, rotation: 0 },
] as LayoutPlacement[]

const area = (id: number, x: number): LayoutObject =>
  ({ id, layoutId: 1, objectType: 'area', floor: 0, x, y: 5, w: 1, h: 1, meta: { name: 'Fast' } }) as LayoutObject

function Harness({ objects, floor = 0, rows = placements }: { objects: LayoutObject[]; floor?: number; rows?: LayoutPlacement[] }) {
  const vp = useMapViewport({ placements: rows, objects, floor })
  return (
    <div ref={vp.containerRef}>
      <button type="button" onClick={vp.zoomIn}>in</button>
      <button type="button" onClick={vp.fit}>fit</button>
      <output data-testid="scale">{vp.viewport.scale}</output>
    </div>
  )
}

const scale = () => Number(screen.getByTestId('scale').textContent)

describe('useMapViewport', () => {
  it('keeps the zoom when the object list is replaced', () => {
    const { rerender } = render(<Harness objects={[area(1, 5)]} />)
    const fitted = scale()
    fireEvent.click(screen.getByText('in'))
    const zoomed = scale()
    expect(zoomed).toBeGreaterThan(fitted)

    // One more painted cell: a NEW array, as RackedWorkspace builds per stroke.
    rerender(<Harness objects={[area(1, 5), area(2, 6)]} />)
    expect(scale()).toBe(zoomed)
  })

  it('still re-fits on a floor change and on the Fit button', () => {
    const { rerender } = render(<Harness objects={[]} />)
    const fitted = scale()
    fireEvent.click(screen.getByText('in'))
    expect(scale()).toBeGreaterThan(fitted)
    fireEvent.click(screen.getByText('fit'))
    expect(scale()).toBe(fitted)

    fireEvent.click(screen.getByText('in'))
    const zoomed = scale()
    rerender(<Harness objects={[]} floor={1} />)
    expect(scale()).not.toBe(zoomed)
  })

  it('fits when the first content arrives after an empty load', () => {
    const { rerender } = render(<Harness objects={[]} rows={[]} />)
    expect(scale()).toBe(1)
    rerender(<Harness objects={[]} />)
    expect(scale()).toBeLessThan(1)
  })
})
