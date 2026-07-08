// Warehouse Intelligence Engine — publish readiness.
//
// The single source of truth for "can this layout be published?". Extracted from
// publish-layout so BOTH the server (authoritative gate) and the frontend (live
// checklist) run the exact same checks off the same messages. Pure per the
// _shared/wie contract (no Deno globals / I/O) — the Vite designer imports it to
// render a live readiness panel with no server round-trip.
//
// The four checks mirror the publish gate: a dock exists, walkable cells remain
// after subtracting walls/footprints, at least one bin is placed, and every bin
// snaps to a walkway node reachable from a dock. Reachability is only meaningful
// once the first three pass, so it reports 'pending' until then (matching the
// server's early-return-before-reachability behavior).

import {
  buildWalkGraph,
  computeAnchorDistances,
  snapPlacementToNode,
} from './graph.ts'
import type { WalkCell } from './types.ts'

/** A layout object (wall/walkway/dock/lift/…) in grid coordinates. */
export interface ReadinessObject {
  objectType: string
  floor: number
  x: number
  y: number
  w: number
  h: number
}

/** A storage footprint keyed by a caller-chosen stable id (clientRef on the
 *  frontend, String(location_id) on the server) so unreachable ids map back. */
export interface ReadinessPlacement {
  id: string
  floor: number
  x: number
  y: number
  w: number
  h: number
}

export interface ReadinessInput {
  objects: ReadinessObject[]
  placements: ReadinessPlacement[]
  cellSizeM: number
}

/** Rejection codes double as check codes so the server maps checks → rejections
 *  1:1 (see publish-layout). */
export type ReadinessCode = 'no_dock' | 'no_walkways' | 'no_bins' | 'unreachable_bins'

export type CheckStatus = 'pass' | 'fail' | 'pending'

export interface ReadinessCheck {
  code: ReadinessCode
  /** Positive phrasing for the checklist row, e.g. "Loading dock". */
  label: string
  status: CheckStatus
  /** Actionable fix-it text; identical to the server rejection message. */
  message: string
}

export interface ReadinessResult {
  /** Always four checks, in display order: dock, walkways, bins, reachable. */
  checks: ReadinessCheck[]
  /** True when every check passes — i.e. publish would not be rejected. */
  ready: boolean
  /** Ids (as supplied) of bins with no walkway route from a dock. */
  unreachableIds: string[]
}

const LABELS: Record<ReadinessCode, string> = {
  no_dock: 'Loading dock',
  no_walkways: 'Walkways',
  no_bins: 'Storage bins',
  unreachable_bins: 'All bins reachable',
}

const MESSAGES: Record<ReadinessCode, string> = {
  no_dock: 'Add at least one dock — putaway routes start from a dock.',
  no_walkways: 'Draw walkways connecting docks to your storage.',
  no_bins: 'Place at least one storage bin before publishing.',
  unreachable_bins: 'have no walkway route from a dock. Connect them and republish.',
}

function cellKey(floor: number, x: number, y: number): string {
  return `${floor}:${x}:${y}`
}

export interface WalkableCells {
  cells: WalkCell[]
  /** Whether any dock object was drawn — tracked from the raw objects (before
   *  footprint subtraction) so a bin painted over a dock can't flip it false. */
  hasDock: boolean
}

/**
 * Build the walkable cell set: walkway/dock/lift cells minus walls and storage
 * footprints. Shared by the readiness check and the publish commit path so both
 * derive the routing skeleton from exactly the same cells.
 */
export function buildWalkableCells(objects: ReadinessObject[], placements: ReadinessPlacement[]): WalkableCells {
  const cellMap = new Map<string, WalkCell>()
  const addCell = (floor: number, x: number, y: number, isDock: boolean, isLift: boolean): void => {
    const key = cellKey(floor, x, y)
    const existing = cellMap.get(key)
    if (existing) { existing.isDock = existing.isDock || isDock; existing.isLift = existing.isLift || isLift }
    else cellMap.set(key, { x, y, floor, isDock, isLift })
  }
  let hasDock = false
  for (const o of objects) {
    if (o.objectType !== 'walkway' && o.objectType !== 'dock' && o.objectType !== 'lift') continue
    const isDock = o.objectType === 'dock'
    const isLift = o.objectType === 'lift'
    if (isDock) hasDock = true
    for (let dy = 0; dy < o.h; dy++) {
      for (let dx = 0; dx < o.w; dx++) addCell(o.floor, o.x + dx, o.y + dy, isDock, isLift)
    }
  }

  // Walls and storage footprints are NOT walkable — subtract them so routes can't
  // pass through a rack or wall even if a walkway was painted over them.
  const removeCell = (floor: number, x: number, y: number): void => { cellMap.delete(cellKey(floor, x, y)) }
  for (const o of objects) {
    if (o.objectType !== 'wall') continue
    for (let dy = 0; dy < o.h; dy++) {
      for (let dx = 0; dx < o.w; dx++) removeCell(o.floor, o.x + dx, o.y + dy)
    }
  }
  for (const p of placements) {
    for (let dy = 0; dy < p.h; dy++) {
      for (let dx = 0; dx < p.w; dx++) removeCell(p.floor, p.x + dx, p.y + dy)
    }
  }

  return { cells: [...cellMap.values()], hasDock }
}

/**
 * Evaluate the four publish gates. Pure and deterministic; safe to call on every
 * keystroke in the designer.
 */
export function evaluatePublishReadiness(input: ReadinessInput): ReadinessResult {
  const { objects, placements } = input
  const cellSizeM = Number(input.cellSizeM) || 1

  const { cells, hasDock } = buildWalkableCells(objects, placements)

  const dockPass = hasDock
  const walkwaysPass = cells.length > 0
  const binsPass = placements.length > 0

  // ── Reachability: only meaningful once the prerequisites hold ────────────────
  let unreachableIds: string[] = []
  let reachableStatus: CheckStatus = 'pending'
  if (dockPass && walkwaysPass && binsPass) {
    const graph = buildWalkGraph(cells, cellSizeM)
    const anchorIds = graph.nodes.filter((n) => n.nodeType === 'dock').map((n) => n.id)
    const distanceRows = computeAnchorDistances(graph, anchorIds)
    const reachable = new Set(distanceRows.map((r) => r.toNodeId))
    for (const p of placements) {
      const snap = snapPlacementToNode(
        { locationId: 0, floor: p.floor, x: p.x, y: p.y, w: p.w, h: p.h },
        graph.nodes,
        cellSizeM,
      )
      if (snap.graphNodeId === null || !reachable.has(snap.graphNodeId)) unreachableIds.push(p.id)
    }
    reachableStatus = unreachableIds.length === 0 ? 'pass' : 'fail'
  }

  const checks: ReadinessCheck[] = [
    { code: 'no_dock', label: LABELS.no_dock, status: dockPass ? 'pass' : 'fail', message: MESSAGES.no_dock },
    { code: 'no_walkways', label: LABELS.no_walkways, status: walkwaysPass ? 'pass' : 'fail', message: MESSAGES.no_walkways },
    { code: 'no_bins', label: LABELS.no_bins, status: binsPass ? 'pass' : 'fail', message: MESSAGES.no_bins },
    {
      code: 'unreachable_bins',
      label: LABELS.unreachable_bins,
      status: reachableStatus,
      message: `${unreachableIds.length} bin(s) ${MESSAGES.unreachable_bins}`,
    },
  ]

  return { checks, ready: checks.every((c) => c.status === 'pass'), unreachableIds }
}
