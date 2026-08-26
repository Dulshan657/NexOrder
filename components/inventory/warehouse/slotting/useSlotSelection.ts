// Selection and form state for building a slotting block on the live map (00115).
//
// A pure reducer plus a thin `use*` wrapper, mirroring useRecodeSelection and
// useAreaPaintState — no I/O, no queries, unit-testable on its own.
//
// WHY THIS IS A SECOND REDUCER RATHER THAN A SHARED BASE, stated plainly because
// the duplication is real: the hard, subtle part of a map selection is the
// GEOMETRY — contain-vs-intersect hit testing, resolving a fast drag against the
// reducer's own rect rather than a stale prop, what counts as a "unit" when a
// rack's levels are separate rows. All of that is shared, by importing
// recodeGeometry.ts rather than forking it. What is duplicated here is the
// mechanical plumbing around it. Extracting a shared selection reducer would mean
// refactoring useRecodeSelection, which shipped days ago and is what the code
// sweep runs on; destabilising a live feature to de-duplicate boilerplate is the
// worse trade. If a third map selection ever appears, extract then — three is
// when a pattern is real.
//
// The rect is stored in GRID CELLS, not pixels, for the same reason it is there:
// MapStage owns the viewport and derives the cell, so everything downstream works
// in the units placements already use.

import { useReducer } from 'react'

export interface MarqueeRect {
  floor: number
  x0: number
  y0: number
  x1: number
  y1: number
}

/** Which brush is armed. `rect` drags a band; `paint` walks cells. */
export type SlotTool = 'paint' | 'rect'

/** The stepped panel's position. `'done'` is the post-apply success state, which
 *  is not step 4 — it replaces the body rather than continuing it. */
export type SlotStep = 1 | 2 | 3 | 'done'

/** One undo frame. Only the PICTURE is undoable: Ctrl+Z after mis-painting must
 *  not also silently retype the block name. */
interface Snapshot {
  selected: Set<number>
}

/** 30, like useRecodeSelection and useAreaPaintState. A stroke is one frame. */
const UNDO_LIMIT = 30

export interface SlotSelectionState extends Snapshot {
  active: boolean
  step: SlotStep
  tool: SlotTool
  /** Whether a stroke adds units or removes them. */
  mode: 'add' | 'erase'
  undo: Snapshot[]
  /** The band currently being dragged. Null between drags. */
  rect: MarqueeRect | null
  /** True while the in-flight band should add to `selected` rather than replace. */
  additive: boolean
  /** The block being built. Null id = a new block; a number = editing one. */
  blockId: number | null
  blockName: string
  /** Attach the block to a rule as part of this flow. `''` = don't. */
  attachRuleId: string
  /** Or create one, with a single brand axis — the overwhelmingly common case.
   *  Anything richer (several axes, hard enforcement, reservation) is the
   *  settings table's job, and this deliberately does not duplicate it. */
  newRuleName: string
  newRuleBrand: string
  /** Result of the last apply, so `'done'` can report it. */
  savedBlockId: number | null
}

export type SlotSelectionAction =
  | { type: 'begin'; blockId?: number; blockName?: string; selected?: number[] }
  | { type: 'cancel' }
  | { type: 'applied'; blockId: number }
  | { type: 'goto_step'; step: SlotStep }
  | { type: 'set_tool'; tool: SlotTool }
  | { type: 'set_mode'; mode: 'add' | 'erase' }
  | { type: 'stroke_start' }
  | {
      type: 'select_cell'
      floor: number
      x: number
      y: number
      erase?: boolean
      resolve: (floor: number, x: number, y: number) => number[]
    }
  | { type: 'drag_start'; floor: number; x: number; y: number; additive: boolean }
  | { type: 'drag_move'; x: number; y: number }
  | { type: 'drag_end'; erase?: boolean; resolve: (rect: MarqueeRect) => number[] }
  | { type: 'select_ids'; ids: number[]; replace?: boolean }
  | { type: 'clear_selection' }
  | { type: 'undo' }
  | { type: 'set_block_name'; name: string }
  | { type: 'set_attach_rule'; ruleId: string }
  | { type: 'set_new_rule_name'; name: string }
  | { type: 'set_new_rule_brand'; brand: string }

