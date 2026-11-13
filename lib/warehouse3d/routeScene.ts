// The pick walk in 3D (NX-0037). Pure: no three, no React.
//
// Each stop carries the walk the engine measured (corner grid cells, from
// `recommend-pick-route`); this turns it into polylines in metres at walking
// height on the floor being viewed, with a riser from the aisle up to the rack
// level being picked. A stop without a path (an older function) gets a straight
// leg from the previous stop, which is what the 2D map has always drawn.

import type { PickRouteStop } from '@/types'
import type { LevelBox, Vec3 } from './buildScene'

/** Line height above the floor: clear of floor markings, below a pallet deck. */
export const WALK_HEIGHT_M = 0.15
/** Marker gap above the top of the stop's level. */
const MARKER_LIFT_M = 0.6

export interface RouteSceneInput {
  stops: readonly PickRouteStop[]
  /** The scene's levels — this floor only, so a stop elsewhere has no level. */
  levels: readonly LevelBox[]
  floor: number
  cellSizeM: number
}

export interface RouteMarker {
  /** The first stop at this location. */
  sequence: number
  locationId: number
  position: Vec3
  /** Every stop at this location, e.g. "3·4" — two lines from one bin share a
   *  marker rather than drawing one number over the other. */
  label: string
}

export interface RouteScene {
  lines: Vec3[][]
  markers: RouteMarker[]
}

const r = (n: number) => Math.round(n * 1e6) / 1e6

export function routeScene({ stops, levels, floor, cellSizeM }: RouteSceneInput): RouteScene {
  const levelById = new Map(levels.map((l) => [l.locationId, l]))
  const toWorld = (p: { x: number; y: number }): Vec3 =>
    [r((p.x + 0.5) * cellSizeM), WALK_HEIGHT_M, r((p.y + 0.5) * cellSizeM)]

  const lines: Vec3[][] = []
  const markers: RouteMarker[] = []
  let prevEnd: Vec3 | null = null

  for (const stop of [...stops].sort((a, b) => a.sequence - b.sequence)) {
    const lvl = levelById.get(stop.locationId)
    const path = stop.path ?? []

    if (path.length > 0) {
      // Split into runs on this floor: a lift leg leaves one floor and arrives on
      // another, and each floor draws only its own half.
      const runs: Vec3[][] = []
      let run: Vec3[] | null = null
      for (const p of path) {
        if (p.floor === floor) {
          if (!run) runs.push((run = []))
          run.push(toWorld(p))
        } else {
          run = null
        }
      }
      // The riser belongs to the run that reaches the stop: the path's last
      // point must be on this floor and the level must be drawn here.
      const endsHere = path[path.length - 1].floor === floor
      if (endsHere && lvl && runs.length > 0) {
        const last = runs[runs.length - 1]
        const aisle = last[last.length - 1]
        last.push([aisle[0], lvl.center[1], aisle[2]], lvl.center)
      }
      for (const pts of runs) if (pts.length >= 2) lines.push(pts)
    } else if (lvl && prevEnd) {
      lines.push([prevEnd, lvl.center])
    }

    if (lvl) {
      const existing = markers.find((m) => m.locationId === stop.locationId)
      if (existing) {
        existing.label = `${existing.label}·${stop.sequence}`
      } else {
        markers.push({
          sequence: stop.sequence,
          locationId: stop.locationId,
          position: [lvl.center[0], r(lvl.center[1] + lvl.size[1] / 2 + MARKER_LIFT_M), lvl.center[2]],
          label: String(stop.sequence),
        })
      }
    }
    // A stop on another floor breaks the chain: never draw a straight line
    // through the ceiling to it.
    prevEnd = lvl ? lvl.center : null
  }
  return { lines, markers }
}
