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
  | { type: 'mark_saved'; refMap: Array<{ client_ref: string; location_id: number }> }
  | { type: 'apply_auto_connect'; objects: Array<Pick<EditorObject, 'objectType' | 'floor' | 'x' | 'y' | 'w' | 'h'> & Partial<Pick<EditorObject, 'meta' | 'stagingLocationId'>>> }
  // Rack levels (mig 00072).
  | { type: 'set_rack_levels'; ref: string; levels: RackLevel[] }
  | { type: 'apply_levels_to_selection'; levels: RackLevel[] }

export function initialEditorState(codePrefix = 'W'): EditorState {
  return { tool: 'select', floor: 0, placements: [], objects: [], selectedRef: null, selectedRefs: new Set(), dirty: false, seq: 1, codePrefix, activeForm: null }
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

function objectAt(state: EditorState, x: number, y: number): EditorObject | undefined {
  return state.objects.find((o) => o.floor === state.floor && o.x === x && o.y === y)
}

function placementAt(state: EditorState, x: number, y: number): EditorPlacement | undefined {
  return state.placements.find((p) => p.floor === state.floor && p.x === x && p.y === y)
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
        const erasedSelectedRef = place && place.clientRef === state.selectedRef
        const selectedRefs = place ? withoutRef(state.selectedRefs, place.clientRef) : state.selectedRefs
        return {
          ...state,
          objects: state.objects.filter((o) => o !== obj),
          placements: state.placements.filter((p) => p !== place),
          selectedRef: erasedSelectedRef ? null : state.selectedRef,
          selectedRefs,
          dirty: true,
        }
      }

      const objectType = OBJECT_TOOLS[state.tool]
      if (objectType) {
        // Don't stack; replace whatever object is already in the cell.
        const without = state.objects.filter((o) => !(o.floor === state.floor && o.x === x && o.y === y))
        const obj: EditorObject = { clientRef: `o${state.seq}`, objectType, floor: state.floor, x, y, w: 1, h: 1 }
        return { ...state, objects: [...without, obj], seq: state.seq + 1, dirty: true }
      }

      if (state.tool === 'rack') {
        if (placementAt(state, x, y)) return state // already a bin here
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
        return { ...state, placements: [...state.placements, placement], ...singleSelect(ref), seq: state.seq + 1, dirty: true }
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
      // Fill a rectangle with bins, skipping any cell already occupied by a bin.
      const occupied = new Set(
        state.placements.filter((p) => p.floor === state.floor).map((p) => `${p.x}:${p.y}`),
      )
      const added: EditorPlacement[] = []
      let seq = state.seq
      for (let dy = 0; dy < action.rows; dy++) {
        for (let dx = 0; dx < action.cols; dx++) {
          const x = action.startX + dx
          const y = action.startY + dy
          if (occupied.has(`${x}:${y}`)) continue
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
      if (added.length === 0) return state
      return { ...state, placements: [...state.placements, ...added], seq, dirty: true }
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
      return {
        ...state,
        placements: state.placements.map((p) => (byRef.has(p.clientRef) ? { ...p, locationId: byRef.get(p.clientRef) } : p)),
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
