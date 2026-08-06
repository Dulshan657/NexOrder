// Floor signs — the pure half of live signage editing.
//
// A SIGN IS NOT AN AREA, and the whole point of this module is that it stays
// that way. Both are painted cells carrying `meta.name`, both are inert in
// routing, and both are therefore editable on a PUBLISHED layout — but an area
// (00090/00094/00096) is warehouse vocabulary with consequences: it renames the
// bins standing on it and re-parents them under a ZONE. A sign is wayfinding
// text and nothing else. It touches no location row, no name pool, no parentage.
//
// That is why signs reuse `object_type = 'label'`, which has existed since
// 00045 and which nothing in the engine reads: buildWalkableCells
// (publishReadiness.ts) whitelists walkway/dock/lift/staging and subtracts
// wall/conveyor; publish-layout reads object_type solely to collect
// staging_location_id; resolveOverlaps exempts labels outright. A sign
// contributes no graph node, no edge weight and no access_offset_m.
//
// WHY THIS DELEGATES RATHER THAN REIMPLEMENTS. The packing, the canonical cell
// ordering and the fingerprint are shared with areaPaint.ts, which explains at
// length why a second copy would be fatal: `base_fingerprint` is computed in the
// browser and checked in the isolate, so a byte of drift 409s every save on a
// picture nobody changed. Forking would duplicate fnv1a and the comparator.
// Signs get their own vocabulary, not their own arithmetic.
//
// Pure and IO-free — this directory is under the purity contract
// (__tests__/wie/purity.test.ts). Re-exported by lib/signPaint.ts; import from
// there in components, never from supabase/functions.

import {
  areaCellsFingerprint,
  areaObjectsFromSpecs,
  areaSpecsFromObjects,
  diffAreas,
  expandAreaRuns,
  packAreaRuns,
  type AreaGeometryDelta,
  type AreaPaintCell,
  type AreaPaintRun,
} from './areaPaint.ts'
// The row shape both modules fold. Sourced from locationNaming rather than
// re-exported through areaPaint so there is one declaration, not two names for it.
import type { AreaCellSource } from './locationNaming.ts'

/** Run-length packing is a WIRE FORMAT ONLY, exactly as it is for areas: storage
 *  stays 1x1 (enforced by wie_replace_layout_labels_tx, 00097) because the
 *  designer's paint_cell removes the WHOLE object covering a cell, so a stored
 *  10-wide run would vanish the first time one cell of it was repainted.
 *  Aliased rather than reimplemented — the packing is cell arithmetic and knows
 *  nothing about what the cells mean. */
export { packAreaRuns as packSignRuns, expandAreaRuns as expandSignRuns }

/** The layout_objects.object_type that backs a sign. */
export const SIGN_OBJECT_TYPE = 'label'

/** Longest sign text we accept. Matches MAX_AREA_NAME so the two inputs behave
 *  identically under the operator's fingers, though nothing composes a sign into
 *  a longer string the way an area name composes into a bin name. */
export const MAX_SIGN_NAME = 60

export type { AreaPaintCell as SignCell, AreaPaintRun as SignRun }

/** One sign, folded from however many cell rows describe it.
 *
 *  No `zoneProfileId`: a sign carries no zone intent, and adding one would
 *  quietly recreate the area semantics this type exists to avoid. */
export interface SignSpec {
  name: string
  cells: AreaPaintCell[]
}

/** Fold `label` rows into one canonical spec per text.
 *
 *  Expands `w`/`h`, which is what makes MAIN's five seeded signs — written by
 *  warehouse-main/layout.mjs as single `w: 10` rows — fold to exactly the cells
 *  a painted run of the same footprint produces. */
export function signSpecsFromObjects(objects: readonly AreaCellSource[]): SignSpec[] {
  return areaSpecsFromObjects(objects, SIGN_OBJECT_TYPE).map((spec) => ({
    name: spec.name,
    cells: spec.cells,
  }))
}

/** The inverse: 1x1 `label` rows from specs, for the server's after-picture and
 *  the canvas preview. */
export function signObjectsFromSpecs(specs: readonly SignSpec[]): AreaCellSource[] {
  return areaObjectsFromSpecs(
    specs.map((spec) => ({ name: spec.name, zoneProfileId: null, cells: spec.cells })),
    SIGN_OBJECT_TYPE,
  ).map((object) => ({
    ...object,
    // areaObjectsFromSpecs stamps `zoneProfileId: null` into meta because an
    // area cell always carries the key. A sign has no such field at all, and
    // storing a null one would invite a future reader to start honouring it.
    meta: { name: (object.meta as { name: string }).name },
  }))
}

/** The optimistic-concurrency stamp over the sign picture. Independent of row
 *  order, of how cells were split across rows, and of duplicate rows. */
export function signCellsFingerprint(objects: readonly AreaCellSource[]): string {
  return areaCellsFingerprint(objects, SIGN_OBJECT_TYPE)
}

/** Geometry diff for the summary panel and the audit row. `reprofiled` is always
 *  empty — signs have no profile — and is left on the shape rather than stripped
 *  so the panel can render sign and area deltas through one component. */
export function diffSigns(
  before: readonly AreaCellSource[],
  after: readonly AreaCellSource[],
): AreaGeometryDelta {
  return diffAreas(before, after, SIGN_OBJECT_TYPE)
}

/** Trim, collapse whitespace runs, cap. What the server stores and what the
 *  toolbar previews must agree byte-for-byte, so both call this. */
export function sanitizeSignName(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim().slice(0, MAX_SIGN_NAME)
}

/**
 * Why a sign text is unusable, or null when it is fine.
 *
 * Deliberately SHORTER than areaNameIssue: `·` is legal here. That ban exists
 * only because an area name is composed into a bin name around ` · `
 * (composeName), and a sign is composed into nothing — refusing it would be
 * cargo-culting a constraint that does not apply.
 */
export function signNameIssue(raw: string): string | null {
  const name = sanitizeSignName(raw)
  if (!name) return 'Give the sign some text.'
  if (raw.trim().length > MAX_SIGN_NAME) return `Keep it to ${MAX_SIGN_NAME} characters.`
  return null
}
