// Selection for a code sweep (migs 00107 / 00108).
//
// Two properties here are load-bearing and neither is obvious from the code:
//
//   1. CONTAIN, NOT INTERSECT. The rectangle used to take any placement it merely
//      touched, and a rack is w×h cells — so a band drawn round the bulk block in
//      the middle of Amadiya's floor swallowed the neighbouring fast-mover racks and
//      there was no shape the operator could draw that avoided it. That was the
//      reported bug and this is where it is pinned.
//   2. THE RESOLVER-IN-ACTION. The caller originally computed the hit list from
//      `state.rect` read out of its own render closure, and a drag fast enough that
//      React had not re-rendered between pointerdown and pointerup saw `rect: null`
//      — the band selected nothing, silently, with no error anywhere. Found in a
//      real browser; no unit test would have caught it, so the shape that prevents
//      it is pinned instead.

import { describe, it, expect } from 'vitest'
import {
  initialRecodeSelection,
  normalizeRect,
  placementsAtCell,
  placementsInRect,
  recodeSelectionReducer,
  type MarqueeRect,
  type RecodeSelectionState,
} from '@/components/inventory/warehouse/recode/useRecodeSelection'

const active: RecodeSelectionState = { ...initialRecodeSelection, active: true }
const rect = (x0: number, y0: number, x1: number, y1: number, floor = 0): MarqueeRect =>
  ({ floor, x0, y0, x1, y1 })

/** A placement as the layout stores one. */
const p = (locationId: number, x: number, y: number, w = 1, h = 1, floor = 0) =>
  ({ locationId, x, y, w, h, floor }) as any

const ids = (list: Array<{ locationId: number }>) => list.map((q) => q.locationId)

describe('normalizeRect', () => {
  it.each([
    ['top-left to bottom-right', rect(2, 3, 6, 7)],
    ['bottom-right to top-left', rect(6, 7, 2, 3)],
    ['top-right to bottom-left', rect(6, 3, 2, 7)],
    ['bottom-left to top-right', rect(2, 7, 6, 3)],
  ])('normalises a drag %s', (_label, r) => {
    expect(normalizeRect(r)).toEqual({ floor: 0, x0: 2, y0: 3, x1: 6, y1: 7 })
  })
})

describe('placementsInRect', () => {
  it('takes a placement fully inside the band', () => {
    expect(ids(placementsInRect([p(1, 3, 3)], rect(2, 2, 5, 5)))).toEqual([1])
  })

  // THE FIX. MAIN's bays are two cells wide, so a band that clips one cell of a
  // neighbouring rack used to take the whole rack.
  it('LEAVES a 2-cell rack the band only half covers', () => {
    expect(placementsInRect([p(1, 5, 3, 2, 1)], rect(2, 2, 5, 5))).toEqual([])
  })

  it('still takes that rack under the intersect mode, which is kept for other uses', () => {
    expect(ids(placementsInRect([p(1, 5, 3, 2, 1)], rect(2, 2, 5, 5), 'intersect'))).toEqual([1])
  })

  it('takes a 2-cell rack the band fully covers', () => {
    expect(ids(placementsInRect([p(1, 3, 3, 2, 1)], rect(2, 2, 5, 5)))).toEqual([1])
  })

  it('leaves a placement outside the band', () => {
    expect(placementsInRect([p(1, 6, 3)], rect(2, 2, 5, 5))).toEqual([])
  })

  it('ignores another floor', () => {
    expect(placementsInRect([p(1, 3, 3, 1, 1, 1)], rect(2, 2, 5, 5, 0))).toEqual([])
  })

  it('accepts a band dragged in any direction', () => {
    expect(ids(placementsInRect([p(1, 3, 3)], rect(5, 5, 2, 2)))).toEqual([1])
  })
})

