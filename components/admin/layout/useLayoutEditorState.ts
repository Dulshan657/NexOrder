// Renderer-agnostic state model for the WIE layout designer.
//
// A pure reducer over the working set of placements (storage bins) and objects
// (walls/walkways/docks) on a grid. The canvas is just a view of this state;
// keeping the model pure makes it unit-testable and lets the render layer swap
// from SVG to <canvas> later without touching the logic. Phase 1 works in 1×1
// cells on a single floor — enough for the vertical slice; multi-cell footprints
// and zones come in Phase 2.

import { useReducer } from 'react'
import type { LayoutObject, LayoutObjectType, LayoutPlacement, LevelRole, RackLevel } from '@/types'
import { applyTemplate } from '@/components/warehouse/levels/rackLevels'
import {
  areaNameAt,
  areaNameAtIndexed,
  assignAutoNames,
  buildAreaIndex,
  composeName,
  describeSeqRanges,
  highWaterFromRows,
  nextSeqForArea,
  sanitizeAreaName,
  type NamingUnit,
} from '@/lib/locationNaming'
// The brush may carry a trailing space (the input variant allows one so a space
// is typeable at all), so the write point applies the REAL sanitize.
import { sanitizeSignName } from '@/lib/signPaint'

// 'rack' is the generic storage-paint tool; WHICH form it draws is carried by
// `activeForm` (mig 00061 storage forms), so every drawable form shares one tool.
export type EditorTool =
  | 'select' | 'walkway' | 'wall' | 'dock' | 'lift' | 'conveyor' | 'staging' | 'obstacle' | 'label' | 'rack' | 'erase'
  | 'area'

/** The named region the 'area' tool paints (mig 00090).
 *
 *  An area's identity IS its name, per floor — painting with "Cold Storage"
 *  active adds cells to Cold Storage, and contiguous cells sharing a name merge
 *  into one labelled region (see objectRegions' regionGroupKey). This mirrors
 *  `activeForm`: one tool, and the toolbar carries WHICH thing it draws. */
export interface ActiveArea {
  name: string
  /** Records which zone profile the operator intends this area to be. See the
   *  note in mig 00090: this is intent, not yet a binding the engine reads. */
  zoneProfileId?: number
}

/** The storage form the 'rack' tool currently paints (from the forms catalogue). */
export interface ActiveStorageForm {
  storageTypeId?: number
  label: string
  capacitySlots?: number
  slotKind?: 'pallet' | 'carton'
  weightCapacityKg?: number
  /** Standard level layout (mig 00072); a placement painted with this form
   *  inherits these levels (recoded to the new placement's own code). */
  levelTemplate?: RackLevel[]
}

export interface EditorPlacement {
  clientRef: string
  locationId?: number
  floor: number
  x: number
  y: number
  w: number
  h: number
  rotation: 0 | 90 | 180 | 270
  // Bin metadata (edited in the inspector; sent as new_bin on first save).
  kind: 'ZONE' | 'AISLE' | 'RACK' | 'BAY' | 'SHELF' | 'BIN'
  code: string
  name: string
  capacitySlots?: number
  slotKind?: 'pallet' | 'carton'
  /** Per-unit weight limit, kg (mig 00061; inherited from the storage form). */
  weightCapacityKg?: number
  /** Zone profile this bin belongs to (WIE Phase 2); undefined = no zone. */
  zoneProfileId?: number
  /** Physical storage-unit type (mig 00056); supplies default capacity/slot. */
  storageTypeId?: number
  /** Per-instance level configuration (mig 00072); undefined = not a levelled
   *  rack (or a levelled form whose levels haven't been customised/created yet). */
  levels?: RackLevel[]
  // ── Name provenance (mig 00094) ───────────────────────────────────────────
  /** The rack number inside `nameArea`. Assigned once and never reassigned, so
   *  deleting a rack leaves a permanent gap. null = never numbered. */
  nameSeq?: number | null
  /** The pool that number came from — NOT derived from geometry, so painting a
   *  different area over a rack does not release its claim. */
  nameArea?: string | null
  /** false = a human typed this name; an area rename must leave it alone. */
  nameIsAuto?: boolean
}

export interface EditorObject {
  clientRef: string
  objectType: LayoutObjectType
  floor: number
  x: number
  y: number
  w: number
  h: number
  /** Free-form metadata (currently just a display `name` for obstacle/staging/label). */
  meta?: Record<string, unknown>
  /** STAGING location this object is linked to (staging objects only). */
  stagingLocationId?: number
}

export interface EditorState {
  tool: EditorTool
  floor: number
  placements: EditorPlacement[]
  objects: EditorObject[]
  /** Last-selected clientRef (placement or object) — unchanged contract, read by
   *  LayoutDesignerView.tsx / LayoutCanvas.tsx exactly as before. */
  selectedRef: string | null
  /** Superset of `selectedRef`: every currently-selected placement/object
   *  clientRef. In the single-select case (the only case those two files drive
   *  today) it's always `{selectedRef}` (or empty when null). Multi-select
   *  (ctrl/shift-click on the canvas) adds more refs via `select` with
   *  `additive: true`. */
  selectedRefs: Set<string>
  dirty: boolean
  seq: number
  /** Prefix for auto-generated bin codes so they stay globally unique
   *  (locations.code is UNIQUE across all warehouses). */
  codePrefix: string
  /** The storage form the 'rack' tool paints; null = generic bin (10 pallet). */
  activeForm: ActiveStorageForm | null
  /** The named region the 'area' tool paints; null = nothing named yet, and the
   *  reducer refuses the stroke rather than writing a cell belonging to nothing. */
  activeArea: ActiveArea | null
  /** The text the 'label' tool paints (mig 00097); null = nothing typed yet.
   *  A plain string, not an object like ActiveArea: a sign carries no zone
   *  profile and must never grow one. */
  activeSign: string | null
  /** Which annotation layer the operator is working on. Set by set_area /
   *  set_sign, read by the scoped ERASER — areas and signs overlap freely, so
   *  the eraser cannot pick between them by stacking order without sometimes
   *  deleting the layer the operator was not looking at. */
  annotationBrush: 'area' | 'sign'
  /** Set when a paint stroke was REFUSED because something incompatible already
   *  owns the cell (see ALLOWED_COOCCUPANTS). Purely a UI hint channel — the
   *  reducer is pure and cannot toast, and silently returning state unchanged
   *  (the old behaviour) reads to the operator as "the tool is broken".
   *
   *  Consumers key off `seq`, never off presence: a second refusal at the SAME
   *  cell still bumps `seq`, so a canvas flash re-triggers. `count` is set only
   *  by generate_bins (how many cells the wizard skipped). Cleared by every
   *  successful paint; deliberately untouched by every other action. */
  blockedAt: BlockedPaint | null
  /**
   * Area renames made since the last save, oldest first (mig 00094).
   *
   * `save_geometry` is a FULL REPLACE, so "renamed Chiller to Cold Room" and
   * "erased Chiller, painted Cold Room" produce byte-identical payloads. The
   * server cannot tell them apart and so cannot infer that the bins inside
   * should follow — it has to be told. This is the telling.
   *
   * Coalesced (A→B then B→C becomes A→C) and cleared by `mark_saved`.
   */
  pendingRenames: Array<{ from: string; to: string }>
  /**
   * Pool → the highest rack number already handed out ANYWHERE in this
   * warehouse, including on racks no longer in this layout (mig 00094).
   *
   * Seeded by `load` from the warehouse's locations. Deleting a saved rack drops
   * its placement row but not its `locations` row — publishing never retires a
   * bin and its QR label is still on the racking — so without this floor the
   * next rack drawn would take a number that is live on the floor.
   */
  seqFloor: Record<string, number>
  /**
   * What the last batch fill actually named, e.g. `{ count: 40, ranges:
   * 'Chiller 1–24, Bulk 1–16' }`.
   *
   * Same hint channel as `blockedAt`, and it exists for the same reason: the
   * wizard closes its modal on submit, so a fill spanning two areas would mint
   * two number ranges the operator never sees. Consumers key off `seq`.
   */
  lastFill: { count: number; ranges: string; seq: number } | null
  /**
   * Which tools the reducer honours (mig 00095).
   *
   * `'all'` is the draft case and is unchanged. `'areas'` is a PUBLISHED layout,
   * where only select / area / label / erase-one-of-those are live and Save
   * routes to `paint_areas` + `paint_labels` instead of `save_geometry`.
   *
   * The guard lives HERE and not in the toolbar because a keyboard shortcut, a
   * stale render or a canvas drag must be refused by the same thing that refuses
   * a bad co-occupancy. A published layout's placements are frozen geometry: the
   * routing graph, every edge weight and every access offset were computed from
   * them, and `area` and `label` are the two object types that carry none of it.
   *
   * The name is historical — the scope covers signs too as of mig 00097. Renaming
   * it would touch every call site for no behavioural gain.
   */
  editScope: 'all' | 'areas'
}

