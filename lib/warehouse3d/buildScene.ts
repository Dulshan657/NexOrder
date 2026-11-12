// The 3D live map's scene model (NX-0035). Pure: no three, no React.
//
// Everything the 3D view draws is decided HERE, in metres, from the very data the
// 2D map draws from — placements, objects, `binFillPct`, the overlay's
// `binColors`, zone profiles. The renderer only turns these specs into meshes, so
// the decisions are testable in node (jsdom has no WebGL) and the two views cannot
// disagree about what a level holds or which colour it is.
//
// Axes: grid x → world X, grid y → world Z, Y is up. Every position is a box
// CENTRE, which is what three.js meshes are positioned by.

import type { InventoryLocation, LayoutObject, LayoutObjectType, LayoutPlacement } from '@/types'
import { groupPlacementsByCell } from '@/components/admin/layout/placementGroups'
import { objectRegions, regionBounds } from '@/components/admin/layout/objectRegions'
import { OBJECT_FILL } from '@/components/admin/layout/layoutPalette'
import { occupancyFill } from '@/components/inventory/warehouse/warehouseOverlays'
import { spineRows } from '@/components/inventory/warehouse/levelSpine'
import { zoneTint } from '@/components/inventory/warehouse/zoneTints'
import { cellToWorld } from './dimensions'

export type Vec3 = [number, number, number]

export interface BuildSceneInput {
  layout: { cellSizeM: number; gridWidth: number; gridHeight: number }
  placements: readonly LayoutPlacement[]
  objects: readonly LayoutObject[]
  /** Only this floor is built. */
  floor: number
  locationsById: Map<number, InventoryLocation>
  binFillPct: Map<number, number | null>
  /** The 2D overlay's per-bin colour, when one is active. Wins over occupancy;
   *  while it is defined, a bin it omits is neutral, never its occupancy colour. */
  binColors?: Map<number, string>
  zoneTypeByProfileId: Map<number, string>
  levelHeightM: number
  /** Find stock (NX-0036): locations holding the searched product. When set,
   *  every other level is dimmed and each matching rack gets a beacon. */
  highlightIds?: ReadonlySet<number> | null
}

/** One rack level (or a legacy single bin) — the thing a click selects. */
export interface LevelBox {
  locationId: number
  levelIndex: number
  center: Vec3
  size: Vec3
  /** 0..1+; null = no capacity configured. */
  fillPct: number | null
  fillKnown: boolean
  color: string
  /** Where `color` came from. An overlay colour wins regardless of fill; a level
   *  the overlay says nothing about is neutral, as it is on the 2D map. */
  colorSource: 'overlay' | 'occupancy' | 'neutral' | 'dimmed'
  /** Holds the product being searched for (NX-0036). */
  highlighted: boolean
}

/** The uprights around a rack's stack of levels. */
export interface RackFrame {
  key: string
  /** The RACK location for a levelled rack; the bin itself for a legacy bin. */
  locationId: number | null
  center: Vec3
  size: Vec3
  levelCount: number
  /** The zone the rack sits in, by materialized ancestry (mig 00096). */
  zoneType: string | null
}

export interface ObjectBox {
  id: number
  objectType: LayoutObjectType
  center: Vec3
  size: Vec3
  color: string
}

/** A floating name: a painted area or a floor sign. */
export interface SceneLabel {
  key: string
  kind: 'area' | 'sign'
  text: string
  position: Vec3
}

/** A painted area's floor wash, one per cell so L-shapes stay L-shaped. */
export interface AreaTile {
  key: string
  center: Vec3
  size: Vec3
  color: string
}

export interface SceneBounds {
  width: number
  depth: number
  /** Tallest thing in the scene, for framing. */
  height: number
  center: Vec3
}

export interface SceneModel {
  levels: LevelBox[]
  racks: RackFrame[]
  objects: ObjectBox[]
  areaTiles: AreaTile[]
  labels: SceneLabel[]
  /** One point above each rack holding the searched product; empty otherwise. */
  beacons: Vec3[]
  bounds: SceneBounds
}

