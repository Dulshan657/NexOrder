import { describe, it, expect } from 'vitest'
import {
  areaPaintReducer,
  areaNamesInPaintState,
  signNamesInPaintState,
  specsFromPaintState,
  signSpecsFromPaintState,
  cellKey,
  type AreaPaintAction,
  type AreaPaintState,
} from '@/components/inventory/warehouse/useAreaPaintState'
import { areaSpecsFromObjects, areaCellsFingerprint } from '@/lib/areaPaint'
import { signSpecsFromObjects } from '@/lib/signPaint'
import type { LayoutObject } from '@/types'

// The live map's working state. `tsc` is nearly blind in components here (no
// @types/react, strict off), so this file is the real guard on the reducer — and
// on the invariant the whole two-surface design rests on: the map's working set
// and the designer's editor state must fold to the SAME payload.

// ── helpers ─────────────────────────────────────────────────────────────────

let nextId = 1
function obj(name: string, x: number, y: number, floor = 0, zoneProfileId: number | null = null): LayoutObject {
  return {
    id: nextId++, layoutId: 1, objectType: 'area' as LayoutObject['objectType'],
    floor, x, y, w: 1, h: 1, meta: { name, zoneProfileId },
  }
}

function wall(x: number, y: number): LayoutObject {
  return {
    id: nextId++, layoutId: 1, objectType: 'wall' as LayoutObject['objectType'],
    floor: 0, x, y, w: 1, h: 1, meta: {},
  }
}

function row(name: string, x0: number, count: number, floor = 0, zp: number | null = null): LayoutObject[] {
  return Array.from({ length: count }, (_, i) => obj(name, x0 + i, 0, floor, zp))
}

const reduce = (state: AreaPaintState, ...actions: AreaPaintAction[]): AreaPaintState =>
  actions.reduce(areaPaintReducer, state)

const START: AreaPaintState = {
  active: false, brush: { name: '', zoneProfileId: null }, mode: 'paint',
  signBrush: '', layer: 'area',
  cells: new Map(), profiles: new Map(), signCells: new Map(), undo: [], dirty: false,
}

const begun = (objects: LayoutObject[]) => areaPaintReducer(START, { type: 'begin', objects })

// ── hydration ───────────────────────────────────────────────────────────────

describe('areaPaintReducer — entering paint mode', () => {
  it('hydrates the working set from the map, ignoring non-area objects', () => {
    const state = begun([...row('Chiller', 0, 3), ...row('Bulk', 10, 2), wall(5, 5)])
    expect(state.active).toBe(true)
    expect(state.dirty).toBe(false)
    expect(state.cells.size).toBe(5)
    expect(areaNamesInPaintState(state)).toEqual(['Bulk', 'Chiller'])
    expect(state.cells.get(cellKey(0, 0, 0))).toBe('Chiller')
  })

  it('carries each area zone profile through', () => {
    const state = begun([...row('Chiller', 0, 2, 0, 4), ...row('Bulk', 10, 1)])
    expect(state.profiles.get('Chiller')).toBe(4)
    expect(state.profiles.get('Bulk')).toBeNull()
  })

  it('cancel returns to a clean, inactive state', () => {
    const state = reduce(begun(row('Chiller', 0, 3)), { type: 'cancel' })
    expect(state.active).toBe(false)
    expect(state.cells.size).toBe(0)
  })
})

// ── painting and erasing ────────────────────────────────────────────────────

