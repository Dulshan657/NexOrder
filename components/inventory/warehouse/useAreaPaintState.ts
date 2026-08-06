// Working state for painting named areas on a LIVE warehouse map (mig 00095).
//
// A plain reducer with no I/O, so it is unit-testable exactly like
// layoutEditorReducer — and so the one thing that actually matters can be pinned
// by a test: the working set folds down to the SAME AreaPaintSpec[] the designer
// produces from its own editor state. That is what "two surfaces, one server
// path" means in practice.
//
// The working set spans every floor. Painting always targets the current floor,
// but switching floors mid-session keeps both the cells and the undo stack —
// pools are per area NAME across floors, so a session that could only see one
// floor would let an operator create a second "Chiller" without noticing.

import { useReducer, useMemo, useCallback } from 'react'
import type { LayoutObject } from '@/types'
import { areaSpecsFromObjects, areaObjectsFromSpecs, type AreaPaintSpec } from '@/lib/areaPaint'
import { sanitizeAreaName } from '@/lib/locationNaming'

/** How deep undo goes. A Map copy at a few thousand cells is trivial; the cap is
 *  only here so a long session cannot grow without bound. */
const UNDO_LIMIT = 30

export interface AreaBrush {
  name: string
  zoneProfileId: number | null
}

interface Snapshot {
  cells: Map<string, string>
  profiles: Map<string, number | null>
}

export interface AreaPaintState extends Snapshot {
  active: boolean
  brush: AreaBrush
  mode: 'paint' | 'erase'
  undo: Snapshot[]
  dirty: boolean
}

export type AreaPaintAction =
  /** Enter paint mode, hydrating the working set from what the map is drawing. */
  | { type: 'begin'; objects: readonly LayoutObject[] }
  | { type: 'cancel' }
  /** Re-hydrate from the server's answer and drop the dirty flag. */
  | { type: 'saved'; objects: readonly LayoutObject[] }
  | { type: 'set_brush_name'; name: string }
  | { type: 'set_brush_profile'; zoneProfileId: number | null }
  | { type: 'set_mode'; mode: 'paint' | 'erase' }
  /** Push one undo snapshot. Fired on pointerdown, so a 60-cell drag is ONE undo. */
  | { type: 'stroke_start' }
  | { type: 'paint_cell'; floor: number; x: number; y: number }
  /** Remove every cell of an area in one act — dragging over 50 cells to delete
   *  an area is not a reasonable way to ask for that. */
  | { type: 'erase_area'; name: string }
  | { type: 'undo' }

export const cellKey = (floor: number, x: number, y: number): string => `${floor}:${x}:${y}`

const EMPTY: AreaPaintState = {
  active: false,
  brush: { name: '', zoneProfileId: null },
  mode: 'paint',
  cells: new Map(),
  profiles: new Map(),
  undo: [],
  dirty: false,
}

/** Fold the map's own area rows into a working set. */
function hydrate(objects: readonly LayoutObject[]): Snapshot {
  const cells = new Map<string, string>()
  const profiles = new Map<string, number | null>()
  for (const spec of areaSpecsFromObjects(objects as any)) {
    profiles.set(spec.name, spec.zoneProfileId)
    for (const cell of spec.cells) cells.set(cellKey(cell.floor, cell.x, cell.y), spec.name)
  }
  return { cells, profiles }
}

const snapshot = (state: AreaPaintState): Snapshot => ({
  cells: new Map(state.cells),
  profiles: new Map(state.profiles),
})

/** Push an undo entry for a discrete act (not a stroke, which pushes its own). */
function pushUndo(state: AreaPaintState): Snapshot[] {
  return [...state.undo, snapshot(state)].slice(-UNDO_LIMIT)
}

/** Drop profiles for names that no longer have a single cell. An area with no
 *  cells does not exist, and keeping its profile would silently resurrect it if
 *  the operator repainted the name later. */
function prune(cells: Map<string, string>, profiles: Map<string, number | null>) {
  const live = new Set(cells.values())
  const next = new Map<string, number | null>()
  for (const [name, profile] of profiles) if (live.has(name)) next.set(name, profile)
  return next
}