describe('placementsAtCell', () => {
  // The brush's hit test is the mirror image: touching ANY cell of a rack takes the
  // whole rack, because a rack is one unit to a sweep.
  it('takes a multi-cell rack from any one of its cells', () => {
    const rack = p(1, 4, 4, 3, 2)
    expect(ids(placementsAtCell([rack], 0, 4, 4))).toEqual([1])
    expect(ids(placementsAtCell([rack], 0, 6, 5))).toEqual([1])
  })

  it('takes nothing just past the far edge', () => {
    expect(placementsAtCell([p(1, 4, 4, 3, 2)], 0, 7, 4)).toEqual([])
    expect(placementsAtCell([p(1, 4, 4, 3, 2)], 0, 4, 6)).toEqual([])
  })

  it('ignores another floor', () => {
    expect(placementsAtCell([p(1, 4, 4, 1, 1, 1)], 0, 4, 4)).toEqual([])
  })
})

describe('recodeSelectionReducer', () => {
  it('refuses to start a drag when recode mode is off', () => {
    const s = recodeSelectionReducer(initialRecodeSelection, {
      type: 'drag_start', floor: 0, x: 1, y: 1, additive: false,
    })
    expect(s.rect).toBeNull()
  })

  // THE regression test. The reducer must resolve against the rect it is holding,
  // not one the caller read from a possibly-stale render.
  it('resolves hits against its own rect, even when every event lands in one batch', () => {
    let s = active
    s = recodeSelectionReducer(s, { type: 'drag_start', floor: 0, x: 2, y: 2, additive: false })
    s = recodeSelectionReducer(s, { type: 'drag_move', x: 6, y: 6 })
    s = recodeSelectionReducer(s, {
      type: 'drag_end',
      resolve: (r) => {
        // The resolver sees the FINAL band, not the 1-cell one drag_start made.
        expect(normalizeRect(r)).toEqual({ floor: 0, x0: 2, y0: 2, x1: 6, y1: 6 })
        return [11, 12]
      },
    })
    expect([...s.selected]).toEqual([11, 12])
    expect(s.rect).toBeNull()
  })

  // A band now ACCUMULATES rather than replacing. Strokes and bands mix in one
  // selection, so a band that silently discarded ten hand-painted bins would be the
  // worst kind of surprise.
  it('adds to the selection on a plain drag rather than replacing it', () => {
    let s: RecodeSelectionState = { ...active, selected: new Set([99]) }
    s = recodeSelectionReducer(s, { type: 'drag_start', floor: 0, x: 0, y: 0, additive: false })
    s = recodeSelectionReducer(s, { type: 'drag_end', resolve: () => [1, 2] })
    expect([...s.selected].sort((a, b) => a - b)).toEqual([1, 2, 99])
  })

  it('subtracts a band in erase mode', () => {
    let s: RecodeSelectionState = { ...active, mode: 'erase', selected: new Set([1, 2, 3]) }
    s = recodeSelectionReducer(s, { type: 'drag_start', floor: 0, x: 0, y: 0, additive: false })
    s = recodeSelectionReducer(s, { type: 'drag_end', resolve: () => [2] })
    expect([...s.selected].sort((a, b) => a - b)).toEqual([1, 3])
  })

  it('ignores a drag_end with no band', () => {
    expect(recodeSelectionReducer(active, { type: 'drag_end', resolve: () => [1] })).toBe(active)
  })

  // ── the brush ──
  it('adds the units under a painted cell', () => {
    const s = recodeSelectionReducer(active, {
      type: 'select_cell', floor: 0, x: 4, y: 4, resolve: () => [7],
    })
    expect([...s.selected]).toEqual([7])
  })

  it('removes them in erase mode', () => {
    const s = recodeSelectionReducer(
      { ...active, mode: 'erase', selected: new Set([7, 8]) },
      { type: 'select_cell', floor: 0, x: 4, y: 4, resolve: () => [7] },
    )
    expect([...s.selected]).toEqual([8])
  })

  // A brush dragged back over cells it already covered must not churn state — every
  // one of those would be a re-render, and the map redraws its ghost numbers on each.
  it('returns the identical state when a stroke changes nothing', () => {
    const s: RecodeSelectionState = { ...active, selected: new Set([7]) }
    expect(recodeSelectionReducer(s, {
      type: 'select_cell', floor: 0, x: 4, y: 4, resolve: () => [7],
    })).toBe(s)
  })

  // ── undo ──
  it('takes ONE undo frame for a whole stroke, however many cells it covers', () => {
    let s = recodeSelectionReducer(active, { type: 'stroke_start' })
    for (let i = 0; i < 12; i += 1) {
      s = recodeSelectionReducer(s, {
        type: 'select_cell', floor: 0, x: i, y: 0, resolve: () => [i + 1],
      })
    }
    expect(s.selected.size).toBe(12)
    expect(s.undo).toHaveLength(1)
    s = recodeSelectionReducer(s, { type: 'undo' })
    expect(s.selected.size).toBe(0)
  })

  it('undoes back through several strokes', () => {
    let s = active
    for (const id of [1, 2, 3]) {
      s = recodeSelectionReducer(s, { type: 'stroke_start' })
      s = recodeSelectionReducer(s, {
        type: 'select_cell', floor: 0, x: id, y: 0, resolve: () => [id],
      })
    }
    s = recodeSelectionReducer(s, { type: 'undo' })
    expect([...s.selected].sort((a, b) => a - b)).toEqual([1, 2])
  })

  it('ignores undo with nothing to undo', () => {
    expect(recodeSelectionReducer(active, { type: 'undo' })).toBe(active)
  })

  it('makes Clear undoable, since it can be a mis-click on a big selection', () => {
    let s: RecodeSelectionState = { ...active, selected: new Set([1, 2, 3]) }
    s = recodeSelectionReducer(s, { type: 'clear_selection' })
    expect(s.selected.size).toBe(0)
    s = recodeSelectionReducer(s, { type: 'undo' })
    expect([...s.selected].sort((a, b) => a - b)).toEqual([1, 2, 3])
  })

  // ── bulk selection ──
  it('replaces the selection when selecting an area or a block', () => {
    const s = recodeSelectionReducer(
      { ...active, selected: new Set([9]) },
      { type: 'select_ids', ids: [1, 2] },
    )
    expect([...s.selected].sort((a, b) => a - b)).toEqual([1, 2])
  })

  it('can add instead, for extending a selection', () => {
    const s = recodeSelectionReducer(
      { ...active, selected: new Set([9]) },
      { type: 'select_ids', ids: [1], replace: false },
    )
    expect([...s.selected].sort((a, b) => a - b)).toEqual([1, 9])
  })

  // ── form ──
  it('sanitizes the block per keystroke', () => {
    expect(recodeSelectionReducer(active, { type: 'set_block', block: 'cold a' }).block).toBe('COLD-A')
    // A trailing separator survives, so the operator can type through it.
    expect(recodeSelectionReducer(active, { type: 'set_block', block: 'cold-' }).block).toBe('COLD-')
  })

  it('opens armed with the site default where there is one', () => {
    const s = recodeSelectionReducer(initialRecodeSelection, {
      type: 'begin', origin: 'se', order: 'serpentine-row', template: '{block}-{n:03}',
    })
    expect(s.origin).toBe('se')
    expect(s.order).toBe('serpentine-row')
    expect(s.template).toBe('{block}-{n:03}')
    expect(s.active).toBe(true)
  })

  // The success state carries the label hand-off and the revert, so it must be held
  // rather than dropping straight back to the map.
  it('holds a done step after applying, keeping the block for the next aisle', () => {
    let s: RecodeSelectionState = {
      ...active, block: 'COLD-A', selected: new Set([1, 2]), startAt: 4, renumberBlock: true,
    }
    s = recodeSelectionReducer(s, { type: 'applied' })
    expect(s.step).toBe('done')
    expect(s.selected.size).toBe(0)
    expect(s.block).toBe('COLD-A')
    expect(s.active).toBe(true)
    expect(s.startAt).toBeNull()
    // Renumbering is a deliberate per-sweep answer to a refusal, never sticky.
    expect(s.renumberBlock).toBe(false)
  })

  it('cancel returns to the initial state', () => {
    const s: RecodeSelectionState = { ...active, block: 'X', selected: new Set([1]) }
    expect(recodeSelectionReducer(s, { type: 'cancel' })).toEqual(initialRecodeSelection)
  })
})