/**
 * The only tools that make sense on a published layout.
 *
 * `label` joins as of mig 00097 on exactly the same argument that admitted
 * `area`: buildWalkableCells whitelists walkway/dock/lift/staging and subtracts
 * wall/conveyor, so neither type contributes a graph node, an edge weight or an
 * access offset, and neither can invalidate anything publishing froze.
 */
const AREA_SCOPE_TOOLS: readonly EditorTool[] = ['select', 'area', 'label', 'erase']

/** Object types whose identity is the operator's text, and which are therefore
 *  editable on a published layout. Both are erased by the scoped eraser and both
 *  refuse a nameless stroke. */
const ANNOTATION_TYPES: readonly LayoutObjectType[] = ['area', 'label']

function isAnnotation(type: LayoutObjectType | undefined): boolean {
  return type !== undefined && ANNOTATION_TYPES.includes(type)
}

export interface BlockedPaint {
  x: number
  y: number
  floor: number
  /** What already owns the cell. `null` when `reason` is not an occupancy clash. */
  blockedBy: OccupantKind | null
  /** Why the stroke was refused. `'occupied'` is the original case (see
   *  ALLOWED_COOCCUPANTS). `'unnamed'` is a brush with no text yet: an area or a
   *  sign IS its name, so painting one nameless writes a cell belonging to
   *  nothing — invisible on both canvases and rejected by the server. That used
   *  to happen silently, which is precisely how an operator ends up reporting
   *  "I painted and nothing showed". */
  reason?: 'occupied' | 'unnamed'
  tool: EditorTool
  /** Cells skipped by a batch fill; absent for a single refused stroke. */
  count?: number
  seq: number
}

export type EditorAction =
  | { type: 'set_tool'; tool: EditorTool }
  | { type: 'set_storage_form'; form: ActiveStorageForm }
  | { type: 'set_area'; area: ActiveArea | null }
  // The sign brush (mig 00097). Sanitised by the caller, exactly as the area
  // name is — the toolbar and the server must store byte-identical text or the
  // fingerprint disagrees.
  | { type: 'set_sign'; name: string | null }
  // Renames an area WHOLESALE: every cell on this floor carrying `from` becomes
  // `to`. An area is identified by its name, so renaming one cell at a time
  // would split the region in half mid-edit.
  | { type: 'rename_area'; from: string; to: string; zoneProfileId?: number }
  // The sign equivalent (mig 00097), and it exists for the identical reason: a
  // sign is painted as many 1x1 cells sharing one name, so retyping the one cell
  // the operator happened to select would split the region and leave half of it
  // reading the old text. No pendingRenames counterpart — nothing cascades off a
  // sign's text, and paint_labels derives the change from the before-picture.
  | { type: 'rename_sign'; from: string; to: string }
  | { type: 'set_floor'; floor: number }
  | { type: 'paint_cell'; x: number; y: number }
  // `additive: true` toggles `ref` into the multi-selection instead of
  // replacing it (ctrl/shift-click on the canvas); omitted/false keeps the
  // original single-select replace behaviour untouched.
  | { type: 'select'; ref: string | null; additive?: boolean }
  | { type: 'update_placement'; ref: string; patch: Partial<Omit<EditorPlacement, 'clientRef'>> }
  | { type: 'update_object'; ref: string; patch: { meta?: Record<string, unknown> } }
  | { type: 'delete_selected' }
  // `capacitySlots: null` is the operator saying UNCOUNTED — a floor stack with
  // no slot ceiling, which is what a form like Bulk Floor means by a NULL
  // `default_capacity_slots`. Distinct from omitting the field, which means "the
  // caller had no opinion" and still takes the generic 10.
  | { type: 'generate_bins'; startX: number; startY: number; cols: number; rows: number; capacitySlots?: number | null; slotKind?: 'pallet' | 'carton'; weightCapacityKg?: number; zoneProfileId?: number; storageTypeId?: number; levelTemplate?: RackLevel[] }
  | { type: 'load'; placements: LayoutPlacement[]; objects: LayoutObject[]; codeByLocation: Record<number, { code: string; name: string; kind: EditorPlacement['kind']; capacitySlots?: number; slotKind?: 'pallet' | 'carton'; weightCapacityKg?: number; storageTypeId?: number; parentId?: number; levelRole?: LevelRole; levelIndex?: number; nameSeq?: number | null; nameArea?: string | null; nameIsAuto?: boolean }> }
  // `level_location_ids` is present only for a levelled rack: level_index -> the
  // SHELF location id the server created/kept for it (mig 00072).
  // `name`/`name_seq`/`name_area` are the SERVER's answer, which is authoritative:
  // it recomputes from the database rather than trusting the wire, so a stale tab
  // is corrected here rather than silently persisting a wrong number.
  | { type: 'mark_saved'; refMap: Array<{ client_ref: string; location_id: number; level_location_ids?: Record<number, number>; name?: string; name_seq?: number | null; name_area?: string | null }> }
  | { type: 'apply_auto_connect'; objects: Array<Pick<EditorObject, 'objectType' | 'floor' | 'x' | 'y' | 'w' | 'h'> & Partial<Pick<EditorObject, 'meta' | 'stagingLocationId'>>> }
  // Wholesale object replace from resolveLayoutOverlaps (the "Clean up overlaps"
  // repair). Placements are never touched by it.
  | { type: 'apply_overlap_repair'; objects: Array<Pick<EditorObject, 'objectType' | 'floor' | 'x' | 'y' | 'w' | 'h'> & Partial<Pick<EditorObject, 'meta' | 'stagingLocationId'>>> }
  // Rack levels (mig 00072).
  | { type: 'set_rack_levels'; ref: string; levels: RackLevel[] }
  | { type: 'apply_levels_to_selection'; levels: RackLevel[] }
  // Live area painting (mig 00095).
  | { type: 'set_edit_scope'; scope: EditorState['editScope'] }
  // Adopt the PUBLISHED layout's areas into this draft, discarding whatever this
  // draft was carrying. The one-click fix for a draft cloned before somebody
  // relabelled the live site.
  | { type: 'replace_areas'; objects: Array<Pick<EditorObject, 'floor' | 'x' | 'y'> & Partial<Pick<EditorObject, 'meta'>>> }

