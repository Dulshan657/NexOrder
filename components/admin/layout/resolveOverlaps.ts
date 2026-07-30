// One-owner-per-cell repair for a layout that already contains overlaps.
//
// Draw-time prevention (useLayoutEditorState's ALLOWED_COOCCUPANTS) stops NEW
// overlaps. It can't help a layout that already has them, and several paths
// produce them without ever going through the reducer's paint branch: cloning an
// older layout, and AI floor-plan import (whose resolveObjectOverlaps de-overlaps
// objects against each other but NOT against bins).
//
// Pure — no React, no I/O — so it is unit-testable and can be called from a memo.

import { OVERLAP_PRIORITY } from '@/supabase/functions/_shared/floorplan/extractionSchema'
import type { LayoutObjectType } from '@/types'
import { ALLOWED_COOCCUPANTS, type EditorObject, type EditorPlacement, type OccupantKind } from './useLayoutEditorState'

/** A cell where a bin and a structural object collided. The BIN kept the cell;
 *  the object lost it. Reported so the operator learns what was removed rather
 *  than discovering a missing wall later. */
export interface BinConflict {
  floor: number
  x: number
  y: number
  placementRef: string
  placementCode: string
  /** True when the bin already has a locationId — a real `locations` row that may
   *  hold stock, carry a printed label, or be referenced by an open pick task. */
  saved: boolean
  objectType: LayoutObjectType
}

/** Two bins claiming one cell. NOT repaired — both sides are expensive, so this
 *  is reported for the operator to resolve by hand. */
export interface PlacementConflict {
  floor: number
  x: number
  y: number
  refs: string[]
  codes: string[]
  savedCount: number
}

export interface OverlapRepair {
  /** Rebuilt object list. Objects that lost nothing are returned BY REFERENCE, so
   *  `changed === false` is a genuine identity no-op and the caller's banner can
   *  hide without a deep compare. */
  objects: EditorObject[]
  removedObjectCells: number
  removedObjects: number
  binConflicts: BinConflict[]
  placementConflicts: PlacementConflict[]
  changed: boolean
}

const key = (floor: number, x: number, y: number) => `${floor}:${x}:${y}`

/** Cells a rect covers. `Math.max(1, …)` mirrors the reducer's `covers()` guard
 *  against a 0/NaN w/h off a bad server row. */
function cellsOf(r: { floor: number; x: number; y: number; w: number; h: number }): Array<{ x: number; y: number }> {
  const out: Array<{ x: number; y: number }> = []
  for (let dy = 0; dy < Math.max(1, r.h); dy++) {
    for (let dx = 0; dx < Math.max(1, r.w); dx++) out.push({ x: r.x + dx, y: r.y + dy })
  }
  return out
}

function compatible(existing: OccupantKind, incoming: OccupantKind): boolean {
  return ALLOWED_COOCCUPANTS[incoming].includes(existing)
}

/**
 * Resolve every cell with more than one incompatible owner, in one pass.
 *
 * PRIORITY, highest first:
 *   storage placement → dock 0 · lift 1 · wall 2 · conveyor 3 · staging 4 ·
 *                       obstacle 5 · walkway 6      (label: exempt entirely)
 *
 * The object half is OVERLAP_PRIORITY imported verbatim, not copied, so a
 * hand-repaired layout and an AI-imported one resolve identically. Dock beating
 * wall specifically matters because autoConnectLayout's dock-over-wall carve
 * needs a dock left to carve toward.
 *
 * A STORAGE PLACEMENT OUTRANKS EVERY OBJECT AND IS NEVER REMOVED. A bin may
 * already carry a locationId — a real `locations` row with inventory_balances, a
 * printed label, possibly open pick tasks. Dropping it client-side and then
 * saving hits mutate-layout's destructive geometry replace, after which
 * publish-layout deactivates the now-unplaced location. A structural object costs
 * one drag to redraw. So the object loses the cell and the loss is REPORTED.
 *
 * Bin-vs-bin is the one case this cannot decide, so it is reported in
 * `placementConflicts` and left completely alone.
 *
 * Cell ownership is a SET, not a single winner, so the ALLOWED_COOCCUPANTS
 * exemptions hold: a dock and a staging floor both keep a shared cell, and
 * `label` objects are never rasterized at all (passed through by reference).
 */
