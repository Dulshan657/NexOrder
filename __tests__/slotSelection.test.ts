import { describe, it, expect } from 'vitest'
import {
  slotSelectionReducer,
  initialSlotSelection,
  type SlotSelectionState,
} from '@/components/inventory/warehouse/slotting/useSlotSelection'

// The selection reducer behind the map's slotting block builder. Pure, so the
// gestures that are impossible to drive reliably in a browser (a fast drag, an
// interrupted band) are testable here instead.

const begin = () => slotSelectionReducer(initialSlotSelection, { type: 'begin' })

/** Every cell resolves to one unit whose id is derived from the coordinate, so a
 *  test can assert exactly which units a gesture picked up. */
const cellResolver = (f: number, x: number, y: number) => [x * 100 + y]
const rectResolver = (r: { x0: number; y0: number; x1: number; y1: number }) => {
  const ids: number[] = []
  for (let x = Math.min(r.x0, r.x1); x <= Math.max(r.x0, r.x1); x++) {
    for (let y = Math.min(r.y0, r.y1); y <= Math.max(r.y0, r.y1); y++) ids.push(x * 100 + y)
  }
  return ids
}

function paint(state: SlotSelectionState, cells: Array<[number, number]>): SlotSelectionState {
  let s = slotSelectionReducer(state, { type: 'stroke_start' })
  for (const [x, y] of cells) {
    s = slotSelectionReducer(s, { type: 'select_cell', floor: 0, x, y, resolve: cellResolver })
  }
  return s
}

describe('entering and leaving', () => {
  it('starts empty on step 1', () => {
    const s = begin()
    expect(s.active).toBe(true)
    expect(s.step).toBe(1)
    expect(s.selected.size).toBe(0)
  })

  it('can begin pre-loaded, for editing an existing block', () => {
    const s = slotSelectionReducer(initialSlotSelection, {
      type: 'begin', blockId: 7, blockName: 'Aisle C', selected: [1, 2, 3],
    })
    expect(s.blockId).toBe(7)
    expect(s.blockName).toBe('Aisle C')
    expect([...s.selected]).toEqual([1, 2, 3])
  })

  it('cancel discards everything, including a half-typed rule', () => {
    let s = paint(begin(), [[1, 1]])
    s = slotSelectionReducer(s, { type: 'set_block_name', name: 'Half' })
    s = slotSelectionReducer(s, { type: 'set_new_rule_name', name: 'Half a rule' })
    expect(slotSelectionReducer(s, { type: 'cancel' })).toEqual(initialSlotSelection)
  })
})

describe('painting', () => {
  it('adds a unit per cell', () => {
    const s = paint(begin(), [[1, 1], [2, 3]])
    expect([...s.selected].sort((a, b) => a - b)).toEqual([101, 203])
  })

  it('erases in erase mode without needing a per-call flag', () => {
    let s = paint(begin(), [[1, 1], [2, 3]])
    s = slotSelectionReducer(s, { type: 'set_mode', mode: 'erase' })
    s = paint(s, [[1, 1]])
    expect([...s.selected]).toEqual([203])
  })

  it('ignores a cell that resolves to nothing, leaving state identical', () => {
    const s = paint(begin(), [[1, 1]])
    const after = slotSelectionReducer(s, {
      type: 'select_cell', floor: 0, x: 9, y: 9, resolve: () => [],
    })
    expect(after).toBe(s)
  })
})

describe('undo', () => {
  it('is one frame per STROKE, not per cell', () => {
    // Forty painted bins must not need forty presses to undo.
    let s = paint(begin(), [[1, 1], [1, 2], [1, 3]])
    expect(s.selected.size).toBe(3)
    s = slotSelectionReducer(s, { type: 'undo' })
    expect(s.selected.size).toBe(0)
  })

  it('does nothing with an empty stack', () => {
    const s = begin()
    expect(slotSelectionReducer(s, { type: 'undo' })).toBe(s)
  })

  it('undoes a clear, so a mis-click is recoverable', () => {
    let s = paint(begin(), [[1, 1], [2, 2]])
    s = slotSelectionReducer(s, { type: 'clear_selection' })
    expect(s.selected.size).toBe(0)
    s = slotSelectionReducer(s, { type: 'undo' })
    expect(s.selected.size).toBe(2)
  })

  it('leaves the block name alone — only the PICTURE is undoable', () => {
    let s = paint(begin(), [[1, 1]])
    s = slotSelectionReducer(s, { type: 'set_block_name', name: 'Coconut aisle' })
    s = slotSelectionReducer(s, { type: 'undo' })
    expect(s.blockName).toBe('Coconut aisle')
  })
})