export function initialEditorState(codePrefix = 'W'): EditorState {
  return { tool: 'select', floor: 0, placements: [], objects: [], selectedRef: null, selectedRefs: new Set(), dirty: false, seq: 1, codePrefix, activeForm: null, activeArea: null, activeSign: null, annotationBrush: 'area', blockedAt: null, pendingRenames: [], lastFill: null, seqFloor: {}, editScope: 'all' }
}

/** `EditorState.seqFloor` as the naming module wants it. */
export function seqFloorMap(state: Pick<EditorState, 'seqFloor'>): Map<string, number> {
  return new Map(Object.entries(state.seqFloor))
}

/**
 * Editor placements as the naming module sees them.
 *
 * The single adapter between editor state and _shared/wie/locationNaming — so the
 * designer's preview of a name is produced by the very function the server runs,
 * not by a second copy of the rule.
 */
export function editorUnits(placements: readonly EditorPlacement[]): NamingUnit[] {
  return placements.map((p) => ({
    ref: p.clientRef,
    floor: p.floor,
    x: p.x,
    y: p.y,
    w: p.w,
    h: p.h,
    name: p.name,
    nameIsAuto: p.nameIsAuto !== false,
    nameSeq: p.nameSeq ?? null,
    nameArea: p.nameArea ?? null,
    levelIndexes: p.levels?.map((l) => l.levelIndex),
  }))
}

/**
 * Fold a new rename into the pending list.
 *
 * A→B followed by B→C is one rename A→C, not two: the server applies them in
 * order over the POST-rename geometry, and by the time it runs there is no "B"
 * left on the floor for the second entry to match. Renaming back to where you
 * started removes the entry entirely.
 */
export function coalesceRename(
  pending: ReadonlyArray<{ from: string; to: string }>,
  from: string,
  to: string,
): Array<{ from: string; to: string }> {
  const existing = pending.findIndex((r) => r.to === from)
  if (existing === -1) return [...pending, { from, to }]
  const merged = { from: pending[existing].from, to }
  const next = pending.filter((_, i) => i !== existing)
  return merged.from === merged.to ? next : [...next, merged]
}

/** Single-selection helper: `selectedRefs` always mirrors `selectedRef` as its
 *  one-element (or empty) set. Every plain-click selection path uses this so
 *  the two fields never drift apart outside the explicit multi-select branch. */
function singleSelect(ref: string | null): Pick<EditorState, 'selectedRef' | 'selectedRefs'> {
  return { selectedRef: ref, selectedRefs: ref ? new Set([ref]) : new Set() }
}

const OBJECT_TOOLS: Partial<Record<EditorTool, LayoutObjectType>> = {
  walkway: 'walkway',
  wall: 'wall',
  dock: 'dock',
  lift: 'lift',
  conveyor: 'conveyor',
  staging: 'staging',
  obstacle: 'obstacle',
  label: 'label',
  area: 'area',
}

/** True when (x,y) falls inside a rect's footprint. `Math.max(1, …)` defends
 *  against a 0/NaN w or h off a bad server row — zoneRegions.ts guards the same
 *  way. */
export function covers(r: { x: number; y: number; w: number; h: number }, x: number, y: number): boolean {
  return x >= r.x && x < r.x + Math.max(1, r.w) && y >= r.y && y < r.y + Math.max(1, r.h)
}

/**
 * AABB containment, NOT top-left equality.
 *
 * Multi-cell objects have existed in production data for a long time — the
 * floor-plan importer emits them, `resolveObjectOverlaps` emits them, and the
 * WIE demo seeds a `w:1,h:14` wall — but every hit test here used to match only
 * an object's own top-left cell. So a 14-cell imported wall could not be
 * selected or erased from anywhere except its top cell, and painting over its
 * middle silently stacked a second object underneath it.
 */
export function objectAt(state: EditorState, x: number, y: number): EditorObject | undefined {
  return state.objects.find((o) => o.floor === state.floor && covers(o, x, y))
}

export function placementAt(state: EditorState, x: number, y: number): EditorPlacement | undefined {
  return state.placements.find((p) => p.floor === state.floor && covers(p, x, y))
}

/** Everything that can own a grid cell. `'storage'` is any EditorPlacement
 *  (bin/rack); the rest are LayoutObjectType verbatim. */
export type OccupantKind = LayoutObjectType | 'storage'

export interface CellOccupant {
  kind: OccupantKind
  clientRef: string
}

/**
 * WHICH KINDS MAY SHARE ONE CELL. Read as: an incoming occupant of kind K may
 * join a cell only if EVERY existing occupant's kind is in
 * ALLOWED_COOCCUPANTS[K]. Anything unlisted blocks — including across categories,
 * so a rack cannot share a cell with a wall and a wall cannot share one with a
 * rack.
 *
 * Only three exemptions, all principled:
 *  - `label` is annotation, not structure. It co-exists with everything: it is
 *    already exempt from the AI importer's resolveObjectOverlaps and is
 *    non-blocking in publishReadiness' buildWalkableCells.
 *  - `area` (mig 00090) is a named region WASH, not structure. Saying "this
 *    corner is Cold Storage" is a statement ABOUT the racks and walkways there,
 *    so it must lie over them rather than compete for the cell — an area that
 *    could not overlap the bins it names would be unable to name anything. Like
 *    `label` it is non-blocking in buildWalkableCells (see publishReadiness).
 *  - `staging` ↔ `dock`: a dock IS the doorway onto the shipping/receiving
 *    floor, and buildWalkableCells already treats both as plain walkable ground.
 *
 * Cross-category overlap is what silently broke publishing: buildWalkableCells
 * subtracts every placement footprint, so a dock or walkway drawn under a bin
 * stops counting and the layout reports `no_walkways`/`unreachable_bins` for a
 * cause nothing in the UI ever named.
 *
 * MUST BE SYMMETRIC — isBlocked only looks the matrix up in one direction. A
 * unit test asserts symmetry rather than trusting a hand-read.
 */