export const initialSlotSelection: SlotSelectionState = {
  active: false,
  step: 1,
  tool: 'paint',
  mode: 'add',
  selected: new Set(),
  undo: [],
  rect: null,
  additive: false,
  blockId: null,
  blockName: '',
  attachRuleId: '',
  newRuleName: '',
  newRuleBrand: '',
  savedBlockId: null,
}

function pushUndo(state: SlotSelectionState): Snapshot[] {
  const next = [...state.undo, { selected: new Set(state.selected) }]
  return next.length > UNDO_LIMIT ? next.slice(next.length - UNDO_LIMIT) : next
}

function applyIds(
  selected: Set<number>,
  ids: readonly number[],
  erase: boolean,
): Set<number> {
  const next = new Set(selected)
  for (const id of ids) {
    if (erase) next.delete(id)
    else next.add(id)
  }
  return next
}

export function slotSelectionReducer(
  state: SlotSelectionState,
  action: SlotSelectionAction,
): SlotSelectionState {
  switch (action.type) {
    case 'begin':
      return {
        ...initialSlotSelection,
        active: true,
        blockId: action.blockId ?? null,
        blockName: action.blockName ?? '',
        selected: new Set(action.selected ?? []),
      }

    case 'cancel':
      return initialSlotSelection

    case 'applied':
      return { ...state, step: 'done', savedBlockId: action.blockId }

    case 'goto_step':
      return { ...state, step: action.step }

    case 'set_tool':
      return { ...state, tool: action.tool, rect: null }

    case 'set_mode':
      return { ...state, mode: action.mode }

    // One undo frame per STROKE, not per cell — otherwise Ctrl+Z after painting
    // forty bins would need forty presses.
    case 'stroke_start':
      return { ...state, undo: pushUndo(state) }

    case 'select_cell': {
      const ids = action.resolve(action.floor, action.x, action.y)
      if (ids.length === 0) return state
      const erase = action.erase ?? state.mode === 'erase'
      return { ...state, selected: applyIds(state.selected, ids, erase) }
    }

    case 'drag_start':
      return {
        ...state,
        undo: pushUndo(state),
        additive: action.additive,
        rect: { floor: action.floor, x0: action.x, y0: action.y, x1: action.x, y1: action.y },
      }

    case 'drag_move':
      if (!state.rect) return state
      return { ...state, rect: { ...state.rect, x1: action.x, y1: action.y } }

    case 'drag_end': {
      if (!state.rect) return state
      // Resolved against the reducer's OWN rect, never a rect passed in from a
      // render — a fast drag has not re-rendered the prop yet and the band would
      // select nothing. Found in a browser on the recode sweep; no test saw it.
      const ids = action.resolve(state.rect)
      const erase = action.erase ?? state.mode === 'erase'
      const base = state.additive || erase ? state.selected : new Set<number>()
      return { ...state, rect: null, additive: false, selected: applyIds(base, ids, erase) }
    }

    case 'select_ids':
      return {
        ...state,
        undo: pushUndo(state),
        selected: action.replace
          ? new Set(action.ids)
          : applyIds(state.selected, action.ids, false),
      }

    case 'clear_selection':
      return { ...state, undo: pushUndo(state), selected: new Set() }

    case 'undo': {
      if (state.undo.length === 0) return state
      const last = state.undo[state.undo.length - 1]
      return { ...state, selected: new Set(last.selected), undo: state.undo.slice(0, -1) }
    }

    case 'set_block_name':
      return { ...state, blockName: action.name }

    // Attaching to an existing rule and creating one are mutually exclusive, so
    // picking either clears the other rather than leaving both half-filled for
    // the Apply step to arbitrate.
    case 'set_attach_rule':
      return {
        ...state,
        attachRuleId: action.ruleId,
        newRuleName: action.ruleId ? '' : state.newRuleName,
        newRuleBrand: action.ruleId ? '' : state.newRuleBrand,
      }

    case 'set_new_rule_name':
      return { ...state, newRuleName: action.name, attachRuleId: '' }

    case 'set_new_rule_brand':
      return { ...state, newRuleBrand: action.brand, attachRuleId: '' }

    default:
      return state
  }
}

export function useSlotSelection() {
  const [state, dispatch] = useReducer(slotSelectionReducer, initialSlotSelection)
  return { state, dispatch }
}
