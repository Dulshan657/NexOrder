// Warehouse Intelligence Engine — auto-connect walkways.
//
// AI-imported floor plans pass walkways/docks through with no repair, so a dock
// drawn on top of a perimeter wall becomes a dead graph anchor (buildWalkableCells
// subtracts the wall cells under it) and storage bins are usually left with no
// walkway route to any dock. This module deterministically repairs a layout so it
// clears the `unreachable_bins` publish gate without an operator hand-painting
// corridors first.
//
// Pure per the _shared/wie contract (see types.ts) — no Deno globals, no I/O.
//
// Algorithm (see supabase/functions/_shared/wie/autoConnect.ts callers for the
// full write-up):
//   1. Carve any wall cell that sits under a dock footprint out of the wall
//      objects, so the dock becomes a live anchor.
//   2. Build the walkable/reachable cell network from the carved layout via the
//      existing publish-readiness + graph primitives.
//   3. Repeatedly BFS from the reachable network across free (non-wall,
//      non-obstacle, non-footprint) cells, routing the nearest still-unreachable
//      placement first and growing the network with the new walkway cells.
//   4. Self-verify with evaluatePublishReadiness so this module's report can
//      never disagree with the actual publish gate.
//
// v1 scope: a bin on a floor with no reachable lift cell is left in
// `stillUnreachable` — the operator adds a lift manually. New walkways are
// emitted as 1×1 cells; merging them into rects is a possible future
// optimization. Grids are small (≤120×80 × ≤10 floors) so a per-bin re-BFS is
// cheap.

import { buildWalkGraph, dijkstra } from './graph.ts'
import { buildWalkableCells, evaluatePublishReadiness } from './publishReadiness.ts'
import type { ReadinessObject, ReadinessPlacement } from './publishReadiness.ts'

// NOTE: graph.ts's `cellKey`/`ORTHO` and publishReadiness.ts's `cellKey` are
// module-private (not exported), so this module defines its own equivalents
// rather than the "exported ORTHO/cellKey" the brief anticipated.
const ORTHO: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
]

function cellKey(floor: number, x: number, y: number): string {
  return `${floor}:${x}:${y}`
}

/** A layout object in grid coordinates, with opaque passthrough fields (`meta`
 *  bag, `stagingLocationId`) that this module never inspects or mutates — it
 *  only ever reads `objectType`/`floor`/`x`/`y`/`w`/`h`. Walls are the one
 *  object type this module reconstructs (carving under docks); every other
 *  object type is passed through by reference, so these fields survive
 *  untouched automatically. Walls never carry a `stagingLocationId` in
 *  practice, so the carve path only needs to preserve `meta`. */
export interface ConnectObject {
  objectType: string
  floor: number
  x: number
  y: number
  w: number
  h: number
  meta?: Record<string, unknown>
  stagingLocationId?: number
}

/** A storage footprint keyed by a caller-chosen stable id. */
export interface ConnectPlacement {
  id: string
  floor: number
  x: number
  y: number
  w: number
  h: number
}

export interface AutoConnectInput {
  objects: ConnectObject[]
  placements: ConnectPlacement[]
  gridWidth: number
  gridHeight: number
  floors: number
  /** The layout's metres-per-cell. Only reaches the publish-readiness
   *  self-check at the end, which is scale-invariant — the BFS below works in
   *  cells throughout. Defaults to 1 so existing callers are unaffected. */
  cellSizeM?: number
}

export interface AutoConnectResult {
  /** Full transformed object list: walls carved under docks, new 1×1 walkway
   *  cells appended, everything else (including meta) passed through as-is. */
  objects: ConnectObject[]
  addedWalkwayCells: Array<{ floor: number; x: number; y: number }>
  removedWallCells: Array<{ floor: number; x: number; y: number }>
  /** Placement ids evaluatePublishReadiness still flags as unreachable. */
  stillUnreachable: string[]
  changed: boolean
}

function cellsOfRect(x: number, y: number, w: number, h: number): Array<{ x: number; y: number }> {
  const cells: Array<{ x: number; y: number }> = []
  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) cells.push({ x: x + dx, y: y + dy })
  }
  return cells
}