export const ALLOWED_COOCCUPANTS: Record<OccupantKind, readonly OccupantKind[]> = {
  label: ['label', 'wall', 'dock', 'walkway', 'obstacle', 'lift', 'conveyor', 'staging', 'storage', 'area'],
  area: ['area', 'label', 'wall', 'dock', 'walkway', 'obstacle', 'lift', 'conveyor', 'staging', 'storage'],
  wall: ['label', 'area'],
  dock: ['label', 'staging', 'area'],
  walkway: ['label', 'area'],
  obstacle: ['label', 'area'],
  lift: ['label', 'area'],
  conveyor: ['label', 'area'],
  staging: ['label', 'dock', 'area'],
  storage: ['label', 'area'],
}

/** The one place the matrix is consulted. */
function isBlocked(existing: OccupantKind, incoming: OccupantKind): boolean {
  return !ALLOWED_COOCCUPANTS[incoming].includes(existing)
}

const cellKey = (x: number, y: number) => `${x}:${y}`

/** Every occupant of (x,y) on the current floor — objects AND placements. */
export function occupantsAt(state: EditorState, x: number, y: number): CellOccupant[] {
  const out: CellOccupant[] = []
  for (const o of state.objects) {
    if (o.floor === state.floor && covers(o, x, y)) out.push({ kind: o.objectType, clientRef: o.clientRef })
  }
  for (const p of state.placements) {
    if (p.floor === state.floor && covers(p, x, y)) out.push({ kind: 'storage', clientRef: p.clientRef })
  }
  return out
}

/** The first occupant forbidding `kind` at (x,y), or null. */
export function blockerAt(state: EditorState, x: number, y: number, kind: OccupantKind): CellOccupant | null {
  return occupantsAt(state, x, y).find((occ) => isBlocked(occ.kind, kind)) ?? null
}

/** Batch form for whole-rectangle work (generate_bins, the repair pass):
 *  rasterizes one floor ONCE instead of rescanning every object per cell. A
 *  120×80 Rack Wizard fill is 9,600 cells, so the linear form would be
 *  9,600 × |objects|. */
export function buildOccupancyIndex(state: EditorState, floor = state.floor): Map<string, CellOccupant[]> {
  const index = new Map<string, CellOccupant[]>()
  const add = (x: number, y: number, occ: CellOccupant) => {
    const key = cellKey(x, y)
    const bucket = index.get(key)
    if (bucket) bucket.push(occ)
    else index.set(key, [occ])
  }
  for (const o of state.objects) {
    if (o.floor !== floor) continue
    for (let dy = 0; dy < Math.max(1, o.h); dy++) {
      for (let dx = 0; dx < Math.max(1, o.w); dx++) add(o.x + dx, o.y + dy, { kind: o.objectType, clientRef: o.clientRef })
    }
  }
  for (const p of state.placements) {
    if (p.floor !== floor) continue
    for (let dy = 0; dy < Math.max(1, p.h); dy++) {
      for (let dx = 0; dx < Math.max(1, p.w); dx++) add(p.x + dx, p.y + dy, { kind: 'storage', clientRef: p.clientRef })
    }
  }
  return index
}

export function blockedByIndex(
  index: Map<string, CellOccupant[]>,
  x: number,
  y: number,
  kind: OccupantKind,
): CellOccupant | null {
  return (index.get(cellKey(x, y)) ?? []).find((occ) => isBlocked(occ.kind, kind)) ?? null
}

/** Refuse a stroke: record the hint, change nothing else. Notably does NOT set
 *  `dirty` — a refused stroke edited nothing. */
function refuse(state: EditorState, x: number, y: number, blockedBy: OccupantKind, count?: number): EditorState {
  return {
    ...state,
    blockedAt: { x, y, floor: state.floor, blockedBy, reason: 'occupied', tool: state.tool, count, seq: (state.blockedAt?.seq ?? 0) + 1 },
  }
}

/** Refuse a stroke because the brush has no text yet.
 *
 *  Through the SAME channel as an occupancy refusal, deliberately. An area or a
 *  sign IS its name: a cell with no `meta.name` merges into no region, draws no
 *  text, and is rejected outright by the server — so painting one is never what
 *  the operator meant. It used to be allowed and produced, for an area, a
 *  12%-opacity wash under the grid that is invisible on stone. "I painted and
 *  nothing showed" was exactly this. */
function refuseUnnamed(state: EditorState, x: number, y: number): EditorState {
  return {
    ...state,
    blockedAt: { x, y, floor: state.floor, blockedBy: null, reason: 'unnamed', tool: state.tool, seq: (state.blockedAt?.seq ?? 0) + 1 },
  }
}

/** Explode a rect into the 1×1 fragments it covers, minus one cell. Used by
 *  erase so clicking the middle of a multi-cell object removes just that cell
 *  rather than the whole shape — cheap, because this editor's own paint tools
 *  only ever mint 1×1 objects anyway, and the canvas re-merges contiguous cells
 *  visually so the remainder still reads as one wall. */
function fragmentsExcluding(o: EditorObject, x: number, y: number, startSeq: number): { objects: EditorObject[]; seq: number } {
  const objects: EditorObject[] = []
  let seq = startSeq
  for (let dy = 0; dy < Math.max(1, o.h); dy++) {
    for (let dx = 0; dx < Math.max(1, o.w); dx++) {
      const cx = o.x + dx
      const cy = o.y + dy
      if (cx === x && cy === y) continue
      objects.push({ ...o, clientRef: `o${seq++}`, x: cx, y: cy, w: 1, h: 1 })
    }
  }
  return { objects, seq }
}

function withoutRef(refs: Set<string>, ref: string): Set<string> {
  if (!refs.has(ref)) return refs
  const next = new Set(refs)
  next.delete(ref)
  return next
}

/**
 * May this action run while the editor is scoped to areas only?
 *
 * Anything that touches a PLACEMENT is out: on a published layout those rows
 * carry the frozen routing graph. Anything that touches a non-area OBJECT is out
 * too — a wall is subtracted from the walk graph, so moving one silently
 * invalidates travel distances that publishing froze. An `area` carries none of
 * that, which is the whole reason this scope can exist at all.
 */
