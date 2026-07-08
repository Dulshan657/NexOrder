// Renderer-agnostic state model for the WIE layout designer.
//
// A pure reducer over the working set of placements (storage bins) and objects
// (walls/walkways/docks) on a grid. The canvas is just a view of this state;
// keeping the model pure makes it unit-testable and lets the render layer swap
// from SVG to <canvas> later without touching the logic. Phase 1 works in 1×1
// cells on a single floor — enough for the vertical slice; multi-cell footprints
// and zones come in Phase 2.

import { useReducer } from 'react'
import type { LayoutObject, LayoutObjectType, LayoutPlacement } from '@/types'

// 'rack' is the generic storage-paint tool; WHICH form it draws is carried by
// `activeForm` (mig 00061 storage forms), so every drawable form shares one tool.
export type EditorTool = 'select' | 'walkway' | 'wall' | 'dock' | 'lift' | 'rack' | 'erase'

/** The storage form the 'rack' tool currently paints (from the forms catalogue). */
export interface ActiveStorageForm {
  storageTypeId?: number
  label: string
  capacitySlots?: number
  slotKind?: 'pallet' | 'carton'
  weightCapacityKg?: number
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
}

export interface EditorObject {
  clientRef: string
  objectType: LayoutObjectType
  floor: number
  x: number
  y: number
  w: number
  h: number
}

export interface EditorState {
  tool: EditorTool
  floor: number
  placements: EditorPlacement[]
  objects: EditorObject[]
  selectedRef: string | null
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
  | { type: 'select'; ref: string | null }
  | { type: 'update_placement'; ref: string; patch: Partial<Omit<EditorPlacement, 'clientRef'>> }
  | { type: 'delete_selected' }
  | { type: 'generate_bins'; startX: number; startY: number; cols: number; rows: number; capacitySlots?: number; slotKind?: 'pallet' | 'carton'; weightCapacityKg?: number; zoneProfileId?: number; storageTypeId?: number }
  | { type: 'load'; placements: LayoutPlacement[]; objects: LayoutObject[]; codeByLocation: Record<number, { code: string; name: string; kind: EditorPlacement['kind']; capacitySlots?: number; slotKind?: 'pallet' | 'carton'; weightCapacityKg?: number; storageTypeId?: number }> }
  | { type: 'mark_saved'; refMap: Array<{ client_ref: string; location_id: number }> }

export function initialEditorState(codePrefix = 'W'): EditorState {
  return { tool: 'select', floor: 0, placements: [], objects: [], selectedRef: null, dirty: false, seq: 1, codePrefix, activeForm: null }
}

const OBJECT_TOOLS: Partial<Record<EditorTool, LayoutObjectType>> = {
  walkway: 'walkway',
  wall: 'wall',
  dock: 'dock',
  lift: 'lift',
}

function objectAt(state: EditorState, x: number, y: number): EditorObject | undefined {
  return state.objects.find((o) => o.floor === state.floor && o.x === x && o.y === y)
}

function placementAt(state: EditorState, x: number, y: number): EditorPlacement | undefined {
  return state.placements.find((p) => p.floor === state.floor && p.x === x && p.y === y)
}

export function layoutEditorReducer(state: EditorState, action: EditorAction): EditorState {
  switch (action.type) {
    case 'set_tool':
      return { ...state, tool: action.tool }

    case 'set_storage_form':
      // Selecting a form activates the storage-paint tool bound to that form.
      return { ...state, tool: 'rack', activeForm: action.form, selectedRef: null }

    case 'set_floor':
      return { ...state, floor: action.floor, selectedRef: null }

    case 'select':
      return { ...state, selectedRef: action.ref }

    case 'paint_cell': {
      const { x, y } = action

      if (state.tool === 'erase') {
        const obj = objectAt(state, x, y)
        const place = placementAt(state, x, y)
        if (!obj && !place) return state
        return {
          ...state,
          objects: state.objects.filter((o) => o !== obj),
          placements: state.placements.filter((p) => p !== place),
          selectedRef: place && place.clientRef === state.selectedRef ? null : state.selectedRef,
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
        const placement: EditorPlacement = {
          clientRef: ref, floor: state.floor, x, y, w: 1, h: 1, rotation: 0,
          kind: 'BIN', code: `${state.codePrefix}-B-${x}-${y}`, name: `Bin ${x},${y}`,
          capacitySlots: f?.capacitySlots ?? 10, slotKind: f?.slotKind ?? 'pallet',
          weightCapacityKg: f?.weightCapacityKg, storageTypeId: f?.storageTypeId,
        }
        return { ...state, placements: [...state.placements, placement], selectedRef: ref, seq: state.seq + 1, dirty: true }
      }

      // select tool: clicking a bin selects it.
      const hit = placementAt(state, x, y)
      return { ...state, selectedRef: hit?.clientRef ?? null }
    }

    case 'update_placement':
      return {
        ...state,
        placements: state.placements.map((p) => (p.clientRef === action.ref ? { ...p, ...action.patch } : p)),
        dirty: true,
      }

    case 'delete_selected': {
      if (!state.selectedRef) return state
      return {
        ...state,
        placements: state.placements.filter((p) => p.clientRef !== state.selectedRef),
        selectedRef: null,
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
          added.push({
            clientRef: `p${seq++}`, floor: state.floor, x, y, w: 1, h: 1, rotation: 0,
            kind: 'BIN', code: `${state.codePrefix}-B-${x}-${y}`, name: `Bin ${x},${y}`,
            capacitySlots: action.capacitySlots ?? 10, slotKind: action.slotKind ?? 'pallet',
            weightCapacityKg: action.weightCapacityKg,
            zoneProfileId: action.zoneProfileId, storageTypeId: action.storageTypeId,
          })
        }
      }
      if (added.length === 0) return state
      return { ...state, placements: [...state.placements, ...added], seq, dirty: true }
    }

    case 'load': {
      let seq = state.seq
      const placements: EditorPlacement[] = action.placements.map((p) => {
        const meta = action.codeByLocation[p.locationId]
        return {
          clientRef: `p${seq++}`, locationId: p.locationId, floor: p.floor, x: p.x, y: p.y, w: p.w, h: p.h,
          rotation: p.rotation, kind: meta?.kind ?? 'BIN', code: meta?.code ?? `L${p.locationId}`,
          name: meta?.name ?? `Bin ${p.locationId}`, capacitySlots: meta?.capacitySlots, slotKind: meta?.slotKind,
          weightCapacityKg: meta?.weightCapacityKg, storageTypeId: meta?.storageTypeId,
        }
      })
      const objects: EditorObject[] = action.objects.map((o) => ({
        clientRef: `o${seq++}`, objectType: o.objectType, floor: o.floor, x: o.x, y: o.y, w: o.w, h: o.h,
      }))
      return { ...state, placements, objects, selectedRef: null, dirty: false, seq }
    }

    case 'mark_saved': {
      const byRef = new Map(action.refMap.map((r) => [r.client_ref, r.location_id]))
      return {
        ...state,
        placements: state.placements.map((p) => (byRef.has(p.clientRef) ? { ...p, locationId: byRef.get(p.clientRef) } : p)),
        dirty: false,
      }
    }

    default:
      return state
  }
}

export function useLayoutEditorState(codePrefix = 'W') {
  return useReducer(layoutEditorReducer, codePrefix, initialEditorState)
}
