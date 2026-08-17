// Turning what the operator painted into what a sweep can plan.
//
// Pure functions over data the Warehouse tab has already fetched — no queries. The
// server re-derives every one of these from the database, which is what protects a
// stale tab; this copy exists so the operator can SEE the selection and its proposed
// codes without a round trip per keystroke (the `:recode:` bucket is 10/min).
//
// Lifted out of RackedWorkspace, which was carrying them inline.

import type { InventoryLocation, LayoutObject, LayoutPlacement } from '@/types'
import { areaForRect, buildAreaIndex } from '@/lib/locationNaming'
import { sanitizeBlock, type RecodeUnit } from '@/lib/codePattern'
import { placementsAtCell, placementsInRect, type MarqueeRect } from './useRecodeSelection'

/** Kinds a sweep may touch, mirroring the engine's RECODABLE_KINDS. A ZONE or AISLE
 *  code is a path segment for every bin beneath it, so letting the brush appear to
 *  grab one would only make the server's refusal confusing. */
const UNSWEEPABLE = new Set(['WAREHOUSE', 'ZONE', 'AISLE'])

export type LocationsById = ReadonlyMap<number, InventoryLocation>

/** The warehouse's own code — the first segment of any descendant's path. No extra
 *  query: `materialized_path` is `<WH>/<...>` by construction. */
export function warehouseCodeOf(locationsById: LocationsById): string {
  for (const loc of locationsById.values()) {
    const head = loc.materializedPath.split('/')[0]
    if (head) return head
  }
  return ''
}

/** rack id → its SHELF children. A levelled rack holds no placement row of its own,
 *  so this is both how a hit rolls UP to the unit and how the highlight gets back
 *  DOWN to something the canvas actually draws. */
export function buildLevelIdsByRack(locationsById: LocationsById): Map<number, number[]> {
  const map = new Map<number, number[]>()
  for (const loc of locationsById.values()) {
    if (loc.kind !== 'SHELF' || loc.parentId == null) continue
    const bucket = map.get(loc.parentId) ?? []
    bucket.push(loc.id)
    map.set(loc.parentId, bucket)
  }
  return map
}

/** A placement's owning unit: a SHELF folds up to its rack, everything else is
 *  itself. Returns null for anything a sweep may not touch. */
function unitIdFor(placement: LayoutPlacement, locationsById: LocationsById): number | null {
  const loc = locationsById.get(placement.locationId)
  if (!loc) return null
  const unitId = loc.kind === 'SHELF' && loc.parentId != null ? loc.parentId : loc.id
  const unit = locationsById.get(unitId)
  if (!unit || UNSWEEPABLE.has(unit.kind)) return null
  return unitId
}

/** Units under one painted cell. The brush's resolver. */
export function unitsAtCell(
  placements: readonly LayoutPlacement[],
  locationsById: LocationsById,
  floor: number,
  x: number,
  y: number,
): number[] {
  const hits = new Set<number>()
  for (const p of placementsAtCell(placements, floor, x, y)) {
    const id = unitIdFor(p, locationsById)
    if (id != null) hits.add(id)
  }
  return [...hits]
}

/** Units wholly inside a band. The rectangle brush's resolver — `contain`, so a
 *  rack the band merely clips is left alone. */
export function unitsInRect(
  placements: readonly LayoutPlacement[],
  locationsById: LocationsById,
  rect: MarqueeRect,
): number[] {
  const hits = new Set<number>()
  for (const p of placementsInRect(placements, rect, 'contain')) {
    const id = unitIdFor(p, locationsById)
    if (id != null) hits.add(id)
  }
  return [...hits]
}

/** Every sweepable unit inside a painted named area, for the one-click shortcut.
 *  Containment is `areaForRect`'s majority-of-cells vote — imported, never
 *  re-implemented, so selecting an area and NAMING a rack after it can never
 *  disagree about which area a straddling rack is in. */
export function unitsInArea(
  placements: readonly LayoutPlacement[],
  locationsById: LocationsById,
  objects: readonly LayoutObject[],
  areaName: string,
): number[] {
  const index = buildAreaIndex(objects as any)
  const hits = new Set<number>()
  for (const p of placements) {
    if (areaForRect(index, p as any) !== areaName) continue
    const id = unitIdFor(p, locationsById)
    if (id != null) hits.add(id)
  }
  return [...hits]
}

/** Which areas a selection spans, for the "this crosses two areas" note. Sorted so
 *  the message is stable between renders. */
export function areasOfSelection(
  selected: ReadonlySet<number>,
  placementsByUnit: ReadonlyMap<number, LayoutPlacement>,
  objects: readonly LayoutObject[],
): string[] {
  const index = buildAreaIndex(objects as any)
  const names = new Set<string>()
  for (const id of selected) {
    const p = placementsByUnit.get(id)
    if (!p) continue
    const name = areaForRect(index, p as any)
    if (name) names.add(name)
  }
  return [...names].sort()
}

