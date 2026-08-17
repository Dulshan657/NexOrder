// Marquee selection for a code sweep (mig 00107).
//
// The reducer test that matters is `drag_end`, and it exists because of a bug a
// real browser found and no unit test would have: the caller originally computed
// the hit list from `state.rect` read out of its own render closure, and a drag
// fast enough that React had not re-rendered between pointerdown and pointerup saw
// `rect: null` — the band selected nothing, silently, with no error anywhere.
// Passing a RESOLVER means the rect is always the one the reducer is holding.

import { describe, it, expect } from 'vitest'
import {
  initialRecodeSelection,
  normalizeRect,
  placementsInRect,
  recodeSelectionReducer,
  type MarqueeRect,
  type RecodeSelectionState,
} from '@/components/inventory/warehouse/useRecodeSelection'

const active: RecodeSelectionState = { ...initialRecodeSelection, active: true }
const rect = (x0: number, y0: number, x1: number, y1: number, floor = 0): MarqueeRect =>
  ({ floor, x0, y0, x1, y1 })

/** A placement as the layout stores one. */
const p = (locationId: number, x: number, y: number, w = 1, h = 1, floor = 0) =>
  ({ locationId, x, y, w, h, floor }) as any

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
    expect(placementsInRect([p(1, 3, 3)], rect(2, 2, 5, 5)).map((q) => q.locationId)).toEqual([1])
  })

  // MAIN's bays are two cells wide. Under `contain`, a rack straddling the edge is
  // invisible — the operator drags over half of it and nothing happens.
  it('takes a 2-cell rack the band only half covers', () => {
    expect(placementsInRect([p(1, 5, 3, 2, 1)], rect(2, 2, 5, 5)).map((q) => q.locationId)).toEqual([1])
  })

  it('leaves a placement that only touches beyond the edge', () => {
    expect(placementsInRect([p(1, 6, 3)], rect(2, 2, 5, 5))).toEqual([])
  })

  it('ignores another floor', () => {
    expect(placementsInRect([p(1, 3, 3, 1, 1, 1)], rect(2, 2, 5, 5, 0))).toEqual([])
  })

  it('accepts a band dragged in any direction', () => {
    expect(placementsInRect([p(1, 3, 3)], rect(5, 5, 2, 2)).map((q) => q.locationId)).toEqual([1])
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

  it('replaces the selection on a plain drag', () => {
    let s: RecodeSelectionState = { ...active, selected: new Set([99]) }
    s = recodeSelectionReducer(s, { type: 'drag_start', floor: 0, x: 0, y: 0, additive: false })
    s = recodeSelectionReducer(s, { type: 'drag_end', resolve: () => [1, 2] })
    expect([...s.selected]).toEqual([1, 2])
  })

  it('unions on a shift-drag', () => {
    let s: RecodeSelectionState = { ...active, selected: new Set([99]) }
    s = recodeSelectionReducer(s, { type: 'drag_start', floor: 0, x: 0, y: 0, additive: true })
    s = recodeSelectionReducer(s, { type: 'drag_end', resolve: () => [1, 2] })
    expect([...s.selected].sort((a, b) => a - b)).toEqual([1, 2, 99])
  })

  it('clears the additive flag after the drag it belonged to', () => {
    let s = recodeSelectionReducer(active, { type: 'drag_start', floor: 0, x: 0, y: 0, additive: true })
    s = recodeSelectionReducer(s, { type: 'drag_end', resolve: () => [1] })
    expect(s.additive).toBe(false)
  })

  it('ignores a drag_end with no band', () => {
    expect(recodeSelectionReducer(active, { type: 'drag_end', resolve: () => [1] })).toBe(active)
  })

  it('sanitizes the block per keystroke', () => {
    expect(recodeSelectionReducer(active, { type: 'set_block', block: 'cold a' }).block).toBe('COLD-A')
    // A trailing separator survives, so the operator can type through it.
    expect(recodeSelectionReducer(active, { type: 'set_block', block: 'cold-' }).block).toBe('COLD-')
  })

  // After a sweep lands, those units carry the codes they were just given, so
  // re-sweeping them is a no-op nobody asked for. The BLOCK stays — the next aisle
  // is usually one keystroke away.
  it('drops the selection but keeps the block once applied', () => {
    let s: RecodeSelectionState = { ...active, block: 'COLD-A', selected: new Set([1, 2]), startAt: 4 }
    s = recodeSelectionReducer(s, { type: 'applied' })
    expect(s.selected.size).toBe(0)
    expect(s.block).toBe('COLD-A')
    expect(s.active).toBe(true)
    expect(s.startAt).toBeNull()
  })

  it('cancel returns to the initial state', () => {
    const s: RecodeSelectionState = { ...active, block: 'X', selected: new Set([1]) }
    expect(recodeSelectionReducer(s, { type: 'cancel' })).toEqual(initialRecodeSelection)
  })
})
