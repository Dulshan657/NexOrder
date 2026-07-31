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

// 'rack' is the generic storage-paint tool; WHICH form it draws is carried by
// `activeForm` (mig 00061 storage forms), so every drawable form shares one tool.
export type EditorTool =
  | 'select' | 'walkway' | 'wall' | 'dock' | 'lift' | 'conveyor' | 'staging' | 'obstacle' | 'label' | 'rack' | 'erase'

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
}

export interface BlockedPaint {
  x: number
  y: number
  floor: number
  blockedBy: OccupantKind
  tool: EditorTool
  /** Cells skipped by a batch fill; absent for a single refused stroke. */
  count?: number
  seq: number
}

export type EditorAction =
  | { type: 'set_tool'; tool: EditorTool }
  | { type: 'set_storage_form'; form: ActiveStorageForm }
  | { type: 'set_floor'; floor: number }
  | { type: 'paint_cell'; x: number; y: number }
  // `additive: true` toggles `ref` into the multi-selection instead of
  // replacing it (ctrl/shift-click on the canvas); omitted/false keeps the
  // original single-select replace behaviour untouched.
  | { type: 'select'; ref: string | null; additive?: boolean }
  | { type: 'update_placement'; ref: string; patch: Partial<Omit<EditorPlacement, 'clientRef'>> }
  | { type: 'update_object'; ref: string; patch: { meta?: Record<string, unknown> } }
  | { type: 'delete_selected' }
  | { type: 'generate_bins'; startX: number; startY: number; cols: number; rows: number; capacitySlots?: number; slotKind?: 'pallet' | 'carton'; weightCapacityKg?: number; zoneProfileId?: number; storageTypeId?: number; levelTemplate?: RackLevel[] }
  | { type: 'load'; placements: LayoutPlacement[]; objects: LayoutObject[]; codeByLocation: Record<number, { code: string; name: string; kind: EditorPlacement['kind']; capacitySlots?: number; slotKind?: 'pallet' | 'carton'; weightCapacityKg?: number; storageTypeId?: number; parentId?: number; levelRole?: LevelRole; levelIndex?: number }> }
  // `level_location_ids` is present only for a levelled rack: level_index -> the
  // SHELF location id the server created/kept for it (mig 00072).
  | { type: 'mark_saved'; refMap: Array<{ client_ref: string; location_id: number; level_location_ids?: Record<number, number> }> }
  | { type: 'apply_auto_connect'; objects: Array<Pick<EditorObject, 'objectType' | 'floor' | 'x' | 'y' | 'w' | 'h'> & Partial<Pick<EditorObject, 'meta' | 'stagingLocationId'>>> }
  // Wholesale object replace from resolveLayoutOverlaps (the "Clean up overlaps"
  // repair). Placements are never touched by it.
  | { type: 'apply_overlap_repair'; objects: Array<Pick<EditorObject, 'objectType' | 'floor' | 'x' | 'y' | 'w' | 'h'> & Partial<Pick<EditorObject, 'meta' | 'stagingLocationId'>>> }
  // Rack levels (mig 00072).
  | { type: 'set_rack_levels'; ref: string; levels: RackLevel[] }
  | { type: 'apply_levels_to_selection'; levels: RackLevel[] }