/** Physical heights for the non-storage objects, in metres. Walkways, staging and
 *  areas are floor markings, so they are a sliver, not a slab. */
const OBJECT_HEIGHT_M: Partial<Record<LayoutObjectType, number>> = {
  wall: 3,
  lift: 3,
  obstacle: 2,
  conveyor: 0.9,
  dock: 0.25,
  walkway: 0.02,
  staging: 0.02,
}
/** Drawn as labels / washes instead of boxes. */
const NOT_A_BOX: ReadonlySet<LayoutObjectType> = new Set<LayoutObjectType>(['area', 'label'])
const LABEL_LIFT_M = 0.5
const NAMED_BOX_TYPES: ReadonlySet<LayoutObjectType> = new Set<LayoutObjectType>(['obstacle', 'staging'])
/** A level an active overlay deliberately leaves uncoloured (Blocks, congestion). */
export const OVERLAY_NEUTRAL = '#e7e5e4' // stone-200
/** A level that does not hold the searched product. Lighter than any fill
 *  colour, so the matches are the only colour on the floor. */
export const DIMMED_LEVEL = '#f5f5f4' // stone-100
/** Gap between a rack's top and its find-stock beacon. */
const BEACON_LIFT_M = 0.8
const r = (n: number) => Math.round(n * 1e6) / 1e6

export function buildScene(input: BuildSceneInput): SceneModel {
  const { layout, floor, levelHeightM } = input
  const cell = layout.cellSizeM
  const levels: LevelBox[] = []
  const racks: RackFrame[] = []
  const beacons: Vec3[] = []
  const highlight = input.highlightIds ?? null

  const onFloor = input.placements.filter((p) => p.floor === floor) as LayoutPlacement[]
  for (const group of groupPlacementsByCell(onFloor)) {
    const { x: cx, z: cz } = cellToWorld(group.x + group.w / 2, group.y + group.h / 2, cell)
    const footprint = { w: r(group.w * cell), d: r(group.h * cell) }
    // A legacy bin has no location-level ordering to do, but spineRows still
    // gives it the same shape (and drops a placement with no location row).
    const rows = spineRows(group.items, input.locationsById, input.binFillPct)
    rows.forEach((row, i) => {
      const fillKnown = row.fillPct != null
      const overlayColor = input.binColors?.get(row.locationId)
      const highlighted = highlight?.has(row.locationId) ?? false
      const dimmed = highlight != null && !highlighted
      const colorSource = dimmed ? 'dimmed' : overlayColor ? 'overlay' : input.binColors ? 'neutral' : 'occupancy'
      levels.push({
        locationId: row.locationId,
        levelIndex: row.levelIndex,
        center: [cx, r((i + 0.5) * levelHeightM), cz],
        size: [footprint.w, levelHeightM, footprint.d],
        fillPct: row.fillPct,
        fillKnown,
        color: dimmed
          ? DIMMED_LEVEL
          : overlayColor ?? (input.binColors ? OVERLAY_NEUTRAL : occupancyFill(row.fillPct)),
        colorSource,
        highlighted,
      })
    })
    if (rows.length === 0) continue

    const first = input.locationsById.get(rows[0].locationId)
    const rackId = group.isLegacyBin ? rows[0].locationId : first?.parentId ?? null
    const height = r(rows.length * levelHeightM)
    // One beacon per RACK, however many of its levels hold the product.
    if (highlight && rows.some((row) => highlight.has(row.locationId))) {
      beacons.push([cx, r(height + BEACON_LIFT_M), cz])
    }
    racks.push({
      key: group.key,
      locationId: rackId,
      center: [cx, r(height / 2), cz],
      size: [footprint.w, height, footprint.d],
      levelCount: rows.length,
      zoneType: zoneTypeOf(rackId, input.locationsById, input.zoneTypeByProfileId),
    })
  }

  const objects: ObjectBox[] = []
  const objectLabels: SceneLabel[] = []
  for (const o of input.objects) {
    if (o.floor !== floor || NOT_A_BOX.has(o.objectType)) continue
    const h = OBJECT_HEIGHT_M[o.objectType] ?? 0.05
    const { x, z } = cellToWorld(o.x + o.w / 2, o.y + o.h / 2, cell)
    objects.push({
      id: o.id,
      objectType: o.objectType,
      center: [x, r(h / 2), z],
      size: [r(o.w * cell), h, r(o.h * cell)],
      color: OBJECT_FILL[o.objectType] ?? OBJECT_FILL.obstacle,
    })
    // A named room or staging bay ("Cold room", "Returns") is named on the 2D
    // map so it is not an anonymous box; same here.
    const name = typeof o.meta?.name === 'string' ? o.meta.name.trim() : ''
    if (name && NAMED_BOX_TYPES.has(o.objectType)) {
      objectLabels.push({ key: `obj:${o.id}`, kind: 'sign', text: name, position: [x, r(h + LABEL_LIFT_M), z] })
    }
  }

  const { areaTiles, labels } = buildAnnotations(input, cell, levelHeightM)
  const tallest = Math.max(0, ...racks.map((k) => k.size[1]), ...objects.map((o) => o.size[1]))

  return {
    levels,
    racks,
    objects,
    areaTiles,
    labels: [...labels, ...objectLabels],
    beacons,
    bounds: {
      width: r(layout.gridWidth * cell),
      depth: r(layout.gridHeight * cell),
      height: tallest,
      center: [r((layout.gridWidth * cell) / 2), 0, r((layout.gridHeight * cell) / 2)],
    },
  }
}

