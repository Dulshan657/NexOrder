// NX-0047 A11: where the bin hover card goes. The card used to sit a fixed
// distance above its cell, so a top-row cell pushed it out of the map's box,
// where the stage's overflow-hidden clipped it.

import { describe, it, expect } from 'vitest'
import { placeHoverCard } from '@/components/inventory/warehouse/BinHoverCard'
import { BASE_CELL } from '@/components/admin/layout/layoutPalette'

const BOUNDS = { width: 800, height: 400 }
const VIEW = { scale: 1, tx: 0, ty: 0 }
const cell = (x: number, y: number, w = 2, h = 1) => ({ x, y, w, h })

describe('placeHoverCard', () => {
  it('sits above a mid-floor cell, hung from its bottom edge', () => {
    const placed = placeHoverCard(cell(10, 10), VIEW, BOUNDS)
    expect(placed.top).toBeUndefined()
    // The card's bottom edge is a gap above the cell's top edge.
    expect(BOUNDS.height - placed.bottom!).toBeLessThan(10 * BASE_CELL)
    expect(BOUNDS.height - placed.bottom!).toBeGreaterThan(10 * BASE_CELL - 16)
  })

  it('flips below a top-row cell instead of leaving the box', () => {
    const placed = placeHoverCard(cell(10, 0), VIEW, BOUNDS)
    expect(placed.bottom).toBeUndefined()
    expect(placed.top!).toBeGreaterThan(BASE_CELL)
    expect(placed.top!).toBeLessThan(BASE_CELL + 16)
  })

  it('keeps the card inside the box on a left-edge and a right-edge cell', () => {
    const left = placeHoverCard(cell(0, 10), VIEW, BOUNDS)
    expect(left.left).toBeGreaterThanOrEqual(8)
    const right = placeHoverCard(cell(29, 10), VIEW, BOUNDS)
    expect(right.left + right.width).toBeLessThanOrEqual(BOUNDS.width - 8)
  })

  it('follows the pan and zoom of the viewport', () => {
    const placed = placeHoverCard(cell(2, 4), { scale: 2, tx: 100, ty: 50 }, BOUNDS)
    // Centred on the cell: 100 + (2 + 1) * 26 * 2 = 256.
    expect(placed.left + placed.width / 2).toBeCloseTo(256, 5)
  })

  it('stays inside the box when the cell is taller than the room either side', () => {
    const placed = placeHoverCard(cell(10, 2, 2, 12), VIEW, BOUNDS) // 52px … 364px of 400
    const edge = placed.top ?? placed.bottom!
    expect(edge).toBeGreaterThanOrEqual(8)
    expect(edge).toBeLessThanOrEqual(BOUNDS.height - 8)
    // Room for the whole card between that edge and the far side of the box.
    expect(BOUNDS.height - edge).toBeGreaterThanOrEqual(112 + 8)
  })

  it('falls back to hanging under the cell before the box has been measured', () => {
    const placed = placeHoverCard(cell(10, 10), VIEW, { width: 0, height: 0 })
    expect(placed.width).toBeGreaterThan(0)
    expect(placed.top!).toBeGreaterThan(11 * BASE_CELL)
  })
})
