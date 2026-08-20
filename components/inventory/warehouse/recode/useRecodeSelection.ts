// Selection and settings for a code sweep (migs 00107 / 00108).
//
// A pure reducer plus a thin `use*` wrapper, mirroring useAreaPaintState — no I/O,
// no queries, unit-testable on its own. It owns the PICTURE (which units are
// selected) and the FORM (how they will be numbered), and deliberately owns nothing
// about codes themselves: the planning is the shared pure module, evaluated on the
// client for the live ghost numbers and again by the server for the `dry_run`, so
// there is no second answer here to get wrong.
//
// ── Why painting replaced the rectangle as the primary gesture ───────────────
//
// The rectangle hit-tested by INTERSECT, and a rack occupies w×h cells. Dragging a
// band round the bulk block in the middle of Amadiya's floor clipped one cell of the
// neighbouring fast-mover racks and swallowed them whole, and there was no shape the
// operator could draw that did not. A real warehouse's blocks are not rectangles.
//
// So the brush is the primary tool and the rectangle is kept as a convenience for
// the cases that ARE rectangular — now hit-testing by `contain`, because the old
// argument for intersect ("contain under-selects silently") no longer holds: the
// rect is a brush now, adding to a visible selection with live ghost numbers, so an
// under-pick is on screen and one stroke away from being fixed.
//
// The rect is stored in GRID CELLS, not pixels. MapStage derives the cell (it owns
// the viewport; WarehouseCanvas's scene memo deliberately excludes viewport.tx/ty so
// a pan stays one <g transform> update), and everything downstream — hit testing,
// the highlight set, the band's own geometry — works in the same units placements do.

import { useReducer } from 'react'
import type { LayoutPlacement } from '@/types'
import {
  WIZARD_DEFAULT_PATTERN,
  sanitizeBlockInput,
  type CodeOrder,
  type CodeOrigin,
} from '@/lib/codePattern'

export interface MarqueeRect {
  floor: number
  x0: number
  y0: number
  x1: number
  y1: number
}

/** Which brush is armed. `rect` still drags a band; `paint` walks cells. */
export type RecodeTool = 'paint' | 'rect'

/** The stepped panel's position. `'done'` is the post-apply success state, which is
 *  not step 5 — it replaces the body rather than continuing it. */
export type RecodeStep = 1 | 2 | 3 | 4 | 'done'

/** One undo frame. Only the PICTURE is undoable: Ctrl+Z after mis-painting must not
 *  also silently retype the block name, and the form's own controls are each one
 *  keystroke to put back. */
interface Snapshot {
  selected: Set<number>
}

/** 30, like useAreaPaintState. A stroke is one frame, so this is 30 strokes. */
const UNDO_LIMIT = 30

export interface RecodeSelectionState extends Snapshot {
  active: boolean
  step: RecodeStep
  tool: RecodeTool
  /** Whether a stroke adds units or removes them. */
  mode: 'add' | 'erase'
  undo: Snapshot[]
  /** The band currently being dragged. Null between drags. */
  rect: MarqueeRect | null
  /** True while the in-flight band should add to `selected` rather than replace it. */
  additive: boolean
  block: string
  /** Null = the site default (or the built-in). Typing in the advanced field sets
   *  it, and that is what makes an override an override. */
  template: string | null
  advanced: boolean
  origin: CodeOrigin
  order: CodeOrder
  /** Null = let the server continue past the block's high-water mark. */
  startAt: number | null
  /** Relay the whole block rather than appending. Armed only from a drift refusal. */
  renumberBlock: boolean
}

