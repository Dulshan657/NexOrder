// The gesture decision table.
//
// The rules interact by ORDER, so most of what is worth pinning here is a pair of
// rules disagreeing and the right one winning. Each `it` below names which.

import { describe, it, expect } from 'vitest'
import { decidePointerDown, type PointerFacts } from '@/components/inventory/warehouse/mapGesture'

const facts = (over: Partial<PointerFacts> = {}): PointerFacts => ({
  pointerType: 'mouse',
  button: 0,
  altKey: false,
  downCount: 1,
  paintArmed: false,
  selectArmed: false,
  tool: null,
  cell: { x: 4, y: 7 },
  cellHasUnits: true,
  ...over,
})

const brush = (over: Partial<PointerFacts> = {}) =>
  facts({ selectArmed: true, tool: 'paint', ...over })
const box = (over: Partial<PointerFacts> = {}) =>
  facts({ selectArmed: true, tool: 'rect', ...over })

describe('decidePointerDown — the headline rule', () => {
  it('paints when the brush lands on storage', () => {
    expect(decidePointerDown(brush())).toEqual({ kind: 'stroke', stroke: 'brush', erase: false })
  })

  // The change this whole module exists for. Before it, every drag painted and Alt
  // was the only way to move around a floor plan that is mostly floor.
  it('moves the map when the brush lands on open floor', () => {
    expect(decidePointerDown(brush({ cellHasUnits: false }))).toEqual({ kind: 'pan' })
  })

  // Out of bounds arrives as a null cell and falls out of the same branch, which is
  // better than the silent no-op it used to be.
  it('moves the map when the brush lands past the edge of the grid', () => {
    expect(decidePointerDown(brush({ cell: null, cellHasUnits: false }))).toEqual({ kind: 'pan' })
  })
})

describe('decidePointerDown — the Box', () => {
  // You lasso a block from just OUTSIDE it, so a hit test here would break the
  // common case rather than serve it.
  it('bands wherever it starts', () => {
    for (const f of [box(), box({ cellHasUnits: false }), box({ cell: null, cellHasUnits: false })]) {
      expect(decidePointerDown(f)).toEqual({ kind: 'stroke', stroke: 'band', erase: false })
    }
  })
})

describe('decidePointerDown — Alt is only ever pan', () => {
  // Alt sits above the right-button rule so it can never come to mean erase:
  // useMapViewport pans on button 0 alone, so this is the only escape hatch there is.
  it('pans with every armed combination', () => {
    for (const f of [
      facts({ altKey: true }),
      brush({ altKey: true }),
      brush({ altKey: true, cellHasUnits: false }),
      box({ altKey: true }),
      facts({ altKey: true, paintArmed: true }),
      brush({ altKey: true, button: 2 }),
    ]) {
      expect(decidePointerDown(f)).toEqual({ kind: 'pan' })
    }
  })
})

describe('decidePointerDown — right-drag erases', () => {
  it('erases with the brush over storage and with the box anywhere', () => {
    expect(decidePointerDown(brush({ button: 2 })))
      .toEqual({ kind: 'stroke', stroke: 'brush', erase: true })
    expect(decidePointerDown(box({ button: 2, cellHasUnits: false })))
      .toEqual({ kind: 'stroke', stroke: 'band', erase: true })
  })

  // Not `pan`: a right-drag is a statement about a selection, and answering it by
  // moving the map would answer a different question.
  it('does nothing on open floor, rather than panning', () => {
    expect(decidePointerDown(brush({ button: 2, cellHasUnits: false }))).toEqual({ kind: 'none' })
  })

  it('leaves the context menu alone when no sweep is armed', () => {
    expect(decidePointerDown(facts({ button: 2 }))).toEqual({ kind: 'none' })
    expect(decidePointerDown(facts({ button: 2, paintArmed: true }))).toEqual({ kind: 'none' })
  })
})

describe('decidePointerDown — buttons we do not claim', () => {
  it('ignores middle and thumb buttons', () => {
    for (const button of [1, 3, 4]) {
      expect(decidePointerDown(brush({ button }))).toEqual({ kind: 'none' })
    }
  })
})

describe('decidePointerDown — two fingers', () => {
  // Checked first because the second finger lands wherever the hand happens to be,
  // which on a dense floor is usually on a bin — so its coordinates say nothing.
  it('wins over every other rule', () => {
    for (const f of [
      brush({ pointerType: 'touch', downCount: 2 }),
      box({ pointerType: 'touch', downCount: 2 }),
      brush({ pointerType: 'touch', downCount: 2, altKey: true }),
      brush({ pointerType: 'touch', downCount: 2, button: 2 }),
      facts({ pointerType: 'touch', downCount: 3, paintArmed: true }),
    ]) {
      expect(decidePointerDown(f)).toEqual({ kind: 'pinch' })
    }
  })

  // A mouse is one pointer forever, so a mouse arriving alongside a touch is not a
  // second finger and must not be read as one.
  it('is not triggered by a mouse', () => {
    expect(decidePointerDown(brush({ pointerType: 'mouse', downCount: 2 })))
      .toEqual({ kind: 'stroke', stroke: 'brush', erase: false })
  })
})

describe('decidePointerDown — annotate is deliberately asymmetric', () => {
  // An area is painted ON open floor — that is what an area IS. Applying the
  // headline rule here would make the tool impossible, so this is the assertion
  // that stops someone "fixing" the inconsistency.
  it('paints on open floor, where the sweep brush would pan', () => {
    expect(decidePointerDown(facts({ paintArmed: true, cellHasUnits: false })))
      .toEqual({ kind: 'stroke', stroke: 'paint', erase: false })
    expect(decidePointerDown(facts({ paintArmed: true, cell: null, cellHasUnits: false })))
      .toEqual({ kind: 'stroke', stroke: 'paint', erase: false })
  })
})

describe('decidePointerDown — nothing armed', () => {
  it('pans', () => {
    expect(decidePointerDown(facts())).toEqual({ kind: 'pan' })
  })
})