describe('areaPaintReducer — painting', () => {
  it('paints the brush name and marks dirty', () => {
    const state = reduce(begun([]),
      { type: 'set_brush_name', name: 'Cold Room' },
      { type: 'paint_cell', floor: 0, x: 2, y: 3 },
    )
    expect(state.cells.get(cellKey(0, 2, 3))).toBe('Cold Room')
    expect(state.dirty).toBe(true)
  })

  it('refuses to paint with no brush name', () => {
    const state = reduce(begun([]), { type: 'paint_cell', floor: 0, x: 0, y: 0 })
    expect(state.cells.size).toBe(0)
    expect(state.dirty).toBe(false)
  })

  it('repainting the same cell with the same name is a no-op', () => {
    const first = reduce(begun([]),
      { type: 'set_brush_name', name: 'Chiller' },
      { type: 'paint_cell', floor: 0, x: 0, y: 0 },
    )
    expect(areaPaintReducer(first, { type: 'paint_cell', floor: 0, x: 0, y: 0 })).toBe(first)
  })

  it('extending an existing area keeps ITS profile, not the stale brush', () => {
    const state = reduce(begun(row('Chiller', 0, 2, 0, 4)),
      { type: 'set_brush_profile', zoneProfileId: 9 }, // brush only — name is blank
      { type: 'set_brush_name', name: 'Chiller' },
      { type: 'paint_cell', floor: 0, x: 5, y: 0 },
    )
    expect(state.cells.get(cellKey(0, 5, 0))).toBe('Chiller')
    expect(state.profiles.get('Chiller')).toBe(4)
  })

  it('erase removes whatever is under the cursor and prunes the dead profile', () => {
    const state = reduce(begun(row('Chiller', 0, 1, 0, 4)),
      { type: 'set_mode', mode: 'erase' },
      { type: 'paint_cell', floor: 0, x: 0, y: 0 },
    )
    expect(state.cells.size).toBe(0)
    expect(state.profiles.has('Chiller')).toBe(false)
    expect(state.dirty).toBe(true)
  })

  it('erase_area removes every cell of one area across floors, leaving others', () => {
    const state = reduce(
      begun([...row('Chiller', 0, 3), ...row('Chiller', 0, 2, 1), ...row('Bulk', 10, 2)]),
      { type: 'erase_area', name: 'Chiller' },
    )
    expect(areaNamesInPaintState(state)).toEqual(['Bulk'])
    expect(state.cells.size).toBe(2)
  })

  it('erase_area on a name that is not painted changes nothing', () => {
    const state = begun(row('Chiller', 0, 3))
    expect(areaPaintReducer(state, { type: 'erase_area', name: 'Nope' })).toBe(state)
  })
})

// ── re-tinting, which is a whole-area act ───────────────────────────────────

describe('areaPaintReducer — zone profiles', () => {
  it('re-tints an existing area without repainting a single cell', () => {
    const state = reduce(begun(row('Chiller', 0, 40, 0, 4)),
      { type: 'set_brush_name', name: 'Chiller' },
      { type: 'set_brush_profile', zoneProfileId: 7 },
    )
    expect(state.profiles.get('Chiller')).toBe(7)
    expect(state.cells.size).toBe(40)
    expect(state.dirty).toBe(true)
    expect(specsFromPaintState(state)[0].zoneProfileId).toBe(7)
  })

  it('clearing a profile is a real change, not a no-op', () => {
    const state = reduce(begun(row('Chiller', 0, 2, 0, 4)),
      { type: 'set_brush_name', name: 'Chiller' },
      { type: 'set_brush_profile', zoneProfileId: null },
    )
    expect(state.profiles.get('Chiller')).toBeNull()
    expect(state.dirty).toBe(true)
  })

  it('does not dirty the session when the brush names no existing area', () => {
    const state = reduce(begun(row('Chiller', 0, 2)),
      { type: 'set_brush_name', name: 'Brand New' },
      { type: 'set_brush_profile', zoneProfileId: 7 },
    )
    expect(state.dirty).toBe(false)
    expect(state.profiles.has('Brand New')).toBe(false)
  })
})

// ── undo ────────────────────────────────────────────────────────────────────

describe('areaPaintReducer — undo', () => {
  it('is per STROKE, so a ten-cell drag is one undo', () => {
    let state = reduce(begun([]),
      { type: 'set_brush_name', name: 'Chiller' },
      { type: 'stroke_start' },
    )
    for (let x = 0; x < 10; x++) state = areaPaintReducer(state, { type: 'paint_cell', floor: 0, x, y: 0 })
    expect(state.cells.size).toBe(10)

    state = areaPaintReducer(state, { type: 'undo' })
    expect(state.cells.size).toBe(0)
  })

  it('undoes an erase_area in one step', () => {
    const painted = begun(row('Chiller', 0, 5))
    const erased = areaPaintReducer(painted, { type: 'erase_area', name: 'Chiller' })
    const back = areaPaintReducer(erased, { type: 'undo' })
    expect(back.cells.size).toBe(5)
  })

  it('does nothing with an empty stack', () => {
    const state = begun(row('Chiller', 0, 2))
    expect(areaPaintReducer(state, { type: 'undo' })).toBe(state)
  })

  it('saved re-hydrates from the server answer and clears dirty and undo', () => {
    const dirty = reduce(begun([]),
      { type: 'set_brush_name', name: 'Chiller' },
      { type: 'stroke_start' },
      { type: 'paint_cell', floor: 0, x: 0, y: 0 },
    )
    const saved = areaPaintReducer(dirty, { type: 'saved', objects: row('Cold Room', 0, 2) })
    expect(saved.dirty).toBe(false)
    expect(saved.undo).toEqual([])
    expect(areaNamesInPaintState(saved)).toEqual(['Cold Room'])
  })
})

