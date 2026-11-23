// NX-0046 A3: who owns the product shown in the 3D find bar.
//
// Two things can put a product there: the operator, picking one in the bar, and
// the engine ("Find a product" in Ask the engine). Clearing the engine's must not
// take the operator's with it.

import { describe, expect, it } from 'vitest'
import { EMPTY_FIND, nextFindProduct, operatorFind } from '@/lib/warehouse3d/findFocus'

describe('nextFindProduct', () => {
  it('shows a product the engine highlights', () => {
    expect(nextFindProduct(EMPTY_FIND, 7)).toEqual({ productId: 7, fromEngine: true })
  })

  it('clears a product the engine put there when the engine clears it', () => {
    const shown = nextFindProduct(EMPTY_FIND, 7)
    expect(nextFindProduct(shown, null)).toEqual(EMPTY_FIND)
  })

  it("clearing an engine highlight leaves the operator's own search", () => {
    const mine = operatorFind(12)
    expect(nextFindProduct(mine, null)).toEqual({ productId: 12, fromEngine: false })
  })

  it('lets a new engine highlight replace what the operator picked', () => {
    expect(nextFindProduct(operatorFind(12), 7)).toEqual({ productId: 7, fromEngine: true })
  })

  it('treats the operator re-picking as theirs, so a later engine clear keeps it', () => {
    const afterEngine = nextFindProduct(EMPTY_FIND, 7)
    const repicked = operatorFind(afterEngine.productId)
    expect(nextFindProduct(repicked, null).productId).toBe(7)
  })

  it('returns the same state when nothing changes, so an effect cannot loop', () => {
    const mine = operatorFind(12)
    expect(nextFindProduct(mine, null)).toBe(mine)
    const shown = nextFindProduct(EMPTY_FIND, 7)
    expect(nextFindProduct(shown, 7)).toBe(shown)
  })
})