/** Step 1: carve dock-covered cells out of any wall rect. Walls that don't
 *  intersect a dock pass through unchanged (same reference, never mutated). */
function carveDocksUnderWalls(objects: ConnectObject[]): {
  carvedObjects: ConnectObject[]
  removedWallCells: Array<{ floor: number; x: number; y: number }>
} {
  const dockCellKeys = new Set<string>()
  for (const o of objects) {
    if (o.objectType !== 'dock') continue
    for (const c of cellsOfRect(o.x, o.y, o.w, o.h)) dockCellKeys.add(cellKey(o.floor, c.x, c.y))
  }

  const removedWallCells: Array<{ floor: number; x: number; y: number }> = []
  const carvedObjects: ConnectObject[] = []
  for (const o of objects) {
    if (o.objectType !== 'wall') {
      carvedObjects.push(o)
      continue
    }
    const cells = cellsOfRect(o.x, o.y, o.w, o.h)
    const intersectsDock = cells.some((c) => dockCellKeys.has(cellKey(o.floor, c.x, c.y)))
    if (!intersectsDock) {
      carvedObjects.push(o)
      continue
    }
    for (const c of cells) {
      if (dockCellKeys.has(cellKey(o.floor, c.x, c.y))) {
        removedWallCells.push({ floor: o.floor, x: c.x, y: c.y })
      } else {
        carvedObjects.push({ objectType: 'wall', floor: o.floor, x: c.x, y: c.y, w: 1, h: 1, meta: o.meta })
      }
    }
  }
  return { carvedObjects, removedWallCells }
}

interface CellSets {
  wallCellKeys: Set<string>
  obstacleCellKeys: Set<string>
  walkwayCellKeys: Set<string>
}

function buildCellSets(objects: ConnectObject[]): CellSets {
  const wallCellKeys = new Set<string>()
  const obstacleCellKeys = new Set<string>()
  const walkwayCellKeys = new Set<string>()
  for (const o of objects) {
    let target: Set<string> | null = null
    if (o.objectType === 'wall') target = wallCellKeys
    // A conveyor belt blocks a walking route exactly like an obstacle — the
    // BFS below must never cross it.
    else if (o.objectType === 'obstacle' || o.objectType === 'conveyor') target = obstacleCellKeys
    // Staging (the Shipping & Receiving floor) is walkable, zero-cost ground —
    // treated the same as an existing walkway for routing purposes.
    else if (o.objectType === 'walkway' || o.objectType === 'staging') target = walkwayCellKeys
    if (target === null) continue
    for (const c of cellsOfRect(o.x, o.y, o.w, o.h)) target.add(cellKey(o.floor, c.x, c.y))
  }
  return { wallCellKeys, obstacleCellKeys, walkwayCellKeys }
}

/** Union of every walkway/dock/lift node reachable from a dock anchor, expressed
 *  as cell keys (not graph node ids) so it composes with the free-cell BFS. */
function computeReachableCellKeys(objects: ReadinessObject[], placements: ReadinessPlacement[]): Set<string> {
  const { cells } = buildWalkableCells(objects, placements)
  if (cells.length === 0) return new Set()
  const graph = buildWalkGraph(cells, 1)
  const anchorIds = graph.nodes.filter((n) => n.nodeType === 'dock').map((n) => n.id)
  if (anchorIds.length === 0) return new Set()

  const reachedNodeIds = new Set<number>()
  for (const anchor of anchorIds) {
    for (const nodeId of dijkstra(graph, anchor).keys()) reachedNodeIds.add(nodeId)
  }
  const keys = new Set<string>()
  for (const n of graph.nodes) {
    if (reachedNodeIds.has(n.id)) keys.add(cellKey(n.floor, n.x, n.y))
  }
  return keys
}

/** True iff some cell orthogonally adjacent to the footprint is already part of
 *  the reachable network. */