/**
 * A unit id → the placement that gives it geometry.
 *
 * A levelled rack has no placement of its own, so it borrows its first level's —
 * which is correct, since every level of a rack sits on the same cells. Without this
 * a rack would have no (x, y) to frame and would silently fall out of the numbering.
 */
export function buildUnitPlacements(
  placements: readonly LayoutPlacement[],
  locationsById: LocationsById,
): Map<number, LayoutPlacement> {
  const map = new Map<number, LayoutPlacement>()
  for (const p of placements) {
    const id = unitIdFor(p, locationsById)
    if (id == null) continue
    const existing = map.get(id)
    // Lowest level wins, purely for determinism.
    if (!existing || (p.locationId < existing.locationId)) map.set(id, p)
  }
  return map
}

/** The client's copy of what the server plans from. `takenCodes` here is
 *  SITE-SCOPED, where the server's is global — see the note in recodePlanView. */
export function unitsFromSelection(
  selected: ReadonlySet<number>,
  locationsById: LocationsById,
  unitPlacements: ReadonlyMap<number, LayoutPlacement>,
  levelIdsByRack: ReadonlyMap<number, number[]>,
): RecodeUnit[] {
  const units: RecodeUnit[] = []
  for (const id of selected) {
    const loc = locationsById.get(id)
    const p = unitPlacements.get(id)
    if (!loc || !p) continue
    const levels = (levelIdsByRack.get(id) ?? [])
      .map((lid) => locationsById.get(lid))
      .filter((l): l is InventoryLocation => !!l && l.levelIndex != null)
      .sort((a, b) => (a.levelIndex ?? 0) - (b.levelIndex ?? 0))
      .map((l) => ({ id: l.id, levelIndex: l.levelIndex as number, code: l.code }))
    units.push({
      id,
      floor: p.floor ?? 0,
      x: p.x,
      y: p.y,
      code: loc.code,
      codeBlock: loc.codeBlock ?? null,
      codeSeq: loc.codeSeq ?? null,
      kind: loc.kind,
      levels: levels.length > 0 ? levels : undefined,
    })
  }
  return units
}

/** Units already carrying a block and NOT in the selection — the incumbents whose
 *  codes a growing sweep must not move. */
export function incumbentsOfBlock(
  block: string,
  selected: ReadonlySet<number>,
  locationsById: LocationsById,
  unitPlacements: ReadonlyMap<number, LayoutPlacement>,
  levelIdsByRack: ReadonlyMap<number, number[]>,
): RecodeUnit[] {
  const clean = sanitizeBlock(block)
  if (!clean) return []
  const ids = new Set<number>()
  for (const [id, loc] of locationsById) {
    if (loc.codeBlock === clean && !selected.has(id) && unitPlacements.has(id)) ids.add(id)
  }
  return unitsFromSelection(ids, locationsById, unitPlacements, levelIdsByRack)
}

/** Every code on this SITE, lowercased → owning id, for the client-side collision
 *  check. Deliberately narrower than the server's global map; see recodePlanView. */
export function takenCodesFromLocations(locationsById: LocationsById): Map<string, number> {
  const map = new Map<string, number>()
  for (const loc of locationsById.values()) map.set(loc.code.toLowerCase(), loc.id)
  return map
}

export interface BlockCensusRow {
  block: string
  units: number
  /** Lowest and highest number minted in the block, for "BULK 1–48". */
  minSeq: number | null
  maxSeq: number | null
  ids: number[]
}

/**
 * What has been swept so far, per block.
 *
 * `code_block IS NULL` is the provenance signal 00107 added and is exactly "this
 * code was not minted by a pattern" — true of every bin drawn before the sweep tool
 * existed. So the un-swept count is a fact, not a heuristic.
 */
export function blockCensus(locationsById: LocationsById, sweepable: ReadonlySet<number>): {
  blocks: BlockCensusRow[]
  swept: number
  total: number
} {
  const byBlock = new Map<string, BlockCensusRow>()
  let swept = 0
  let total = 0
  for (const id of sweepable) {
    const loc = locationsById.get(id)
    if (!loc) continue
    total += 1
    const block = loc.codeBlock
    if (!block) continue
    swept += 1
    const row = byBlock.get(block) ?? { block, units: 0, minSeq: null, maxSeq: null, ids: [] }
    row.units += 1
    row.ids.push(id)
    if (loc.codeSeq != null) {
      row.minSeq = row.minSeq == null ? loc.codeSeq : Math.min(row.minSeq, loc.codeSeq)
      row.maxSeq = row.maxSeq == null ? loc.codeSeq : Math.max(row.maxSeq, loc.codeSeq)
    }
    byBlock.set(block, row)
  }
  return {
    blocks: [...byBlock.values()].sort((a, b) => a.block.localeCompare(b.block)),
    swept,
    total,
  }
}