function allowedInAreaScope(state: EditorState, action: EditorAction): boolean {
  switch (action.type) {
    case 'set_tool':
      return AREA_SCOPE_TOOLS.includes(action.tool)
    case 'update_object':
      return isAnnotation(state.objects.find((o) => o.clientRef === action.ref)?.objectType)
    case 'delete_selected':
      return isAnnotation(state.objects.find((o) => o.clientRef === state.selectedRef)?.objectType)
    case 'set_storage_form':
    case 'update_placement':
    case 'set_rack_levels':
    case 'apply_levels_to_selection':
    case 'generate_bins':
    case 'apply_auto_connect':
    case 'apply_overlap_repair':
      return false
    default:
      return true
  }
}

export function layoutEditorReducer(state: EditorState, action: EditorAction): EditorState {
  if (state.editScope === 'areas' && !allowedInAreaScope(state, action)) return state
  return editorReducerCore(state, action)
}

function editorReducerCore(state: EditorState, action: EditorAction): EditorState {
  switch (action.type) {
    case 'set_tool':
      return { ...state, tool: action.tool }

    case 'set_edit_scope':
      return {
        ...state,
        editScope: action.scope,
        // A tool the new scope does not honour would leave the operator holding
        // a brush that silently does nothing.
        tool: action.scope === 'areas' && !AREA_SCOPE_TOOLS.includes(state.tool) ? 'select' : state.tool,
      }

    case 'replace_areas': {
      const objects = state.objects.filter((o) => o.objectType !== 'area')
      let seq = state.seq
      for (const cell of action.objects) {
        objects.push({
          clientRef: `o${seq++}`, objectType: 'area', floor: cell.floor, x: cell.x, y: cell.y,
          w: 1, h: 1, meta: cell.meta,
        })
      }
      // A pending rename was recorded against the area set being discarded, so
      // replaying it over the adopted one would rename something else.
      return { ...state, objects, seq, pendingRenames: [], ...singleSelect(null), dirty: true }
    }

    case 'set_storage_form':
      // Selecting a form activates the storage-paint tool bound to that form.
      return { ...state, tool: 'rack', activeForm: action.form, ...singleSelect(null) }

    case 'set_area':
      // Mirrors set_storage_form: naming the area is how you pick up the tool.
      return { ...state, tool: 'area', activeArea: action.area, annotationBrush: 'area', ...singleSelect(null) }

    case 'set_sign':
      // Same shape as set_area: typing the text is how you pick up the tool.
      return { ...state, tool: 'label', activeSign: action.name, annotationBrush: 'sign', ...singleSelect(null) }

    case 'rename_area': {
      const to = action.to.trim()
      if (!to || to === action.from) return state
      // EVERY floor, not just this one (mig 00094). Rack numbers are pooled per
      // area NAME across floors — two floors both painted "Chiller" share one
      // 1..N run — so renaming one floor's cells while the other floor's racks
      // renumber into the new pool would leave the two disagreeing. 00090's "an
      // area's identity is its name, PER FLOOR" is about region merging, which is
      // a flood fill and genuinely cannot cross floors; label identity is not.
      const objects = state.objects.map((o) =>
        o.objectType === 'area' && (o.meta?.name ?? '') === action.from
          ? { ...o, meta: { ...o.meta, name: to, zoneProfileId: action.zoneProfileId } }
          : o,
      )
      // Keep the brush in sync, so the next stroke extends the RENAMED area
      // rather than re-creating the old one beside it.
      const activeArea = state.activeArea?.name === action.from
        ? { name: to, zoneProfileId: action.zoneProfileId }
        : state.activeArea
      return {
        ...state,
        objects,
        activeArea,
        pendingRenames: coalesceRename(state.pendingRenames, action.from, to),
        dirty: true,
      }
    }

    case 'rename_sign': {
      const to = action.to.trim()
      if (!to || to === action.from) return state
      // EVERY floor, like rename_area: a sign's identity is its text, and two
      // floors carrying the same sign are one sign for merging purposes on each.
      const objects = state.objects.map((o) =>
        o.objectType === 'label' && (o.meta?.name ?? '') === action.from
          ? { ...o, meta: { ...o.meta, name: to } }
          : o,
      )
      // Keep the brush in sync so the next stroke extends the RENAMED sign
      // rather than re-creating the old one beside it.
      const activeSign = state.activeSign === action.from ? to : state.activeSign
      return { ...state, objects, activeSign, dirty: true }
    }

    case 'set_floor':
      return { ...state, floor: action.floor, ...singleSelect(null) }

    case 'select': {
      if (!action.additive || action.ref === null) {
        return { ...state, ...singleSelect(action.ref) }
      }
      const next = new Set(state.selectedRefs)
      if (next.has(action.ref)) next.delete(action.ref)
      else next.add(action.ref)
      const remaining = Array.from(next)
      const selectedRef = next.has(action.ref) ? action.ref : (remaining[remaining.length - 1] ?? null)
      return { ...state, selectedRef, selectedRefs: next }
    }

    case 'paint_cell': {
      const { x, y } = action

      if (state.tool === 'erase') {
        // In area scope the eraser erases ANNOTATIONS and nothing else. Note it
        // must look for one SPECIFICALLY rather than take objectAt's topmost
        // hit: both areas and signs co-occupy with everything (an area names the
        // ground the racks stand on; a sign is read over whatever it sits on),
        // so over a wall the topmost object is the wall.
        //
        // Which of the two it takes is decided by the brush the operator last
        // picked up (`annotationBrush`), NOT by stacking order. Signs co-occupy
        // with areas and routinely sit on top of one, so a stacking rule would
        // make "erase this area cell" silently eat the sign over it — and there
        // is no ordering of the two that is right in both directions. The
        // operator already told us which layer they are working on.
        const areasOnly = state.editScope === 'areas'
        const eraseOrder: readonly LayoutObjectType[] =
          state.annotationBrush === 'sign' ? ['label', 'area'] : ['area', 'label']
        const obj = areasOnly
          ? eraseOrder
              .map((t) => state.objects.find((o) => o.floor === state.floor && o.objectType === t && covers(o, x, y)))
              .find((o) => o !== undefined)
          : objectAt(state, x, y)
        const place = areasOnly ? undefined : placementAt(state, x, y)
        if (!obj && !place) {
          if (!areasOnly) return state
          // Say why, through the same channel a blocked paint uses — silently
          // doing nothing reads to the operator as "the tool is broken".
          const other: OccupantKind | undefined = placementAt(state, x, y)
            ? 'storage'
            : objectAt(state, x, y)?.objectType
          return other ? refuse(state, x, y, other) : state
        }
        // An object erases PER CELL: a multi-cell rect is rebuilt as 1×1
        // fragments minus this cell, so clicking the middle of an imported wall
        // opens a doorway instead of deleting the whole run. A PLACEMENT erases
        // whole — it is one addressable location with one code, and fragmenting
        // it would mint N bins claiming the same code.
        let objects = state.objects
        let seq = state.seq
        if (obj) {
          const isMultiCell = Math.max(1, obj.w) * Math.max(1, obj.h) > 1
          if (isMultiCell) {
            const split = fragmentsExcluding(obj, x, y, seq)
            seq = split.seq
            objects = [...state.objects.filter((o) => o !== obj), ...split.objects]
          } else {
            objects = state.objects.filter((o) => o !== obj)
          }
        }
        const erasedRefs = [place?.clientRef, obj && Math.max(1, obj.w) * Math.max(1, obj.h) === 1 ? obj.clientRef : undefined]
        const erasedSelected = erasedRefs.some((r) => r && r === state.selectedRef)
        let selectedRefs = state.selectedRefs
        for (const r of erasedRefs) if (r) selectedRefs = withoutRef(selectedRefs, r)
        return {
          ...state,
          objects,
          placements: state.placements.filter((p) => p !== place),
          selectedRef: erasedSelected ? null : state.selectedRef,
          selectedRefs,
          seq,
          dirty: true,
          blockedAt: null,
        }
      }

      const objectType = OBJECT_TOOLS[state.tool]
      if (objectType) {
        // An ANNOTATION IS ITS NAME. A nameless cell merges into no region, draws
        // no text on either canvas, and is refused by the server — so it can only
        // ever be a mistake, and allowing it is what produced the invisible-paint
        // bug this refusal fixes. Checked BEFORE the co-occupancy matrix: the
        // brush is unusable regardless of what is under the pointer.
        // Sanitized HERE, not read raw off the brush: the toolbar's input
        // deliberately tolerates a trailing space so one can be typed at all,
        // and a stored `"Chiller "` would fold to a different name than the
        // server's `"Chiller"` and break the fingerprint.
        const annotationName =
          objectType === 'area' ? sanitizeAreaName(state.activeArea?.name ?? '')
            : objectType === 'label' ? sanitizeSignName(state.activeSign ?? '')
              : null
        if (annotationName !== null && annotationName.trim() === '') {
          return refuseUnnamed(state, x, y)
        }

        // Repainting a cell with the SAME annotation name is an idempotent
        // no-op: dragging back across your own stroke must not churn object
        // identity or re-mark the layout dirty on every cell. A DIFFERENT name
        // falls through to the replace below, because that is a genuine
        // reassignment — "Cold Storage" painted over a cell of "Bulk".
        //
        // This is checked here rather than off `blockerAt` (where it used to
        // sit) because the co-occupancy matrix lets an annotation share a cell
        // with its own kind, so blockerAt returns null and the branch could
        // never fire.
        if (annotationName !== null) {
          const existing = state.objects.find(
            (o) => o.floor === state.floor && o.objectType === objectType && covers(o, x, y),
          )
          if (existing && (existing.meta?.name ?? '') === annotationName) return state
        }

        const blocker = blockerAt(state, x, y, objectType)
        // Same-kind is an idempotent RE-PAINT, not a refusal: a drag that
        // crosses its own stroke must not flash red or toast.
        if (blocker && blocker.kind === objectType) return state
        if (blocker) return refuse(state, x, y, blocker.kind)
        // Don't stack same-type; replace whatever object of this type covers the cell.
        const without = state.objects.filter((o) => !(o.floor === state.floor && o.objectType === objectType && covers(o, x, y)))
        const obj: EditorObject = {
          clientRef: `o${state.seq}`, objectType, floor: state.floor, x, y, w: 1, h: 1,
          // An annotation cell carries its identity, because that is what merges
          // it into a region. A sign carries ONLY its name — no zoneProfileId,
          // ever, or it quietly becomes an area.
          ...(objectType === 'area' && state.activeArea
            ? { meta: { name: annotationName as string, zoneProfileId: state.activeArea.zoneProfileId } }
            : {}),
          ...(objectType === 'label' && state.activeSign
            ? { meta: { name: annotationName as string } }
            : {}),
        }
        return { ...state, objects: [...without, obj], seq: state.seq + 1, dirty: true, blockedAt: null }
      }

      if (state.tool === 'rack') {
        const blocker = blockerAt(state, x, y, 'storage')
        if (blocker && blocker.kind === 'storage') return state // already a bin here
        if (blocker) return refuse(state, x, y, blocker.kind)
        const ref = `p${state.seq}`
        const f = state.activeForm
        const code = `${state.codePrefix}-B-${x}-${y}`
        // The code stays a grid coordinate — it is the QR payload and the scan
        // identity. The NAME is what the operator reads, so it comes from the
        // area they painted plus the next free number in that area's pool.
        // `areaNameAt` (linear) rather than buildAreaIndex: rasterizing a
        // 2000-cell area on every pointer move would be absurd, and a test pins
        // that the two agree cell-for-cell.
        const nameArea = areaNameAt(state.objects, state.floor, x, y)
        const nameSeq = nextSeqForArea(editorUnits(state.placements), nameArea, seqFloorMap(state))
        const placement: EditorPlacement = {
          clientRef: ref, floor: state.floor, x, y, w: 1, h: 1, rotation: 0,
          kind: 'BIN', code, name: composeName(nameArea, nameSeq),
          nameSeq, nameArea, nameIsAuto: true,
          // A SELECTED form's values win outright — including the ones it
          // deliberately leaves unset. `default_capacity_slots` NULL means
          // "uncounted, no slot ceiling" (BULK_FLOOR, AMD_BULK), and `?? 10`
          // silently overrode exactly that, so every cell painted with a Bulk
          // Floor brush was stored as a 10-pallet bin. The server only consults
          // the form when the field arrives null (mutate-layout), so the form's
          // own default never got a chance to apply. PlacementInspector has
          // always passed these straight through; it is the precedent.
          //
          // The 10 / 'pallet' pair is the NO-FORM-SELECTED fallback, and only
          // that — see EditorState.activeForm ("null = generic bin").
          capacitySlots: f ? f.capacitySlots : 10,
          slotKind: f ? f.slotKind : 'pallet',
          weightCapacityKg: f?.weightCapacityKg, storageTypeId: f?.storageTypeId,
          // A form with a standard level layout hands every rack it paints that
          // layout (recoded to this new rack's own code); a form without one
          // leaves `levels` undefined — not every rack is levelled.
          levels: f?.levelTemplate ? applyTemplate(f.levelTemplate, code) : undefined,
        }
        return { ...state, placements: [...state.placements, placement], ...singleSelect(ref), seq: state.seq + 1, dirty: true, blockedAt: null }
      }

      // select tool: clicking a bin selects it; otherwise fall back to whatever
      // structural object (wall/dock/obstacle/staging/label/…) occupies the cell,
      // so those become selectable too.
      const hit = placementAt(state, x, y)
      if (hit) return { ...state, ...singleSelect(hit.clientRef) }
      const objHit = objectAt(state, x, y)
      return { ...state, ...singleSelect(objHit?.clientRef ?? null) }
    }

    case 'update_placement': {
      // Typing a name IS the definition of a custom name, so the provenance is
      // forced here rather than left to the call site — the same rule
      // mutate-warehouse-location applies server-side. Releasing the number is
      // deliberate: the row no longer holds a claim on its area's pool, so the
      // next rack drawn there takes the next number rather than colliding.
      const patch = action.patch.name !== undefined
        ? { ...action.patch, nameIsAuto: false, nameSeq: null, nameArea: null }
        : action.patch
      return {
        ...state,
        placements: state.placements.map((p) => (p.clientRef === action.ref ? { ...p, ...patch } : p)),
        dirty: true,
      }
    }

    case 'update_object':
      return {
        ...state,
        objects: state.objects.map((o) => (o.clientRef === action.ref ? { ...o, ...action.patch } : o)),
        dirty: true,
      }

    case 'delete_selected': {
      if (!state.selectedRef) return state
      return {
        ...state,
        placements: state.placements.filter((p) => p.clientRef !== state.selectedRef),
        objects: state.objects.filter((o) => o.clientRef !== state.selectedRef),
        ...singleSelect(null),
        dirty: true,
      }
    }

    case 'generate_bins': {
      // Fill a rectangle with bins, skipping any cell an incompatible occupant
      // already owns — walls and docks included, not just other bins. The old
      // check only knew about placements, so the wizard would happily fill a
      // rectangle straight through a wall. Skips are now REPORTED (blockedAt.count):
      // RackWizard closes its modal on submit, so "Generate 40" quietly producing
      // 28 bins was invisible.
      const index = buildOccupancyIndex(state)
      // A fill can cross several areas, so rasterize once and carry a per-pool
      // high-water mark through the loop rather than re-deriving it per cell. The
      // loop already walks dy-then-dx, which is the same reading order
      // assignAutoNames sorts into — so the server's recomputation agrees.
      const areaIndex = buildAreaIndex(state.objects)
      const highWater = new Map(
        assignAutoNames(editorUnits(state.placements), areaIndex, { minSeq: seqFloorMap(state) }).highWater,
      )
      const added: EditorPlacement[] = []
      let seq = state.seq
      let skipped = 0
      let firstSkip: { x: number; y: number; kind: OccupantKind } | null = null
      for (let dy = 0; dy < action.rows; dy++) {
        for (let dx = 0; dx < action.cols; dx++) {
          const x = action.startX + dx
          const y = action.startY + dy
          const blocker = blockedByIndex(index, x, y, 'storage')
          if (blocker) {
            skipped++
            if (!firstSkip) firstSkip = { x, y, kind: blocker.kind }
            continue
          }
          const code = `${state.codePrefix}-B-${x}-${y}`
          const nameArea = areaNameAtIndexed(areaIndex, state.floor, x, y)
          const nameSeq = (highWater.get(nameArea) ?? 0) + 1
          highWater.set(nameArea, nameSeq)
          added.push({
            clientRef: `p${seq++}`, floor: state.floor, x, y, w: 1, h: 1, rotation: 0,
            kind: 'BIN', code, name: composeName(nameArea, nameSeq),
            nameSeq, nameArea, nameIsAuto: true,
            // See the action type: an explicit null is "uncounted" and must
            // survive, where an omitted field still means the generic 10.
            capacitySlots: action.capacitySlots === null ? undefined : action.capacitySlots ?? 10,
            slotKind: action.slotKind ?? 'pallet',
            weightCapacityKg: action.weightCapacityKg,
            zoneProfileId: action.zoneProfileId, storageTypeId: action.storageTypeId,
            levels: action.levelTemplate ? applyTemplate(action.levelTemplate, code) : undefined,
          })
        }
      }
      const blocked: BlockedPaint | null = firstSkip
        ? { x: firstSkip.x, y: firstSkip.y, floor: state.floor, blockedBy: firstSkip.kind, tool: 'rack', count: skipped, seq: (state.blockedAt?.seq ?? 0) + 1 }
        : null
      // A fully-blocked fill still has to report, so return the hint rather than
      // the untouched state.
      if (added.length === 0) return blocked ? { ...state, blockedAt: blocked } : state
      // Report which numbers were minted, per area — the wizard's modal is gone
      // by now, so this is the operator's only sight of them.
      const ranges = describeSeqRanges(
        added.map((p) => ({
          ref: p.clientRef, areaName: p.nameArea ?? '', seq: p.nameSeq ?? 0, name: p.name,
          levelNames: {}, assigned: true, restamped: false, isAuto: true,
        })),
      )
      return {
        ...state,
        placements: [...state.placements, ...added],
        seq,
        dirty: true,
        blockedAt: blocked,
        lastFill: { count: added.length, ranges, seq: (state.lastFill?.seq ?? 0) + 1 },
      }
    }

    case 'load': {
      let seq = state.seq
      // A levelled rack (mig 00072) comes back as N co-located placement rows,
      // one per level SHELF location; the editor models it as ONE EditorPlacement
      // carrying an embedded `levels[]`. So collapse every level row onto its RACK
      // parent, keyed by parentId, and map the parent once. Legacy single-bin rows
      // (no level metadata) still map 1:1, byte-identical to before. Without this
      // regroup, reloading a saved override showed the form's standard template,
      // not what was actually persisted.
      const levelRowsByRack = new Map<number, LayoutPlacement[]>()
      const flatRows: LayoutPlacement[] = []
      for (const p of action.placements) {
        const meta = action.codeByLocation[p.locationId]
        const parentId = meta?.parentId
        const isLevelRow = meta?.levelIndex != null || p.levelIndex != null
        if (isLevelRow && parentId != null) {
          const bucket = levelRowsByRack.get(parentId)
          if (bucket) bucket.push(p)
          else levelRowsByRack.set(parentId, [p])
        } else {
          flatRows.push(p)
        }
      }

      const placements: EditorPlacement[] = flatRows.map((p) => {
        const meta = action.codeByLocation[p.locationId]
        return {
          clientRef: `p${seq++}`, locationId: p.locationId, floor: p.floor, x: p.x, y: p.y, w: p.w, h: p.h,
          rotation: p.rotation, kind: meta?.kind ?? 'BIN', code: meta?.code ?? `L${p.locationId}`,
          // The `?? Bin N` fallback stays: it means "the server sent me no
          // metadata for this row", not "this is how bins are named".
          name: meta?.name ?? `Bin ${p.locationId}`, capacitySlots: meta?.capacitySlots, slotKind: meta?.slotKind,
          weightCapacityKg: meta?.weightCapacityKg, storageTypeId: meta?.storageTypeId,
          nameSeq: meta?.nameSeq ?? null, nameArea: meta?.nameArea ?? null,
          nameIsAuto: meta?.nameIsAuto ?? false,
        }
      })

      for (const [rackId, rows] of levelRowsByRack) {
        const rackMeta = action.codeByLocation[rackId]
        // Levels are co-located; take geometry from the lowest-level row.
        const anchor = [...rows].sort((a, b) => {
          const ai = action.codeByLocation[a.locationId]?.levelIndex ?? a.levelIndex ?? 0
          const bi = action.codeByLocation[b.locationId]?.levelIndex ?? b.levelIndex ?? 0
          return ai - bi
        })
        const levels: RackLevel[] = anchor.map((row) => {
          const m = action.codeByLocation[row.locationId]
          return {
            locationId: row.locationId,
            levelIndex: m?.levelIndex ?? row.levelIndex ?? 1,
            // No stored role = unconstrained. Defaulting to 'pick' here would
            // silently claim these levels are pick zones, which now drives
            // replenishment and order allocation.
            role: m?.levelRole ?? '',
            code: m?.code,
            capacitySlots: m?.capacitySlots,
            slotKind: m?.slotKind,
            weightCapacityKg: m?.weightCapacityKg,
          }
        })
        const g = anchor[0]
        placements.push({
          clientRef: `p${seq++}`, locationId: rackId, floor: g.floor, x: g.x, y: g.y, w: g.w, h: g.h,
          rotation: g.rotation, kind: 'RACK', code: rackMeta?.code ?? `R${rackId}`,
          name: rackMeta?.name ?? `Rack ${rackId}`, storageTypeId: rackMeta?.storageTypeId,
          nameSeq: rackMeta?.nameSeq ?? null, nameArea: rackMeta?.nameArea ?? null,
          nameIsAuto: rackMeta?.nameIsAuto ?? false,
          levels,
        })
      }
      const objects: EditorObject[] = action.objects.map((o) => ({
        clientRef: `o${seq++}`, objectType: o.objectType, floor: o.floor, x: o.x, y: o.y, w: o.w, h: o.h,
        // Round-trip meta/staging link — previously dropped here, which silently
        // lost imported zone-label names on the next manual save.
        meta: o.meta, stagingLocationId: o.stagingLocationId,
      }))
      // Every number this warehouse has ever handed out — codeByLocation covers
      // the whole warehouse, not just this layout, so a rack that was deleted
      // from the layout but still exists (and still has a label on it) keeps its
      // claim. See EditorState.seqFloor.
      const seqFloor = Object.fromEntries(highWaterFromRows(Object.values(action.codeByLocation)))
      return { ...state, placements, objects, ...singleSelect(null), dirty: false, seq, pendingRenames: [], seqFloor }
    }

    case 'mark_saved': {
      const byRef = new Map(action.refMap.map((r) => [r.client_ref, r.location_id]))
      // A levelled rack's ref_map entry also names the SHELF location the server
      // created for each level. Recording them is what lets the NEXT save address
      // those levels: `locationId` alone identifies the RACK PARENT, and a save
      // that sends the parent with no levels is read as "this cell is one flat
      // location" — the levels lose their placement rows and are garbage-collected.
      // Before this, level ids only appeared after a full page reload, so the
      // second save of a freshly-drawn rack re-created every level from scratch.
      const levelsByRef = new Map(
        action.refMap
          .filter((r) => r.level_location_ids)
          .map((r) => [r.client_ref, r.level_location_ids as Record<number, number>]),
      )
      const namesByRef = new Map(action.refMap.map((r) => [r.client_ref, r]))
      // Raise the floor with what the server just committed. The editor hydrates
      // `seqFloor` once per layout, so without this a rack drawn, saved and then
      // deleted in one session would hand its number to the next rack — while
      // its label is on the racking.
      const seqFloor = { ...state.seqFloor }
      for (const r of action.refMap) {
        if (r.name_seq == null) continue
        const pool = (r.name_area ?? '').trim()
        seqFloor[pool] = Math.max(seqFloor[pool] ?? 0, r.name_seq)
      }
      return {
        ...state,
        seqFloor,
        placements: state.placements.map((p) => {
          if (!byRef.has(p.clientRef)) return p
          const levelIds = levelsByRef.get(p.clientRef)
          const levels = levelIds && p.levels
            ? p.levels.map((l) => {
                const id = levelIds[l.levelIndex]
                return id === undefined ? l : { ...l, locationId: id }
              })
            : p.levels
          // Adopt the server's name/number where it sent one. It recomputed from
          // the database, so this is where a stale tab's guess gets corrected.
          const named = namesByRef.get(p.clientRef)
          const naming = named?.name
            ? { name: named.name, nameSeq: named.name_seq ?? null, nameArea: named.name_area ?? null }
            : {}
          return { ...p, locationId: byRef.get(p.clientRef), levels, ...naming }
        }),
        pendingRenames: [],
        dirty: false,
      }
    }

    case 'apply_auto_connect': {
      // Wholesale replace of the object list (walls carved under docks + new
      // walkway cells), same as 'load': every object gets a fresh clientRef.
      // Placements and selection are untouched — auto-connect never moves bins.
      let seq = state.seq
      const objects: EditorObject[] = action.objects.map((o) => ({
        clientRef: `o${seq++}`, objectType: o.objectType, floor: o.floor, x: o.x, y: o.y, w: o.w, h: o.h,
        meta: o.meta, stagingLocationId: o.stagingLocationId,
      }))
      return { ...state, objects, seq, dirty: true }
    }

    case 'apply_overlap_repair': {
      // Same wholesale object replace as 'apply_auto_connect', plus the one thing
      // that action is missing: every clientRef is regenerated, so a selection
      // pointing at an OBJECT is now dangling and must be cleared. A selection
      // pointing at a placement survives — placements aren't touched here.
      let seq = state.seq
      const objects: EditorObject[] = action.objects.map((o) => ({
        clientRef: `o${seq++}`, objectType: o.objectType, floor: o.floor, x: o.x, y: o.y, w: o.w, h: o.h,
        meta: o.meta, stagingLocationId: o.stagingLocationId,
      }))
      const selectionWasPlacement = state.placements.some((p) => p.clientRef === state.selectedRef)
      return {
        ...state,
        objects,
        seq,
        dirty: true,
        ...(selectionWasPlacement ? {} : singleSelect(null)),
      }
    }

    case 'set_rack_levels':
      return {
        ...state,
        placements: state.placements.map((p) => (p.clientRef === action.ref ? { ...p, levels: action.levels } : p)),
        dirty: true,
      }

    case 'apply_levels_to_selection': {
      // selectedRefs is always a superset of selectedRef (see singleSelect), so
      // in the single-select case this already targets just the one selection;
      // multi-select (ctrl/shift-click) widens it to every selected rack.
      const targets = state.selectedRefs
      if (targets.size === 0) return state
      return {
        ...state,
        // Each target keeps its OWN code — recompute per rack rather than
        // stamping every selected rack with the same `-L<n>` codes.
        placements: state.placements.map((p) => (targets.has(p.clientRef) ? { ...p, levels: applyTemplate(action.levels, p.code) } : p)),
        dirty: true,
      }
    }

    default:
      return state
  }
}

export function useLayoutEditorState(codePrefix = 'W') {
  return useReducer(layoutEditorReducer, codePrefix, initialEditorState)
}