function isPlacementConnected(placement: ConnectPlacement, reachableKeys: ReadonlySet<string>): boolean {
  for (const c of cellsOfRect(placement.x, placement.y, placement.w, placement.h)) {
    for (const [dx, dy] of ORTHO) {
      if (reachableKeys.has(cellKey(placement.floor, c.x + dx, c.y + dy))) return true
    }
  }
  return false
}

/** Minimal array-backed deque: O(1) amortized push/pop at both ends for the
 *  common case (pushFront while a head buffer remains). */
class Deque<T> {
  private items: T[] = []
  private headIdx = 0

  get length(): number {
    return this.items.length - this.headIdx
  }

  pushBack(item: T): void {
    this.items.push(item)
  }

  pushFront(item: T): void {
    if (this.headIdx > 0) {
      this.headIdx -= 1
      this.items[this.headIdx] = item
    } else {
      this.items.unshift(item)
    }
  }

  popFront(): T | undefined {
    if (this.headIdx >= this.items.length) return undefined
    const value = this.items[this.headIdx]
    this.headIdx += 1
    return value
  }
}

interface BfsResult {
  dist: Map<string, number>
  prev: Map<string, string | null>
}

/** 0-1 BFS over free cells on a single floor. Sources (the current reachable
 *  network on this floor) start at distance 0. Entering a cell that is already a
 *  walkway object costs 0 (encourages reusing/merging existing corridors);
 *  entering any other free cell costs 1. */
function runBfs(
  floor: number,
  reachableKeys: ReadonlySet<string>,
  isFree: (floor: number, x: number, y: number) => boolean,
  walkwayCellKeys: ReadonlySet<string>,
  gridWidth: number,
  gridHeight: number,
): BfsResult {
  const dist = new Map<string, number>()
  const prev = new Map<string, string | null>()
  const deque = new Deque<string>()

  const sourceKeys = [...reachableKeys].filter((k) => k.startsWith(`${floor}:`)).sort()
  for (const key of sourceKeys) {
    dist.set(key, 0)
    prev.set(key, null)
    deque.pushBack(key)
  }

  for (let key = deque.popFront(); key !== undefined; key = deque.popFront()) {
    const d = dist.get(key)!
    const [, xs, ys] = key.split(':')
    const x = Number(xs)
    const y = Number(ys)
    for (const [dx, dy] of ORTHO) {
      const nx = x + dx
      const ny = y + dy
      if (nx < 0 || nx >= gridWidth || ny < 0 || ny >= gridHeight) continue
      if (!isFree(floor, nx, ny)) continue
      const nKey = cellKey(floor, nx, ny)
      const weight = walkwayCellKeys.has(nKey) ? 0 : 1
      const nDist = d + weight
      if (nDist < (dist.get(nKey) ?? Infinity)) {
        dist.set(nKey, nDist)
        prev.set(nKey, key)
        if (weight === 0) deque.pushFront(nKey)
        else deque.pushBack(nKey)
      }
    }
  }
  return { dist, prev }
}

interface Candidate {
  placement: ConnectPlacement
  entryKey: string
  distance: number
}

/** Scan every still-unreachable placement's adjacent free cells and return the
 *  one with the smallest BFS distance (input order breaks ties). */
function findBestCandidate(
  unreachable: ConnectPlacement[],
  bfsByFloor: ReadonlyMap<number, BfsResult>,
  isFree: (floor: number, x: number, y: number) => boolean,
  gridWidth: number,
  gridHeight: number,
): Candidate | null {
  let best: Candidate | null = null
  for (const placement of unreachable) {
    const bfs = bfsByFloor.get(placement.floor)
    if (!bfs) continue
    for (const c of cellsOfRect(placement.x, placement.y, placement.w, placement.h)) {
      for (const [dx, dy] of ORTHO) {
        const nx = c.x + dx
        const ny = c.y + dy
        if (nx < 0 || nx >= gridWidth || ny < 0 || ny >= gridHeight) continue
        if (!isFree(placement.floor, nx, ny)) continue
        const key = cellKey(placement.floor, nx, ny)
        const distance = bfs.dist.get(key)
        if (distance === undefined) continue
        if (best === null || distance < best.distance) best = { placement, entryKey: key, distance }
      }
    }
  }
  return best
}