/** Area washes and floating names. Regions come from the same flood fill the 2D
 *  canvases use (`objectRegions`), so an area's name is drawn once per region,
 *  and a sign's text once per sign, exactly as on the 2D map. */
function buildAnnotations(input: BuildSceneInput, cell: number, levelHeightM: number) {
  const areaTiles: AreaTile[] = []
  const labels: SceneLabel[] = []
  for (const region of objectRegions(input.objects as LayoutObject[], input.floor)) {
    if (region.objectType !== 'area' && region.objectType !== 'label') continue
    const name = typeof region.meta?.name === 'string' ? region.meta.name.trim() : ''
    const b = regionBounds(region)
    const { x, z } = cellToWorld(b.x + b.w / 2, b.y + b.h / 2, cell)

    if (region.objectType === 'area') {
      const profileId = region.meta?.zoneProfileId as number | undefined
      const color = profileId != null
        ? zoneTint(input.zoneTypeByProfileId.get(profileId))
        : OBJECT_FILL.area
      for (const c of region.cells) {
        const w = cellToWorld(c.x + 0.5, c.y + 0.5, cell)
        areaTiles.push({ key: `${region.key}:${c.x}:${c.y}`, center: [w.x, 0.01, w.z], size: [cell, 0.01, cell], color })
      }
    }
    if (!name) continue
    labels.push({
      key: region.key,
      kind: region.objectType === 'area' ? 'area' : 'sign',
      text: name,
      // Areas float above the racking they name; signs sit at head height.
      position: [x, region.objectType === 'area' ? r(levelHeightM * 3 + LABEL_LIFT_M) : 2.2, z],
    })
  }
  return { areaTiles, labels }
}

/** The zone a rack sits in, by walking `parentId` to a `kind='ZONE'` ancestor.
 *  SQL reads `materialized_path` instead; the two agree because zone binding
 *  (mig 00096) writes both in one batch — the same caveat as
 *  `putawayGuards.resolveZoneProfileId`. Never `zone_profile_id` on a bin. */
function zoneTypeOf(
  locationId: number | null,
  locationsById: Map<number, InventoryLocation>,
  zoneTypeByProfileId: Map<number, string>,
): string | null {
  let cur = locationId != null ? locationsById.get(locationId) : undefined
  for (let hops = 0; cur && hops < 16; hops++) {
    if (cur.kind === 'ZONE') {
      return cur.zoneProfileId != null ? zoneTypeByProfileId.get(cur.zoneProfileId) ?? null : null
    }
    cur = cur.parentId != null ? locationsById.get(cur.parentId) : undefined
  }
  return null
}
