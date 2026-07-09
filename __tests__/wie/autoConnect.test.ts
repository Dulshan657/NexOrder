import { describe, it, expect } from 'vitest'
import { autoConnectLayout } from '../../supabase/functions/_shared/wie/autoConnect'
import type { AutoConnectInput, ConnectObject } from '../../supabase/functions/_shared/wie/autoConnect'
import { evaluatePublishReadiness } from '../../supabase/functions/_shared/wie/publishReadiness'

function sortedCells(cells: ReadonlyArray<{ floor: number; x: number; y: number }>) {
  return [...cells].sort((a, b) => a.floor - b.floor || a.x - b.x || a.y - b.y)
}

describe('autoConnectLayout', () => {
  it('routes a straight walkway from the dock to a stranded bin, becoming publish-ready', () => {
    const input: AutoConnectInput = {
      objects: [{ objectType: 'dock', floor: 0, x: 0, y: 0, w: 1, h: 1 }],
      placements: [{ id: 'bin-a', floor: 0, x: 5, y: 0, w: 1, h: 1 }],
      gridWidth: 10,
      gridHeight: 10,
      floors: 1,
    }

    const result = autoConnectLayout(input)

    expect(result.changed).toBe(true)
    expect(result.removedWallCells).toEqual([])
    expect(sortedCells(result.addedWalkwayCells)).toEqual(
      sortedCells([
        { floor: 0, x: 1, y: 0 },
        { floor: 0, x: 2, y: 0 },
        { floor: 0, x: 3, y: 0 },
        { floor: 0, x: 4, y: 0 },
      ]),
    )

    const readiness = evaluatePublishReadiness({ objects: result.objects, placements: input.placements, cellSizeM: 1 })
    expect(readiness.ready).toBe(true)
    expect(result.stillUnreachable).toEqual([])
  })

  it('reuses a shared trunk corridor for a second bin instead of re-routing independently', () => {
    // A wall spans y=1 with a single gap at x=4, forcing every route from the dock
    // (row y=0) into the room below (y>=2) through that one gateway.
    const objects: ConnectObject[] = [
      { objectType: 'dock', floor: 0, x: 0, y: 0, w: 1, h: 1 },
      { objectType: 'wall', floor: 0, x: 0, y: 1, w: 4, h: 1 },
      { objectType: 'wall', floor: 0, x: 5, y: 1, w: 5, h: 1 },
    ]
    const input: AutoConnectInput = {
      objects,
      placements: [
        { id: 'bin-a', floor: 0, x: 4, y: 4, w: 1, h: 1 },
        { id: 'bin-b', floor: 0, x: 8, y: 3, w: 1, h: 1 },
      ],
      gridWidth: 10,
      gridHeight: 10,
      floors: 1,
    }

    const result = autoConnectLayout(input)

    // Trunk (7 cells: (1,0)..(4,0),(4,1),(4,2),(4,3)) reused by both bins, plus a
    // 3-cell branch to bin-b — 10 cells total. Routing each bin independently from
    // the dock would pay the 7-cell trunk twice (7 + 10 = 17), so 10 demonstrates
    // reuse, not just a coincidentally short path.
    expect(result.addedWalkwayCells).toHaveLength(10)
    expect(sortedCells(result.addedWalkwayCells)).toEqual(
      sortedCells([
        { floor: 0, x: 1, y: 0 },
        { floor: 0, x: 2, y: 0 },
        { floor: 0, x: 3, y: 0 },
        { floor: 0, x: 4, y: 0 },
        { floor: 0, x: 4, y: 1 },
        { floor: 0, x: 4, y: 2 },
        { floor: 0, x: 4, y: 3 },
        { floor: 0, x: 5, y: 3 },
        { floor: 0, x: 6, y: 3 },
        { floor: 0, x: 7, y: 3 },
      ]),
    )

    const readiness = evaluatePublishReadiness({ objects: result.objects, placements: input.placements, cellSizeM: 1 })
    expect(readiness.ready).toBe(true)
  })

  it('carves the wall cells under a dock painted on a wall run, keeping the rest of the wall', () => {
    const objects: ConnectObject[] = [
      { objectType: 'wall', floor: 0, x: 0, y: 0, w: 10, h: 1 },
      { objectType: 'dock', floor: 0, x: 3, y: 0, w: 2, h: 1 },
    ]
    const input: AutoConnectInput = {
      objects,
      placements: [{ id: 'bin', floor: 0, x: 3, y: 1, w: 1, h: 1 }],
      gridWidth: 10,
      gridHeight: 10,
      floors: 1,
    }

    const result = autoConnectLayout(input)

    expect(sortedCells(result.removedWallCells)).toEqual(
      sortedCells([
        { floor: 0, x: 3, y: 0 },
        { floor: 0, x: 4, y: 0 },
      ]),
    )
    const wallObjects = result.objects.filter((o) => o.objectType === 'wall')
    expect(wallObjects).toHaveLength(8) // 10 - 2 carved cells, exploded to 1x1
    expect(wallObjects.some((o) => o.floor === 0 && o.x === 3 && o.y === 0)).toBe(false)
    expect(wallObjects.some((o) => o.floor === 0 && o.x === 4 && o.y === 0)).toBe(false)
    expect(result.objects.some((o) => o.objectType === 'dock')).toBe(true)
    expect(result.changed).toBe(true)

    const readiness = evaluatePublishReadiness({ objects: result.objects, placements: input.placements, cellSizeM: 1 })
    expect(readiness.ready).toBe(true)
    expect(result.stillUnreachable).toEqual([])
  })

  it('leaves a fully enclosed bin unreachable and adds no walkway cells inside the enclosure', () => {
    // A sealed 3x3 room (interior (5,5)-(7,7)) with no doorway. An isolated
    // walkway stub inside the room (mirroring a stray AI-imported aisle cell)
    // is what makes the bin's nearest-node snap land inside the sealed room
    // instead of trivially landing on the lone dock node.
    const objects: ConnectObject[] = [
      { objectType: 'dock', floor: 0, x: 0, y: 0, w: 1, h: 1 },
      { objectType: 'wall', floor: 0, x: 4, y: 4, w: 5, h: 1 }, // top ring
      { objectType: 'wall', floor: 0, x: 4, y: 8, w: 5, h: 1 }, // bottom ring
      { objectType: 'wall', floor: 0, x: 4, y: 5, w: 1, h: 3 }, // left ring
      { objectType: 'wall', floor: 0, x: 8, y: 5, w: 1, h: 3 }, // right ring
      { objectType: 'walkway', floor: 0, x: 5, y: 5, w: 1, h: 1 }, // isolated interior stub
    ]
    const input: AutoConnectInput = {
      objects,
      placements: [{ id: 'enclosed-bin', floor: 0, x: 6, y: 6, w: 1, h: 1 }],
      gridWidth: 12,
      gridHeight: 12,
      floors: 1,
    }

    const result = autoConnectLayout(input)

    expect(result.addedWalkwayCells).toEqual([])
    expect(result.stillUnreachable).toEqual(['enclosed-bin'])
    // No new cells anywhere inside the sealed 3x3 interior.
    const interiorAdds = result.addedWalkwayCells.filter((c) => c.x >= 5 && c.x <= 7 && c.y >= 5 && c.y <= 7)
    expect(interiorAdds).toEqual([])
  })

  it('leaves an already publish-ready layout untouched, preserving object meta', () => {
    const objects: ConnectObject[] = [
      { objectType: 'dock', floor: 0, x: 0, y: 0, w: 1, h: 1 },
      { objectType: 'walkway', floor: 0, x: 1, y: 0, w: 1, h: 1 },
      { objectType: 'label', floor: 0, x: 5, y: 5, w: 1, h: 1, meta: { text: 'Zone A' } },
    ]
    const input: AutoConnectInput = {
      objects,
      placements: [{ id: 'bin', floor: 0, x: 2, y: 0, w: 1, h: 1 }],
      gridWidth: 10,
      gridHeight: 10,
      floors: 1,
    }

    const result = autoConnectLayout(input)

    expect(result.changed).toBe(false)
    expect(result.addedWalkwayCells).toEqual([])
    expect(result.removedWallCells).toEqual([])
    expect(result.objects).toEqual(objects)
    expect(result.objects.find((o) => o.objectType === 'label')?.meta).toEqual({ text: 'Zone A' })
  })

  describe('multi-floor lift stacks', () => {
    const objects: ConnectObject[] = [
      { objectType: 'dock', floor: 0, x: 0, y: 0, w: 1, h: 1 },
      { objectType: 'walkway', floor: 0, x: 1, y: 0, w: 1, h: 1 },
      { objectType: 'lift', floor: 0, x: 2, y: 0, w: 1, h: 1 },
      { objectType: 'lift', floor: 1, x: 2, y: 0, w: 1, h: 1 },
    ]
    const input: AutoConnectInput = {
      objects,
      placements: [
        { id: 'bin-f1', floor: 1, x: 5, y: 0, w: 1, h: 1 }, // reachable via the lift stack
        { id: 'bin-f2', floor: 2, x: 5, y: 0, w: 1, h: 1 }, // floor 2 has no lift at all
      ],
      gridWidth: 10,
      gridHeight: 10,
      floors: 3,
    }

    it('connects a floor-1 bin through the connected lift and leaves the lift-less floor-2 bin unreachable', () => {
      const result = autoConnectLayout(input)

      expect(sortedCells(result.addedWalkwayCells)).toEqual(
        sortedCells([
          { floor: 1, x: 3, y: 0 },
          { floor: 1, x: 4, y: 0 },
        ]),
      )
      expect(result.stillUnreachable).toEqual(['bin-f2'])

      const readiness = evaluatePublishReadiness({ objects: result.objects, placements: input.placements, cellSizeM: 1 })
      expect(readiness.unreachableIds).toEqual(['bin-f2'])
    })
  })

  it('is deterministic across repeated calls on the same input', () => {
    const input: AutoConnectInput = {
      objects: [
        { objectType: 'dock', floor: 0, x: 0, y: 0, w: 1, h: 1 },
        { objectType: 'wall', floor: 0, x: 0, y: 1, w: 4, h: 1 },
        { objectType: 'wall', floor: 0, x: 5, y: 1, w: 5, h: 1 },
      ],
      placements: [
        { id: 'bin-a', floor: 0, x: 4, y: 4, w: 1, h: 1 },
        { id: 'bin-b', floor: 0, x: 8, y: 3, w: 1, h: 1 },
      ],
      gridWidth: 10,
      gridHeight: 10,
      floors: 1,
    }

    const first = autoConnectLayout(input)
    const second = autoConnectLayout(input)

    expect(second).toEqual(first)
  })
})