export function areaPaintReducer(state: AreaPaintState, action: AreaPaintAction): AreaPaintState {
  switch (action.type) {
    case 'begin':
      return { ...EMPTY, ...hydrate(action.objects), active: true }

    case 'cancel':
      return EMPTY

    case 'saved':
      return { ...state, ...hydrate(action.objects), undo: [], dirty: false }

    case 'set_brush_name':
      return { ...state, brush: { ...state.brush, name: sanitizeAreaName(action.name) } }

    case 'set_brush_profile': {
      const name = sanitizeAreaName(state.brush.name)
      const brush = { ...state.brush, zoneProfileId: action.zoneProfileId }
      // Re-tinting an area that already exists is a WHOLE-AREA act, not a
      // property of the next stroke — "highlight this area and give it a zone
      // profile" must not require repainting every cell of it.
      if (!state.profiles.has(name) || state.profiles.get(name) === action.zoneProfileId) {
        return { ...state, brush }
      }
      const profiles = new Map(state.profiles)
      profiles.set(name, action.zoneProfileId)
      return { ...state, brush, profiles, undo: pushUndo(state), dirty: true }
    }

    case 'set_mode':
      return { ...state, mode: action.mode }

    case 'stroke_start':
      return { ...state, undo: pushUndo(state) }

    case 'paint_cell': {
      const key = cellKey(action.floor, action.x, action.y)
      if (state.mode === 'erase') {
        if (!state.cells.has(key)) return state
        const cells = new Map(state.cells)
        cells.delete(key)
        return { ...state, cells, profiles: prune(cells, state.profiles), dirty: true }
      }
      const name = sanitizeAreaName(state.brush.name)
      if (!name || state.cells.get(key) === name) return state
      const cells = new Map(state.cells)
      cells.set(key, name)
      const profiles = new Map(state.profiles)
      // A brand-new area takes the brush's profile; an existing one keeps its
      // own, so extending "Chiller" with a stale brush cannot re-tint it.
      if (!profiles.has(name)) profiles.set(name, state.brush.zoneProfileId)
      return { ...state, cells, profiles: prune(cells, profiles), dirty: true }
    }

    case 'erase_area': {
      const name = sanitizeAreaName(action.name)
      const cells = new Map(state.cells)
      let removed = false
      for (const [key, value] of state.cells) {
        if (value !== name) continue
        cells.delete(key)
        removed = true
      }
      if (!removed) return state
      return { ...state, cells, profiles: prune(cells, state.profiles), undo: pushUndo(state), dirty: true }
    }

    case 'undo': {
      const previous = state.undo[state.undo.length - 1]
      if (!previous) return state
      return { ...state, ...previous, undo: state.undo.slice(0, -1), dirty: true }
    }

    default:
      return state
  }
}

/** The payload this working set describes. The one fold both surfaces use. */
export function specsFromPaintState(state: AreaPaintState): AreaPaintSpec[] {
  const byName = new Map<string, AreaPaintSpec>()
  for (const [key, name] of state.cells) {
    const [floor, x, y] = key.split(':').map(Number)
    const spec = byName.get(name) ?? { name, zoneProfileId: state.profiles.get(name) ?? null, cells: [] }
    spec.cells.push({ floor, x, y })
    byName.set(name, spec)
  }
  // Round-trip through the shared fold so ordering and de-duplication are
  // decided in exactly one place — the same place the server decides them.
  return areaSpecsFromObjects(areaObjectsFromSpecs([...byName.values()]))
}

/** Every area name in the working set, for the "extend an existing area" chips. */
export function areaNamesInPaintState(state: AreaPaintState): string[] {
  return [...new Set(state.cells.values())].sort()
}

export function useAreaPaintState() {
  const [state, dispatch] = useReducer(areaPaintReducer, EMPTY)

  const specs = useMemo(() => specsFromPaintState(state), [state.cells, state.profiles])
  const names = useMemo(() => areaNamesInPaintState(state), [state.cells])

  /** The area rows the canvas should draw while painting — the working set
   *  rendered through the very same shape the stored rows have, so the preview
   *  and the saved result cannot look different. */
  const previewObjects = useMemo(
    () => areaObjectsFromSpecs(specs).map((o, i) => ({
      id: -(i + 1),
      layoutId: 0,
      objectType: 'area' as const,
      floor: o.floor,
      x: o.x,
      y: o.y,
      w: 1,
      h: 1,
      meta: o.meta as Record<string, unknown>,
    })),
    [specs],
  )

  const paintCell = useCallback((floor: number, x: number, y: number) => {
    dispatch({ type: 'paint_cell', floor, x, y })
  }, [])

  return { state, dispatch, specs, names, previewObjects, paintCell }
}