export function initialEditorState(codePrefix = 'W'): EditorState {
  return { tool: 'select', floor: 0, placements: [], objects: [], selectedRef: null, selectedRefs: new Set(), dirty: false, seq: 1, codePrefix, activeForm: null, blockedAt: null }
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
 * Only two exemptions, both principled:
 *  - `label` is annotation, not structure. It co-exists with everything: it is
 *    already exempt from the AI importer's resolveObjectOverlaps and is
 *    non-blocking in publishReadiness' buildWalkableCells.
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
  label: ['label', 'wall', 'dock', 'walkway', 'obstacle', 'lift', 'conveyor', 'staging', 'storage'],
  wall: ['label'],
  dock: ['label', 'staging'],
  walkway: ['label'],
  obstacle: ['label'],
  lift: ['label'],
  conveyor: ['label'],
  staging: ['label', 'dock'],
  storage: ['label'],
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
    blockedAt: { x, y, floor: state.floor, blockedBy, tool: state.tool, count, seq: (state.blockedAt?.seq ?? 0) + 1 },
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

export function layoutEditorReducer(state: EditorState, action: EditorAction): EditorState {
  switch (action.type) {
    case 'set_tool':
      return { ...state, tool: action.tool }

    case 'set_storage_form':
      // Selecting a form activates the storage-paint tool bound to that form.
      return { ...state, tool: 'rack', activeForm: action.form, ...singleSelect(null) }

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
        const obj = objectAt(state, x, y)
        const place = placementAt(state, x, y)
        if (!obj && !place) return state
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
        const blocker = blockerAt(state, x, y, objectType)
        // Same-kind is an idempotent RE-PAINT, not a refusal: a drag that
        // crosses its own stroke must not flash red or toast. `label` is the
        // exception — the matrix lets it co-exist with itself, so it falls
        // through to the replace below and a drag can't stack N labels on a cell.
        if (blocker && blocker.kind === objectType && objectType !== 'label') return state
        if (blocker) return refuse(state, x, y, blocker.kind)
        // Don't stack same-type; replace whatever object of this type covers the cell.
        const without = state.objects.filter((o) => !(o.floor === state.floor && o.objectType === objectType && covers(o, x, y)))
        const obj: EditorObject = { clientRef: `o${state.seq}`, objectType, floor: state.floor, x, y, w: 1, h: 1 }
        return { ...state, objects: [...without, obj], seq: state.seq + 1, dirty: true, blockedAt: null }
      }

      if (state.tool === 'rack') {
        const blocker = blockerAt(state, x, y, 'storage')
        if (blocker && blocker.kind === 'storage') return state // already a bin here
        if (blocker) return refuse(state, x, y, blocker.kind)
        const ref = `p${state.seq}`
        const f = state.activeForm
        const code = `${state.codePrefix}-B-${x}-${y}`
        const placement: EditorPlacement = {
          clientRef: ref, floor: state.floor, x, y, w: 1, h: 1, rotation: 0,
          kind: 'BIN', code, name: `Bin ${x},${y}`,
          capacitySlots: f?.capacitySlots ?? 10, slotKind: f?.slotKind ?? 'pallet',
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

    case 'update_placement':
      return {
        ...state,
        placements: state.placements.map((p) => (p.clientRef === action.ref ? { ...p, ...action.patch } : p)),
        dirty: true,
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
          added.push({
            clientRef: `p${seq++}`, floor: state.floor, x, y, w: 1, h: 1, rotation: 0,
            kind: 'BIN', code, name: `Bin ${x},${y}`,
            capacitySlots: action.capacitySlots ?? 10, slotKind: action.slotKind ?? 'pallet',
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
      return { ...state, placements: [...state.placements, ...added], seq, dirty: true, blockedAt: blocked }
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
          name: meta?.name ?? `Bin ${p.locationId}`, capacitySlots: meta?.capacitySlots, slotKind: meta?.slotKind,
          weightCapacityKg: meta?.weightCapacityKg, storageTypeId: meta?.storageTypeId,
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
          levels,
        })
      }
      const objects: EditorObject[] = action.objects.map((o) => ({
        clientRef: `o${seq++}`, objectType: o.objectType, floor: o.floor, x: o.x, y: o.y, w: o.w, h: o.h,
        // Round-trip meta/staging link — previously dropped here, which silently
        // lost imported zone-label names on the next manual save.
        meta: o.meta, stagingLocationId: o.stagingLocationId,
      }))
      return { ...state, placements, objects, ...singleSelect(null), dirty: false, seq }
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
      return {
        ...state,
        placements: state.placements.map((p) => {
          if (!byRef.has(p.clientRef)) return p
          const levelIds = levelsByRef.get(p.clientRef)
          const levels = levelIds && p.levels
            ? p.levels.map((l) => {
                const id = levelIds[l.levelIndex]
                return id === undefined ? l : { ...l, locationId: id }
              })
            : p.levels
          return { ...p, locationId: byRef.get(p.clientRef), levels }
        }),
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