export type RecodeSelectionAction =
  | { type: 'begin'; origin?: CodeOrigin; order?: CodeOrder; template?: string | null }
  | { type: 'cancel' }
  | { type: 'applied' }
  | { type: 'goto_step'; step: RecodeStep }
  | { type: 'set_tool'; tool: RecodeTool }
  | { type: 'set_mode'; mode: 'add' | 'erase' }
  // One snapshot per stroke, pushed on pointerdown — so a 60-cell drag is ONE undo.
  | { type: 'stroke_start' }
  // Carries a RESOLVER for the same reason `drag_end` does: the reducer must never
  // be handed a list computed from a rect or a cell read out of a caller's render
  // closure. Both resolvers are pure selectors, so the reducer stays pure.
  //
  // `erase` overrides the armed mode for THIS action only. It exists so a right-drag
  // can subtract without dispatching `set_mode`, which would flicker the toolbar and,
  // on a pointercancel, strand the tool in Erase. Absent means "use the armed mode",
  // which is every pre-existing caller unchanged.
  | { type: 'select_cell'; floor: number; x: number; y: number; erase?: boolean; resolve: (floor: number, x: number, y: number) => number[] }
  | { type: 'drag_start'; floor: number; x: number; y: number; additive: boolean }
  | { type: 'drag_move'; x: number; y: number }
  // See the note on select_cell. A drag fast enough that React has not re-rendered
  // between pointerdown and pointerup sees `rect: null` in its own closure, and the
  // whole band silently selects nothing. Found in a real browser; no test reproduced
  // it, which is why the resolver-in-action shape is kept rather than simplified.
  //
  // An ABANDONED band — a second finger landing, or a pointercancel — resolves to
  // nothing rather than to whatever rectangle the interruption happened to freeze.
  // That needs no separate action: a resolver returning [] applies nothing, and
  // because `applyIds` reports "nothing moved" it also leaves no undo frame behind.
  | { type: 'drag_end'; erase?: boolean; resolve: (rect: MarqueeRect) => number[] }
  | { type: 'select_ids'; ids: number[]; replace?: boolean }
  | { type: 'clear_selection' }
  | { type: 'undo' }
  | { type: 'set_block'; block: string }
  | { type: 'set_template'; template: string | null }
  | { type: 'set_advanced'; advanced: boolean }
  | { type: 'set_origin'; origin: CodeOrigin }
  | { type: 'set_order'; order: CodeOrder }
  | { type: 'set_start'; startAt: number | null }
  | { type: 'set_renumber_block'; renumberBlock: boolean }

export const initialRecodeSelection: RecodeSelectionState = {
  active: false,
  step: 1,
  tool: 'paint',
  mode: 'add',
  selected: new Set<number>(),
  undo: [],
  rect: null,
  additive: false,
  block: '',
  template: null,
  advanced: false,
  origin: WIZARD_DEFAULT_PATTERN.origin,
  order: WIZARD_DEFAULT_PATTERN.order,
  startAt: null,
  renumberBlock: false,
}

/** Normalise a dragged band so x0/y0 is always the top-left, whichever direction
 *  the operator dragged. Every consumer can then treat it as a plain rectangle. */
export function normalizeRect(rect: MarqueeRect): MarqueeRect {
  return {
    floor: rect.floor,
    x0: Math.min(rect.x0, rect.x1),
    y0: Math.min(rect.y0, rect.y1),
    x1: Math.max(rect.x0, rect.x1),
    y1: Math.max(rect.y0, rect.y1),
  }
}

/**
 * Which placements a band picks up.
 *
 * `'contain'` is the default and is what the rect brush uses. A placement is taken
 * only when the band covers ALL of it, so a band drawn round the bulk block cannot
 * swallow a two-cell rack it merely clips — which is the reported bug.
 *
 * `'intersect'` is kept because it is the right answer for a different question
 * ("does this band touch anything?") and because losing it would make the change
 * untestable against the behaviour it replaced.
 */
export function placementsInRect(
  placements: readonly LayoutPlacement[],
  rect: MarqueeRect,
  mode: 'contain' | 'intersect' = 'contain',
): LayoutPlacement[] {
  const r = normalizeRect(rect)
  return placements.filter((p) => {
    if ((p.floor ?? 0) !== r.floor) return false
    const px1 = p.x + (p.w ?? 1) - 1
    const py1 = p.y + (p.h ?? 1) - 1
    return mode === 'contain'
      ? p.x >= r.x0 && px1 <= r.x1 && p.y >= r.y0 && py1 <= r.y1
      : p.x <= r.x1 && px1 >= r.x0 && p.y <= r.y1 && py1 >= r.y0
  })
}

/** Which placements cover one cell. The brush's hit test — touching any cell of a
 *  multi-cell rack takes the whole rack, since a rack is one unit to a sweep. */
export function placementsAtCell(
  placements: readonly LayoutPlacement[],
  floor: number,
  x: number,
  y: number,
): LayoutPlacement[] {
  return placements.filter((p) => {
    if ((p.floor ?? 0) !== floor) return false
    return x >= p.x && x < p.x + (p.w ?? 1) && y >= p.y && y < p.y + (p.h ?? 1)
  })
}

function pushUndo(state: RecodeSelectionState): Snapshot[] {
  const next = [...state.undo, { selected: new Set(state.selected) }]
  return next.length > UNDO_LIMIT ? next.slice(next.length - UNDO_LIMIT) : next
}

/** Add or remove `ids` per the armed mode, returning null when nothing moved — so a
 *  brush dragged back over cells it already covered does not churn state. */
function applyIds(
  selected: Set<number>,
  ids: readonly number[],
  mode: 'add' | 'erase',
): Set<number> | null {
  let changed = false
  const next = new Set(selected)
  for (const id of ids) {
    if (mode === 'add') {
      if (!next.has(id)) { next.add(id); changed = true }
    } else if (next.delete(id)) {
      changed = true
    }
  }
  return changed ? next : null
}

