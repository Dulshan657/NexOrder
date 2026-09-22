// `subtreeLocationIds` was an untested inline memo in OpsStockRow that the
// Stock lookup needed a second copy of. These pin the behaviour that was there,
// plus the one case the inline version got right only by accident.

import { describe, expect, it } from 'vitest'

import { subtreeLocationIds, type SubtreeLocation } from '../lib/warehouseSubtree'

const TREE: SubtreeLocation[] = [
  { id: 1, materializedPath: 'WH1' },
  { id: 2, materializedPath: 'WH1/A' },
  { id: 3, materializedPath: 'WH1/A/L1' },
  // A SIBLING WAREHOUSE whose path starts with the same characters. This is the
  // case a bare `startsWith(root.materializedPath)` gets wrong — it would pull
  // every location of WH10 into WH1's subtree.
  { id: 10, materializedPath: 'WH10' },
  { id: 11, materializedPath: 'WH10/A' },
]

describe('subtreeLocationIds', () => {
  it('returns null — "do not filter" — for a site-wide view', () => {
    expect(subtreeLocationIds(TREE, null)).toBeNull()
  })

  it('returns null when the tree has not loaded', () => {
    expect(subtreeLocationIds(undefined, 1)).toBeNull()
    expect(subtreeLocationIds(null, 1)).toBeNull()
  })

  it('returns null when the named root is not in the tree', () => {
    // NOT an empty Set: "I cannot answer" and "the answer is nothing" would
    // render as a full list and an empty one respectively, and confusing them
    // is how a scoped screen silently shows another site's stock.
    expect(subtreeLocationIds(TREE, 999)).toBeNull()
  })

  it('includes the root itself', () => {
    // A bulk site keeps its stock ON the root, and a racked site keeps
    // everything not yet put away there, so a subtree without the root misses
    // exactly the stock that has just arrived.
    expect(subtreeLocationIds(TREE, 1)?.has(1)).toBe(true)
  })

  it('includes every descendant, at any depth', () => {
    const ids = subtreeLocationIds(TREE, 1)
    expect([...(ids ?? [])].sort((a, b) => a - b)).toEqual([1, 2, 3])
  })

  it('excludes a sibling whose path merely shares a prefix', () => {
    const ids = subtreeLocationIds(TREE, 1)
    expect(ids?.has(10)).toBe(false)
    expect(ids?.has(11)).toBe(false)
  })

  it('lets a root with no path vouch only for itself', () => {
    const odd: SubtreeLocation[] = [{ id: 7, materializedPath: null }, { id: 8, materializedPath: 'X' }]
    expect([...(subtreeLocationIds(odd, 7) ?? [])]).toEqual([7])
  })
})
