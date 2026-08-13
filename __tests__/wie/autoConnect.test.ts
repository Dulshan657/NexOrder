import { describe, it, expect } from 'vitest'
import { autoConnectLayout } from '../../supabase/functions/_shared/wie/autoConnect'
import type { AutoConnectInput, ConnectObject, ConnectPlacement } from '../../supabase/functions/_shared/wie/autoConnect'
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

  describe('conveyor / staging semantics', () => {
    it('a room sealed by a conveyor ring stays unreachable — BFS never crosses it', () => {
      // Same shape as the wall-sealed-room case below, but the ring is
      // conveyor instead of wall — proves the BFS treats conveyor as
      // equally blocking. The isolated interior walkway stub (mirroring a
      // stray AI-imported aisle cell) is what makes the bin's nearest-node
      // snap land inside the sealed room instead of trivially on the dock.
      const objects: ConnectObject[] = [
        { objectType: 'dock', floor: 0, x: 0, y: 0, w: 1, h: 1 },
        { objectType: 'conveyor', floor: 0, x: 4, y: 4, w: 5, h: 1 }, // top ring
        { objectType: 'conveyor', floor: 0, x: 4, y: 8, w: 5, h: 1 }, // bottom ring
        { objectType: 'conveyor', floor: 0, x: 4, y: 5, w: 1, h: 3 }, // left ring
        { objectType: 'conveyor', floor: 0, x: 8, y: 5, w: 1, h: 3 }, // right ring
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
    })

    it('connects a bin adjacent to a staging strip with no repair needed (staging is already walkable)', () => {
      const objects: ConnectObject[] = [
        { objectType: 'dock', floor: 0, x: 0, y: 0, w: 1, h: 1 },
        { objectType: 'staging', floor: 0, x: 1, y: 0, w: 4, h: 1 }, // cells (1,0)-(4,0), touching the dock
      ]
      const input: AutoConnectInput = {
        objects,
        placements: [{ id: 'bin', floor: 0, x: 5, y: 0, w: 1, h: 1 }], // adjacent to the staging strip's far end
        gridWidth: 10,
        gridHeight: 10,
        floors: 1,
      }

      const result = autoConnectLayout(input)

      expect(result.changed).toBe(false)
      expect(result.addedWalkwayCells).toEqual([])
      const readiness = evaluatePublishReadiness({ objects: result.objects, placements: input.placements, cellSizeM: 1 })
      expect(readiness.ready).toBe(true)
    })

    it('routes through a disconnected staging island for free once reached (zero-cost network)', () => {
      const objects: ConnectObject[] = [
        { objectType: 'dock', floor: 0, x: 0, y: 0, w: 1, h: 1 },
        { objectType: 'staging', floor: 0, x: 3, y: 0, w: 4, h: 1 }, // island: cells (3,0)-(6,0), not yet touching the dock
      ]
      const input: AutoConnectInput = {
        objects,
        placements: [{ id: 'bin', floor: 0, x: 7, y: 0, w: 1, h: 1 }], // adjacent to the far end of the island
        gridWidth: 10,
        gridHeight: 10,
        floors: 1,
      }

      const result = autoConnectLayout(input)

      // Only the 2-cell gap between the dock and the staging island becomes a
      // new walkway object; the 4 staging cells cost nothing to traverse once
      // reached and are never re-emitted as new walkway objects.
      expect(sortedCells(result.addedWalkwayCells)).toEqual(
        sortedCells([
          { floor: 0, x: 1, y: 0 },
          { floor: 0, x: 2, y: 0 },
        ]),
      )
      const readiness = evaluatePublishReadiness({ objects: result.objects, placements: input.placements, cellSizeM: 1 })
      expect(readiness.ready).toBe(true)
    })

    it("preserves an object's meta and stagingLocationId untouched when no repair is needed", () => {
      const objects: ConnectObject[] = [
        { objectType: 'dock', floor: 0, x: 0, y: 0, w: 1, h: 1 },
        { objectType: 'walkway', floor: 0, x: 1, y: 0, w: 1, h: 1 },
        {
          objectType: 'staging',
          floor: 0,
          x: 5,
          y: 5,
          w: 1,
          h: 1,
          meta: { name: 'Shipping & Receiving' },
          stagingLocationId: 42,
        },
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
      const staging = result.objects.find((o) => o.objectType === 'staging')
      expect(staging?.meta).toEqual({ name: 'Shipping & Receiving' })
      expect(staging?.stagingLocationId).toBe(42)
    })
  })

  describe('perf smoke', () => {
    it('completes quickly on a 120×80 grid with ~200 scattered placements', { timeout: 30_000 }, () => {
      const gridWidth = 120
      const gridHeight = 80
      const objects: ConnectObject[] = [{ objectType: 'dock', floor: 0, x: 0, y: 0, w: 1, h: 1 }]

      // Small deterministic PRNG (no external dep) so the fixture is stable
      // across runs while still scattering placements across the grid.
      let seed = 42
      const rand = (): number => {
        seed = (seed * 1103515245 + 12345) & 0x7fffffff
        return seed / 0x7fffffff
      }

      const placements: ConnectPlacement[] = []
      for (let i = 0; i < 200; i++) {
        const x = 2 + Math.floor(rand() * (gridWidth - 4))
        const y = Math.floor(rand() * gridHeight)
        placements.push({ id: `bin-${i}`, floor: 0, x, y, w: 1, h: 1 })
      }

      const input: AutoConnectInput = { objects, placements, gridWidth, gridHeight, floors: 1 }

      const start = Date.now()
      const result = autoConnectLayout(input)
      const elapsedMs = Date.now() - start

      // The algorithm re-runs a full-grid BFS per unconnected round (by
      // design — see the module header), so wall-clock scales with grid area
      // × placement count. At the raised 120×80 cap this genuinely takes a
      // few seconds; the bound below is a smoke test against a catastrophic
      // (e.g. quadratic-in-grid-area-per-placement) regression, not a tight
      // SLA — generous for slower CI runners.
      //
      // RAISED 15s → 60s on 2026-08-13. The bound was measuring the machine,
      // not the algorithm: this file takes ~5s run alone and ~38s when the
      // whole suite runs in parallel, so it began failing purely because the
      // suite grew by ~200 tests (module flags) and the workers contended
      // harder. A wall-clock assertion inside a parallel runner cannot be
      // tightened into reliability — the only honest options are a bound loose
      // enough to survive contention or no bound at all, and the regression
      // this guards against is orders of magnitude, not factors: a
      // quadratic-in-area rewrite of this input takes minutes, not 61 seconds.
      expect(elapsedMs).toBeLessThan(60_000)
      expect(result.objects.length).toBeGreaterThan(0)
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