describe('band drag', () => {
  it('resolves against the reducer’s own rect, not one passed in', () => {
    // The recode sweep lost fast drags exactly here: a rect read from a render
    // has not caught up, and the band selects nothing.
    let s = slotSelectionReducer(begin(), { type: 'drag_start', floor: 0, x: 1, y: 1, additive: false })
    s = slotSelectionReducer(s, { type: 'drag_move', x: 2, y: 2 })
    s = slotSelectionReducer(s, { type: 'drag_end', resolve: rectResolver })
    expect([...s.selected].sort((a, b) => a - b)).toEqual([101, 102, 201, 202])
    expect(s.rect).toBeNull()
  })

  it('replaces the selection by default and adds when additive', () => {
    let s = paint(begin(), [[9, 9]])
    let plain = slotSelectionReducer(s, { type: 'drag_start', floor: 0, x: 1, y: 1, additive: false })
    plain = slotSelectionReducer(plain, { type: 'drag_end', resolve: rectResolver })
    expect(plain.selected.has(909)).toBe(false)

    let additive = slotSelectionReducer(s, { type: 'drag_start', floor: 0, x: 1, y: 1, additive: true })
    additive = slotSelectionReducer(additive, { type: 'drag_end', resolve: rectResolver })
    expect(additive.selected.has(909)).toBe(true)
  })

  it('applies nothing when a band is abandoned', () => {
    let s = paint(begin(), [[9, 9]])
    s = slotSelectionReducer(s, { type: 'drag_start', floor: 0, x: 1, y: 1, additive: false })
    // A resolver returning [] is how a cancelled gesture arrives — and because
    // it is not additive, the pre-drag selection is deliberately replaced by
    // nothing rather than silently kept.
    s = slotSelectionReducer(s, { type: 'drag_end', resolve: () => [] })
    expect(s.rect).toBeNull()
    expect(s.selected.size).toBe(0)
  })

  it('switching tool clears an in-flight band', () => {
    let s = slotSelectionReducer(begin(), { type: 'drag_start', floor: 0, x: 1, y: 1, additive: false })
    s = slotSelectionReducer(s, { type: 'set_tool', tool: 'paint' })
    expect(s.rect).toBeNull()
  })
})

describe('rule attachment is exclusive', () => {
  it('picking an existing rule clears a half-typed new one', () => {
    let s = slotSelectionReducer(begin(), { type: 'set_new_rule_name', name: 'Milwaukee' })
    s = slotSelectionReducer(s, { type: 'set_new_rule_brand', brand: 'Milwaukee' })
    s = slotSelectionReducer(s, { type: 'set_attach_rule', ruleId: '4' })
    expect(s.attachRuleId).toBe('4')
    expect(s.newRuleName).toBe('')
    expect(s.newRuleBrand).toBe('')
  })

  it('typing a new rule clears the attach choice', () => {
    let s = slotSelectionReducer(begin(), { type: 'set_attach_rule', ruleId: '4' })
    s = slotSelectionReducer(s, { type: 'set_new_rule_name', name: 'Ryobi' })
    expect(s.attachRuleId).toBe('')
    expect(s.newRuleName).toBe('Ryobi')
  })

  it('choosing "don’t attach" leaves a typed new rule alone', () => {
    let s = slotSelectionReducer(begin(), { type: 'set_new_rule_name', name: 'Ryobi' })
    s = slotSelectionReducer(s, { type: 'set_attach_rule', ruleId: '' })
    expect(s.newRuleName).toBe('Ryobi')
  })
})

describe('applied', () => {
  it('moves to the success state and records the block', () => {
    const s = slotSelectionReducer(paint(begin(), [[1, 1]]), { type: 'applied', blockId: 12 })
    expect(s.step).toBe('done')
    expect(s.savedBlockId).toBe(12)
  })
})
