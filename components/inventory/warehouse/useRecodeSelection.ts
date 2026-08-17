// Marquee selection for a code sweep (mig 00107).
//
// A pure reducer plus a thin `use*` wrapper, mirroring useAreaPaintState — no I/O,
// no queries, unit-testable on its own. What it owns is the rubber band and the
// committed selection; what it deliberately does NOT own is anything about codes.
// The planning is the server's `dry_run`, evaluated from the same pure module the
// summary modal renders (lib/codePattern.ts), so there is no second answer here to
// get wrong.
//
// The rect is stored in GRID CELLS, not pixels. MapStage derives the cell (it owns
// the viewport; WarehouseCanvas's scene memo deliberately excludes viewport.tx/ty
// so a pan stays one <g transform> update), and everything downstream — hit
// testing, the highlight set, the band's own geometry — works in the same units the
// placements do.

import { useReducer } from 'react'
import type { LayoutPlacement } from '@/types'
import { BUILTIN_PATTERN, sanitizeBlockInput, type CodeOrder } from '@/lib/codePattern'

export interface MarqueeRect {
  floor: number
  x0: number
  y0: number
  x1: number
  y1: number
}

export interface RecodeSelectionState {
  active: boolean
  /** The band currently being dragged. Null between drags. */
  rect: MarqueeRect | null
  /** Committed unit ids. A plain drag REPLACES; Shift+drag unions. */
  selected: Set<number>
  /** True while the in-flight drag should add to `selected` rather than replace it. */
  additive: boolean
  block: string
  /** Null = let the server continue past the block's high-water mark. */
  startAt: number | null
  order: CodeOrder
  templateOverride: string | null
}

export type RecodeSelectionAction =
  | { type: 'begin' }
  | { type: 'cancel' }
  | { type: 'applied' }
  | { type: 'drag_start'; floor: number; x: number; y: number; additive: boolean }
  | { type: 'drag_move'; x: number; y: number }
  // Carries a RESOLVER, not a precomputed list, and that is load-bearing rather
  // than stylistic. A caller computing `hits` from `state.rect` reads the rect out
  // of its own render closure, and a drag fast enough that React has not
  // re-rendered between pointerdown and pointerup sees `rect: null` — the whole
  // band selects nothing, silently. Resolving inside the reducer means the rect is
  // always the one the reducer itself is holding. (`resolve` is a pure selector,
  // so the reducer stays pure.)
  | { type: 'drag_end'; resolve: (rect: MarqueeRect) => number[] }
  | { type: 'clear_selection' }
  | { type: 'set_block'; block: string }
  | { type: 'set_start'; startAt: number | null }
  | { type: 'set_order'; order: CodeOrder }
  | { type: 'set_template'; template: string | null }

export const initialRecodeSelection: RecodeSelectionState = {
  active: false,
  rect: null,
  selected: new Set<number>(),
  additive: false,
  block: '',
  startAt: null,
  order: BUILTIN_PATTERN.order,
  templateOverride: null,
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
 * Which placements the band touches.
 *
 * INTERSECT, not contain. MAIN's bays are two cells wide, so under `contain` a rack
 * straddling the band's edge is invisible — the operator dragged over half of it
 * and nothing happened, which reads as a broken tool. Intersect over-selects at the
 * boundary, but that is visible in the highlight and correctable; under-selection
 * is silent.
 *
 * (`areaForRect`'s majority-of-cells vote is the opposite choice for a different
 * question. "Which single area owns this rack" needs a total function returning one
 * answer; "is this rack in my selection" is a boolean the operator can see.)
 */
export function placementsInRect(
  placements: readonly LayoutPlacement[],
  rect: MarqueeRect,
): LayoutPlacement[] {
  const r = normalizeRect(rect)
  return placements.filter((p) => {
    if ((p.floor ?? 0) !== r.floor) return false
    const px1 = p.x + (p.w ?? 1) - 1
    const py1 = p.y + (p.h ?? 1) - 1
    return p.x <= r.x1 && px1 >= r.x0 && p.y <= r.y1 && py1 >= r.y0
  })
}

export function recodeSelectionReducer(
  state: RecodeSelectionState,
  action: RecodeSelectionAction,
): RecodeSelectionState {
  switch (action.type) {
    case 'begin':
      return { ...initialRecodeSelection, active: true }

    case 'cancel':
      return initialRecodeSelection

    // The sweep landed. Stay in recode mode — an operator doing one aisle is
    // usually about to do the next — but drop the selection, because those units
    // now carry the codes they were just given and re-sweeping them is a no-op the
    // operator did not ask for. The block is kept: the next aisle is normally
    // COLD-B, one keystroke away from COLD-A.
    case 'applied':
      return { ...state, rect: null, selected: new Set(), startAt: null }

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

    case 'drag_end': {
      if (!state.rect) return state
      const next = state.additive ? new Set(state.selected) : new Set<number>()
      for (const id of action.resolve(state.rect)) next.add(id)
      return { ...state, rect: null, additive: false, selected: next }
    }

    case 'clear_selection':
      return { ...state, selected: new Set(), rect: null }

    // Sanitized per keystroke so the operator sees the block they will actually
    // get. The server sanitizes again and refuses anything that does not round
    // trip — this is the courtesy, not the guard.
    case 'set_block':
      return { ...state, block: sanitizeBlockInput(action.block) }

    case 'set_start':
      return { ...state, startAt: action.startAt }

    case 'set_order':
      return { ...state, order: action.order }

    case 'set_template':
      return { ...state, templateOverride: action.template }

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
