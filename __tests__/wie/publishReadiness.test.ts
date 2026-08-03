import { describe, it, expect } from 'vitest'
import {
  buildWalkableCells,
  evaluatePublishReadiness,
  type ReadinessObject,
  type ReadinessPlacement,
} from '../../supabase/functions/_shared/wie/publishReadiness'

// Helpers to keep the fixtures terse.
const obj = (objectType: string, x: number, y: number): ReadinessObject => ({ objectType, floor: 0, x, y, w: 1, h: 1 })
const bin = (id: string, x: number, y: number): ReadinessPlacement => ({ id, floor: 0, x, y, w: 1, h: 1 })

const statusOf = (r: ReturnType<typeof evaluatePublishReadiness>, code: string) =>
  r.checks.find((c) => c.code === code)?.status

describe('buildWalkableCells', () => {
  it('tracks a dock even when a bin is drawn over it', () => {
    // Dock at (0,0) fully covered by a bin footprint → no walkable cells left, but
    // hasDock must stay true (tracked before subtraction).
    const { cells, hasDock } = buildWalkableCells([obj('dock', 0, 0)], [bin('a', 0, 0)])
    expect(hasDock).toBe(true)
    expect(cells).toHaveLength(0)
  })

  it('subtracts walls and footprints from the walkable set', () => {
    const objects = [obj('dock', 0, 0), obj('walkway', 1, 0), obj('walkway', 2, 0), obj('wall', 2, 0)]
    const { cells } = buildWalkableCells(objects, [bin('a', 1, 0)])
    // (2,0) removed by the wall, (1,0) removed by the bin → only the dock remains.
    expect(cells).toHaveLength(1)
    expect(cells[0]).toMatchObject({ x: 0, y: 0, isDock: true })
  })

  it('treats staging as a plain walkable cell — not a dock, not a lift', () => {
    const { cells, hasDock } = buildWalkableCells([obj('staging', 5, 5)], [])
    expect(cells).toHaveLength(1)
    expect(cells[0]).toMatchObject({ x: 5, y: 5, isDock: false, isLift: false })
    expect(hasDock).toBe(false)
  })

  it('subtracts a conveyor cell from a walkway painted over it', () => {
    const objects = [obj('walkway', 3, 3), obj('conveyor', 3, 3)]
    const { cells } = buildWalkableCells(objects, [])
    expect(cells).toHaveLength(0)
  })

  it('a bare conveyor cell (no walkway underneath) is never walkable on its own', () => {
    const { cells } = buildWalkableCells([obj('conveyor', 1, 1)], [])
    expect(cells).toHaveLength(0)
  })
})

describe('evaluatePublishReadiness', () => {
  it('passes every check for a dock → walkway → bin layout', () => {
    const objects = [obj('dock', 0, 0), obj('walkway', 1, 0), obj('walkway', 2, 0)]
    const placements = [bin('a', 3, 0)]
    const r = evaluatePublishReadiness({ objects, placements, cellSizeM: 1 })
    expect(r.ready).toBe(true)
    expect(r.unreachableIds).toEqual([])
    expect(r.checks.every((c) => c.status === 'pass')).toBe(true)
  })

  // Grid scale became operator-settable, and several call sites lean on the
  // readiness gates being INDEPENDENT of it — autoConnect self-verifies its
  // repair at the layout's scale, the designer runs the same checks live, and
  // publish-layout runs them server-side. Every gate is a connectivity
  // predicate, so none of them may start comparing a distance to a threshold
  // without this test noticing. Until now every call in the suite passed 1.
  it('gives the same verdict at any cell size — the gates are connectivity, not distance', () => {
    const objects = [obj('dock', 0, 0), obj('walkway', 1, 0), obj('walkway', 2, 0)]
    const placements = [bin('a', 3, 0)]
    for (const cellSizeM of [0.25, 1, 2.5, 40]) {
      const r = evaluatePublishReadiness({ objects, placements, cellSizeM })
      expect(r.ready).toBe(true)
      expect(r.unreachableIds).toEqual([])
    }
  })

  it('flags the same stranded bin at any cell size', () => {
    const objects = [obj('dock', 0, 0), obj('walkway', 1, 0), obj('walkway', 10, 10)]
    const placements = [bin('island-bin', 10, 11)]
    for (const cellSizeM of [0.25, 1, 40]) {
      const r = evaluatePublishReadiness({ objects, placements, cellSizeM })
      expect(r.unreachableIds).toEqual(['island-bin'])
    }
  })

  it('fails no_dock and leaves reachability pending when no dock is drawn', () => {
    const objects = [obj('walkway', 0, 0), obj('walkway', 1, 0)]
    const r = evaluatePublishReadiness({ objects, placements: [bin('a', 2, 0)], cellSizeM: 1 })
    expect(r.ready).toBe(false)
    expect(statusOf(r, 'no_dock')).toBe('fail')
    expect(statusOf(r, 'no_walkways')).toBe('pass')
    expect(statusOf(r, 'no_bins')).toBe('pass')
    expect(statusOf(r, 'unreachable_bins')).toBe('pending')
    expect(r.checks.find((c) => c.code === 'no_dock')?.message).toBe(
      'Add at least one dock — putaway routes start from a dock.',
    )
  })

  it('fails no_walkways when nothing walkable survives subtraction', () => {
    // Dock present but covered by a bin → hasDock true, zero walkable cells.
    const r = evaluatePublishReadiness({ objects: [obj('dock', 0, 0)], placements: [bin('a', 0, 0)], cellSizeM: 1 })
    expect(statusOf(r, 'no_dock')).toBe('pass')
    expect(statusOf(r, 'no_walkways')).toBe('fail')
    expect(statusOf(r, 'no_bins')).toBe('pass')
    expect(statusOf(r, 'unreachable_bins')).toBe('pending')
  })

  it('fails no_bins when the layout has no placements', () => {
    const objects = [obj('dock', 0, 0), obj('walkway', 1, 0)]
    const r = evaluatePublishReadiness({ objects, placements: [], cellSizeM: 1 })
    expect(statusOf(r, 'no_bins')).toBe('fail')
    expect(statusOf(r, 'unreachable_bins')).toBe('pending')
    expect(r.ready).toBe(false)
  })

  it('flags a bin whose nearest node is stranded from every dock', () => {
    const objects = [
      obj('dock', 0, 0),
      obj('walkway', 1, 0), // reachable component
      obj('walkway', 10, 10), // island, not connected to the dock
    ]
    const placements = [bin('island-bin', 10, 11)] // nearest node is the island (10,10)
    const r = evaluatePublishReadiness({ objects, placements, cellSizeM: 1 })
    expect(statusOf(r, 'unreachable_bins')).toBe('fail')
    expect(r.unreachableIds).toEqual(['island-bin'])
    expect(r.ready).toBe(false)
    expect(r.checks.find((c) => c.code === 'unreachable_bins')?.message).toContain('1 bin(s)')
  })
})