// ── multi-floor ─────────────────────────────────────────────────────────────

describe('areaPaintReducer — floors', () => {
  it('keeps cells and the undo stack when the operator switches floor', () => {
    // Nothing in the reducer is per-floor, and that is the point: pools are per
    // area NAME across floors, so a session that could only see one floor would
    // let an operator create a second "Chiller" without noticing.
    const state = reduce(begun([]),
      { type: 'set_brush_name', name: 'Chiller' },
      { type: 'stroke_start' },
      { type: 'paint_cell', floor: 0, x: 0, y: 0 },
      { type: 'stroke_start' },
      { type: 'paint_cell', floor: 1, x: 0, y: 0 },
    )
    expect(state.cells.size).toBe(2)
    expect(specsFromPaintState(state)).toHaveLength(1)
    expect(specsFromPaintState(state)[0].cells.map((c) => c.floor)).toEqual([0, 1])
  })
})

// ── the cross-surface invariant ─────────────────────────────────────────────

describe('specsFromPaintState — one payload, two surfaces', () => {
  it('folds to exactly what areaSpecsFromObjects produces from the same picture', () => {
    // This is what "two surfaces, one server path" actually means: the live map's
    // working set and the designer's object list must describe the same payload,
    // or the fingerprint check would reject a save from one of them.
    const objects = [...row('Chiller', 0, 4, 0, 4), ...row('Bulk', 10, 2), ...row('Chiller', 0, 3, 1, 4)]
    expect(specsFromPaintState(begun(objects))).toEqual(areaSpecsFromObjects(objects as any))
  })

  it('survives a paint round trip with the fingerprint intact', () => {
    const objects = row('Chiller', 0, 4, 0, 4)
    const state = begun(objects)
    const rebuilt = specsFromPaintState(state).flatMap((s) =>
      s.cells.map((c) => obj(s.name, c.x, c.y, c.floor, s.zoneProfileId)),
    )
    expect(areaCellsFingerprint(rebuilt as any)).toBe(areaCellsFingerprint(objects as any))
  })

  it('drops an emptied area entirely rather than sending it with no cells', () => {
    const state = reduce(begun(row('Chiller', 0, 2)), { type: 'erase_area', name: 'Chiller' })
    expect(specsFromPaintState(state)).toEqual([])
  })
})

// ── the sign layer (mig 00097) ──────────────────────────────────────────────

/** A stored sign row, as the map holds it. */
function sign(name: string, x: number, y = 0, floor = 0, w = 1): LayoutObject {
  return {
    id: nextId++, layoutId: 1, objectType: 'label' as LayoutObject['objectType'],
    floor, x, y, w, h: 1, meta: { name },
  }
}

describe('brush text accepts spaces', () => {
  // The bug this pins was found in a real browser and affected the AREA brush
  // too, which had shipped with it since 00095: the reducer sanitized per
  // keystroke, sanitize trims, so "Cold Storage" became "ColdStorage" and there
  // was no way to type the space at all.
  it('keeps a space the operator is typing through, on both layers', () => {
    let s = begun([])
    for (const chunk of ['C', 'o', 'l', 'd', ' ', 'S', 't', 'o', 'r', 'e']) {
      s = areaPaintReducer(s, { type: 'set_brush_name', name: s.brush.name + chunk })
    }
    expect(s.brush.name).toBe('Cold Store')

    let t = begun([])
    for (const chunk of ['I', 'n', ' ', 'L', 'a', 'n', 'e']) {
      t = areaPaintReducer(t, { type: 'set_sign_brush', name: t.signBrush + chunk })
    }
    expect(t.signBrush).toBe('In Lane')
  })

  it('still trims when the cell is written, so a trailing space never lands', () => {
    const s = reduce(begun([]),
      { type: 'set_brush_name', name: 'Chiller ' },
      { type: 'paint_cell', floor: 0, x: 1, y: 1 },
    )
    expect(areaNamesInPaintState(s)).toEqual(['Chiller'])
  })
})

