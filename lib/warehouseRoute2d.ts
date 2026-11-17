// The pick walk on the 2D map (NX-0037). Pure: no React, no SVG.
//
// The 2D twin of lib/warehouse3d/routeScene.ts. Each stop carries the walk the
// engine measured (corner grid cells from `recommend-pick-route`); this turns it
// into polylines in CELL units on the floor being viewed — through the aisles,
// then into the bay — instead of the straight stop-to-stop lines the map drew
// before, which cut through racks and never started at the dock. A stop without
// a path (an older function) still gets a straight leg from the previous stop.

import type { PickRouteStop } from '@/types'

/** The slice of a layout placement the route needs (cell units). */
export interface RoutePlacement {
  x: number
  y: number
  w: number
  h: number
  floor: number
}

export type Point2 = [number, number]

export interface RouteMarker2d {
  locationId: number
  x: number
  y: number
  /** Every stop at this location, e.g. "3·4" — one marker, not two stacked. */
  label: string
}

export interface Route2d {
  legs: Point2[][]
  markers: RouteMarker2d[]
  /** The dock, when the walk starts on the floor being viewed. */
  start: Point2 | null
}

const cellCentre = (p: { x: number; y: number }): Point2 => [p.x + 0.5, p.y + 0.5]
const bayCentre = (p: RoutePlacement): Point2 => [p.x + p.w / 2, p.y + p.h / 2]

export function routeOverlay2d(
  stops: readonly PickRouteStop[],
  placements: ReadonlyMap<number, RoutePlacement>,
  floor: number,
): Route2d {
  const legs: Point2[][] = []
  const markers: RouteMarker2d[] = []
  let start: Point2 | null = null
  let prevEnd: Point2 | null = null
  let first = true

  for (const stop of [...stops].sort((a, b) => a.sequence - b.sequence)) {
    const pl = placements.get(stop.locationId)
    const here = pl && pl.floor === floor ? bayCentre(pl) : null
    const path = stop.path ?? []
    if (first && path.length > 0 && path[0].floor === floor) start = cellCentre(path[0])
    first = false

    if (path.length > 0) {
      // Runs on this floor only: a lift leg leaves one floor and arrives on another.
      const runs: Point2[][] = []
      let run: Point2[] | null = null
      for (const p of path) {
        if (p.floor === floor) {
          if (!run) runs.push((run = []))
          run.push(cellCentre(p))
        } else {
          run = null
        }
      }
      // Step from the aisle into the bay, on the run that reaches the stop.
      if (here && path[path.length - 1].floor === floor && runs.length > 0) runs[runs.length - 1].push(here)
      for (const pts of runs) if (pts.length >= 2) legs.push(pts)
    } else if (here && prevEnd) {
      legs.push([prevEnd, here])
    }

    if (here) {
      const existing = markers.find((m) => m.locationId === stop.locationId)
      if (existing) existing.label = `${existing.label}·${stop.sequence}`
      else markers.push({ locationId: stop.locationId, x: here[0], y: here[1], label: String(stop.sequence) })
    }
    // A stop on another floor breaks the chain — never a line through the ceiling.
    prevEnd = here
  }
  return { legs, markers, start }
}