/** Reconstruct the BFS path from the entry cell back to (and including) the
 *  source cell it descends from, entry-first. */
function reconstructPath(entryKey: string, prev: ReadonlyMap<string, string | null>): string[] {
  const path: string[] = []
  let cur: string | null = entryKey
  while (cur !== null) {
    path.push(cur)
    cur = prev.get(cur) ?? null
  }
  return path
}

function parseCellKey(key: string): { floor: number; x: number; y: number } {
  const [floor, x, y] = key.split(':').map(Number)
  return { floor, x, y }
}

export function autoConnectLayout(input: AutoConnectInput): AutoConnectResult {
  const { objects, placements, gridWidth, gridHeight, cellSizeM = 1 } = input

  const { carvedObjects, removedWallCells } = carveDocksUnderWalls(objects)
  const { wallCellKeys, obstacleCellKeys, walkwayCellKeys } = buildCellSets(carvedObjects)
  const placementCellKeys = new Set<string>()
  for (const p of placements) {
    for (const c of cellsOfRect(p.x, p.y, p.w, p.h)) placementCellKeys.add(cellKey(p.floor, c.x, c.y))
  }

  const isFree = (floor: number, x: number, y: number): boolean => {
    if (x < 0 || x >= gridWidth || y < 0 || y >= gridHeight) return false
    const key = cellKey(floor, x, y)
    return !wallCellKeys.has(key) && !obstacleCellKeys.has(key) && !placementCellKeys.has(key)
  }

  let currentObjects: ConnectObject[] = carvedObjects
  const addedWalkwayCells: Array<{ floor: number; x: number; y: number }> = []
  const reachableKeys = computeReachableCellKeys(currentObjects, placements)
  const currentWalkwayKeys = new Set(walkwayCellKeys)

  // At most one placement is resolved per iteration, so this terminates within
  // placements.length rounds.
  for (let i = 0; i < placements.length; i++) {
    const unreachable = placements.filter((p) => !isPlacementConnected(p, reachableKeys))
    if (unreachable.length === 0) break

    const floorsNeeded = new Set(unreachable.map((p) => p.floor))
    const bfsByFloor = new Map<number, BfsResult>()
    for (const floor of floorsNeeded) {
      bfsByFloor.set(floor, runBfs(floor, reachableKeys, isFree, currentWalkwayKeys, gridWidth, gridHeight))
    }

    const best = findBestCandidate(unreachable, bfsByFloor, isFree, gridWidth, gridHeight)
    if (best === null) break // remaining unreachable placements have no possible route

    const bfs = bfsByFloor.get(best.placement.floor)!
    const path = reconstructPath(best.entryKey, bfs.prev)

    const newObjects: ConnectObject[] = []
    for (const key of path) {
      if (reachableKeys.has(key)) continue // the source terminus — already part of the network
      reachableKeys.add(key)
      if (currentWalkwayKeys.has(key)) continue // an existing (now-merged) walkway cell, no new object needed
      const cell = parseCellKey(key)
      newObjects.push({ objectType: 'walkway', floor: cell.floor, x: cell.x, y: cell.y, w: 1, h: 1 })
      addedWalkwayCells.push(cell)
      currentWalkwayKeys.add(key)
    }
    currentObjects = [...currentObjects, ...newObjects]
  }

  // Cell size is threaded through only to satisfy evaluatePublishReadiness's
  // signature: every gate it runs is a connectivity predicate (a dock exists,
  // walkable cells remain, a bin is placed, each bin reaches a dock), and none
  // compares a distance against a threshold — so the answer is scale-invariant
  // and the metres it computes are discarded. It was hardcoded to 1 here, which
  // was true of every layout in existence until grid scale became settable.
  // Passing the real value costs nothing and stops this being a latent lie.
  const readiness = evaluatePublishReadiness({ objects: currentObjects, placements, cellSizeM })

  return {
    objects: currentObjects,
    addedWalkwayCells,
    removedWallCells,
    stillUnreachable: readiness.unreachableIds,
    changed: addedWalkwayCells.length + removedWallCells.length > 0,
  }
}