export function resolveLayoutOverlaps(
  objects: readonly EditorObject[],
  placements: readonly EditorPlacement[],
): OverlapRepair {
  const owners = new Map<string, OccupantKind[]>()
  const placementConflicts: PlacementConflict[] = []
  const binConflicts: BinConflict[] = []

  const claim = (k: string, kind: OccupantKind) => {
    const bucket = owners.get(k)
    if (bucket) bucket.push(kind)
    else owners.set(k, [kind])
  }

  // 1. Placements first — they outrank everything and are never displaced.
  const placementAtCell = new Map<string, EditorPlacement>()
  for (const p of placements) {
    for (const c of cellsOf(p)) {
      const k = key(p.floor, c.x, c.y)
      const prior = placementAtCell.get(k)
      if (prior) {
        const existing = placementConflicts.find((pc) => pc.floor === p.floor && pc.x === c.x && pc.y === c.y)
        if (existing) {
          if (!existing.refs.includes(p.clientRef)) {
            existing.refs.push(p.clientRef)
            existing.codes.push(p.code)
            if (p.locationId) existing.savedCount++
          }
        } else {
          placementConflicts.push({
            floor: p.floor, x: c.x, y: c.y,
            refs: [prior.clientRef, p.clientRef],
            codes: [prior.code, p.code],
            savedCount: (prior.locationId ? 1 : 0) + (p.locationId ? 1 : 0),
          })
        }
      } else {
        placementAtCell.set(k, p)
        claim(k, 'storage')
      }
    }
  }

  // 2. Objects in (priority, input index) order. Ties break on index, first wins.
  const ranked = objects
    .map((o, index) => ({ o, index }))
    .filter(({ o }) => o.objectType !== 'label')
    .sort((a, b) => {
      const pa = OVERLAP_PRIORITY[a.o.objectType as Exclude<LayoutObjectType, 'label'>] ?? 99
      const pb = OVERLAP_PRIORITY[b.o.objectType as Exclude<LayoutObjectType, 'label'>] ?? 99
      return pa === pb ? a.index - b.index : pa - pb
    })

  const survivingCells = new Map<string, Array<{ x: number; y: number }>>()
  let removedObjectCells = 0

  for (const { o } of ranked) {
    const kept: Array<{ x: number; y: number }> = []
    for (const c of cellsOf(o)) {
      const k = key(o.floor, c.x, c.y)
      const existing = owners.get(k) ?? []
      const allowed = existing.every((e) => compatible(e, o.objectType))
      if (allowed) {
        claim(k, o.objectType)
        kept.push(c)
      } else {
        removedObjectCells++
        // Attribute the loss when a bin is what took the cell, so the summary can
        // name the bin the operator will now find un-walled.
        const bin = placementAtCell.get(k)
        if (bin) {
          binConflicts.push({
            floor: o.floor, x: c.x, y: c.y,
            placementRef: bin.clientRef, placementCode: bin.code,
            saved: !!bin.locationId, objectType: o.objectType,
          })
        }
      }
    }
    survivingCells.set(o.clientRef, kept)
  }

  // 3. Rebuild. All cells kept → return the object BY REFERENCE (so an unchanged
  //    layout is an identity no-op). None kept → drop. Some kept → one 1×1
  //    fragment per surviving cell; no rect decomposition is needed because the
  //    editor model is 1×1 anyway and the canvas re-merges contiguous cells
  //    visually.
  const out: EditorObject[] = []
  let removedObjects = 0
  let seq = 1
  for (const o of objects) {
    if (o.objectType === 'label') { out.push(o); continue }
    const kept = survivingCells.get(o.clientRef) ?? []
    const total = Math.max(1, o.w) * Math.max(1, o.h)
    if (kept.length === total) { out.push(o); continue }
    if (kept.length === 0) { removedObjects++; continue }
    for (const c of kept) {
      out.push({ ...o, clientRef: `${o.clientRef}#${seq++}`, x: c.x, y: c.y, w: 1, h: 1 })
    }
  }

  return {
    objects: out,
    removedObjectCells,
    removedObjects,
    binConflicts,
    placementConflicts,
    changed: removedObjectCells > 0 || removedObjects > 0,
  }
}