export function recodeSelectionReducer(
  state: RecodeSelectionState,
  action: RecodeSelectionAction,
): RecodeSelectionState {
  switch (action.type) {
    // Opens armed with the SITE's convention where there is one, so the operator's
    // first sweep and their tenth start from the same place.
    case 'begin':
      return {
        ...initialRecodeSelection,
        active: true,
        origin: action.origin ?? initialRecodeSelection.origin,
        order: action.order ?? initialRecodeSelection.order,
        template: action.template ?? null,
      }

    case 'cancel':
      return initialRecodeSelection

    // The sweep landed. Hold the success state rather than dropping straight back to
    // the map: it carries the label hand-off and the revert, both of which are only
    // reachable from here.
    case 'applied':
      return {
        ...state,
        step: 'done',
        rect: null,
        selected: new Set(),
        undo: [],
        startAt: null,
        renumberBlock: false,
      }

    case 'goto_step':
      return { ...state, step: action.step }

    case 'set_tool':
      return { ...state, tool: action.tool, rect: null }

    case 'set_mode':
      return { ...state, mode: action.mode }

    case 'stroke_start':
      if (!state.active) return state
      return { ...state, undo: pushUndo(state) }

    case 'select_cell': {
      if (!state.active) return state
      const next = applyIds(
        state.selected,
        action.resolve(action.floor, action.x, action.y),
        action.erase === true ? 'erase' : state.mode,
      )
      return next ? { ...state, selected: next } : state
    }

    case 'drag_start':
      if (!state.active) return state
      return {
        ...state,
        additive: action.additive,
        rect: { floor: action.floor, x0: action.x, y0: action.y, x1: action.x, y1: action.y },
      }

    case 'drag_move': {
      if (!state.rect) return state
      if (state.rect.x1 === action.x && state.rect.y1 === action.y) return state
      return { ...state, rect: { ...state.rect, x1: action.x, y1: action.y } }
    }

    // A band is one stroke, so it takes one undo frame — pushed here rather than at
    // drag_start, because a click that turns out not to be a drag should not leave
    // an undo frame behind.
    //
    // A band ACCUMULATES, exactly like a brush stroke, and never replaces. The old
    // marquee replaced because it was the only gesture there was; now that strokes
    // and bands mix freely in one selection, a band that silently discarded ten
    // hand-painted bins would be the worst kind of surprise. Erase mode subtracts.
    case 'drag_end': {
      if (!state.rect) return state
      const next = applyIds(
        state.selected,
        action.resolve(state.rect),
        action.erase === true ? 'erase' : state.mode,
      )
      return {
        ...state,
        rect: null,
        additive: false,
        undo: next ? pushUndo(state) : state.undo,
        selected: next ?? state.selected,
      }
    }

    /** Bulk selection from something other than the map — an area, or a block in
     *  the census list. Replaces by default: "select this area" means that area. */
    case 'select_ids': {
      const next = action.replace === false
        ? applyIds(state.selected, action.ids, 'add')
        : new Set(action.ids)
      if (!next) return state
      return { ...state, undo: pushUndo(state), selected: next }
    }

    case 'clear_selection':
      if (state.selected.size === 0 && !state.rect) return state
      return { ...state, undo: pushUndo(state), selected: new Set(), rect: null }

    case 'undo': {
      if (state.undo.length === 0) return state
      const prev = state.undo[state.undo.length - 1]
      return { ...state, selected: new Set(prev.selected), undo: state.undo.slice(0, -1) }
    }

    // Sanitized per keystroke so the operator sees the block they will actually get.
    // The server sanitizes again and refuses anything that does not round trip —
    // this is the courtesy, not the guard.
    case 'set_block':
      return { ...state, block: sanitizeBlockInput(action.block) }

    case 'set_template':
      return { ...state, template: action.template }

    case 'set_advanced':
      return { ...state, advanced: action.advanced }

    case 'set_origin':
      return { ...state, origin: action.origin }

    case 'set_order':
      return { ...state, order: action.order }

    case 'set_start':
      return { ...state, startAt: action.startAt }

    case 'set_renumber_block':
      return { ...state, renumberBlock: action.renumberBlock }

    default:
      return state
  }
}

export interface RecodeSelection {
  state: RecodeSelectionState
  dispatch: (action: RecodeSelectionAction) => void
}

export function useRecodeSelection(): RecodeSelection {
  const [state, dispatch] = useReducer(recodeSelectionReducer, initialRecodeSelection)
  return { state, dispatch }
}