describe('areaPaintReducer — the sign layer', () => {
  it('hydrates signs and areas into separate maps', () => {
    const state = begun([...row('Chiller', 0, 3), sign('Inbound', 10, 0, 0, 4)])
    expect(areaNamesInPaintState(state)).toEqual(['Chiller'])
    expect(signNamesInPaintState(state)).toEqual(['Inbound'])
    // The seeded wide row expands, which is what keeps MAIN's fingerprint stable.
    expect(state.signCells.size).toBe(4)
  })

  it('paints on whichever layer is selected, leaving the other alone', () => {
    let s = reduce(begun([]), { type: 'set_layer', layer: 'sign' }, { type: 'set_sign_brush', name: 'Inbound' })
    s = reduce(s, { type: 'paint_cell', floor: 0, x: 1, y: 1 })
    expect(s.signCells.size).toBe(1)
    expect(s.cells.size).toBe(0)

    s = reduce(s, { type: 'set_layer', layer: 'area' }, { type: 'set_brush_name', name: 'Chiller' })
    s = reduce(s, { type: 'paint_cell', floor: 0, x: 1, y: 1 })
    // Same cell, both layers — they co-occupy, so neither displaces the other.
    expect(s.signCells.size).toBe(1)
    expect(s.cells.size).toBe(1)
  })

  it('refuses a sign stroke while the brush has no text', () => {
    const s = reduce(begun([]), { type: 'set_layer', layer: 'sign' }, { type: 'paint_cell', floor: 0, x: 1, y: 1 })
    expect(s.signCells.size).toBe(0)
    expect(s.dirty).toBe(false)
  })

  it('undo spans both layers, in the order the operator worked', () => {
    // One stack, because an operator switching layers mid-session does not think
    // of the two as separate sessions to unwind independently.
    let s = reduce(begun([]),
      { type: 'set_brush_name', name: 'Chiller' },
      { type: 'stroke_start' },
      { type: 'paint_cell', floor: 0, x: 1, y: 1 },
      { type: 'set_layer', layer: 'sign' },
      { type: 'set_sign_brush', name: 'Inbound' },
      { type: 'stroke_start' },
      { type: 'paint_cell', floor: 0, x: 5, y: 5 },
    )
    expect(s.cells.size).toBe(1)
    expect(s.signCells.size).toBe(1)

    s = areaPaintReducer(s, { type: 'undo' })
    expect(s.signCells.size).toBe(0)
    expect(s.cells.size).toBe(1)

    s = areaPaintReducer(s, { type: 'undo' })
    expect(s.cells.size).toBe(0)
  })

  it('rename_sign moves every cell and follows the brush', () => {
    const s = reduce(begun([sign('Inbound', 0), sign('Inbound', 1)]),
      { type: 'set_sign_brush', name: 'Inbound' },
      { type: 'rename_sign', from: 'Inbound', to: 'Goods In' },
    )
    expect(signNamesInPaintState(s)).toEqual(['Goods In'])
    expect(s.signCells.size).toBe(2)
    expect(s.signBrush).toBe('Goods In')
  })

  it('erase_sign removes the whole sign in one act', () => {
    const s = reduce(begun([sign('Inbound', 0), sign('Inbound', 1)]), { type: 'erase_sign', name: 'Inbound' })
    expect(signSpecsFromPaintState(s)).toEqual([])
  })

  it('folds to exactly what signSpecsFromObjects produces from the same picture', () => {
    // The same cross-surface invariant the areas have: the map's working set and
    // the designer's object list must describe one payload.
    const objects = [sign('Inbound', 3, 3, 0, 10), sign('Outbound', 46, 3, 0, 10), ...row('Chiller', 0, 2)]
    expect(signSpecsFromPaintState(begun(objects))).toEqual(signSpecsFromObjects(objects as any))
  })
})
