// What the recode panel and the map SHOW.
//
// `visibleControls` is the reported bug expressed as a rule. The built-in template
// carries no counter, yet the old toolbar rendered "Start at" and "Order" anyway —
// so the operator set them, nothing happened to the result, and there was no way
// from inside the UI to find out why. A control that cannot affect the outcome must
// not be on screen, and that is a property worth pinning rather than a layout detail.

import { describe, it, expect } from 'vitest'
import {
  sweepPrefix,
  ghostLabels,
  refusalRemedy,
  stepSatisfaction,
  visibleControls,
} from '@/components/inventory/warehouse/recode/recodePlanView'
import { BUILTIN_PATTERN, WIZARD_DEFAULT_PATTERN, planRecode, type RecodeUnit } from '@/lib/codePattern'

const unit = (id: number, x: number, y: number, code: string): RecodeUnit =>
  ({ id, floor: 0, x, y, code, codeBlock: null, codeSeq: null })

const placement = (id: number, x: number, y: number, w = 1, h = 1) =>
  ({ locationId: id, x, y, w, h, floor: 0 }) as any

describe('visibleControls', () => {
  // The exact template the operator was using when they reported the bug.
  it('hides every numbering control for the built-in grid pattern, and says why', () => {
    const v = visibleControls(BUILTIN_PATTERN.template)
    expect(v.origin).toBe(false)
    expect(v.order).toBe(false)
    expect(v.startAt).toBe(false)
    expect(v.note).toMatch(/position on the grid/)
  })

  it('shows the origin but not the counter controls for row/column numbering', () => {
    const v = visibleControls(WIZARD_DEFAULT_PATTERN.template)
    expect(v.origin).toBe(true)
    // Coordinates come from position, not from a walk, so a fill order is inert.
    expect(v.order).toBe(false)
    expect(v.startAt).toBe(false)
    expect(v.note).toMatch(/no \{n\} counter/)
  })

  it('shows everything for a counter pattern, with nothing to explain away', () => {
    const v = visibleControls('{wh}-{block}-{n:02}')
    expect(v).toEqual({ origin: true, order: true, startAt: true, note: null })
  })
})

describe('sweepPrefix', () => {
  // Derived from the PATTERN. A character-wise common prefix over the actual codes
  // would trim `AMADIYA-BULK-1-1` / `AMADIYA-BULK-1-2` down to `1` and `2`, hiding
  // the grid — this is the case that caught it.
  it('trims only the warehouse and block, whatever the numbers happen to share', () => {
    expect(sweepPrefix(WIZARD_DEFAULT_PATTERN.template, 'AMADIYA', 'BULK'))
      .toBe('AMADIYA-BULK-')
  })

  it('handles a counter pattern the same way', () => {
    expect(sweepPrefix('{wh}-{block}-{n:02}', 'AMD', 'COLD')).toBe('AMD-COLD-')
  })

  it('trims the warehouse alone when the pattern carries no block', () => {
    expect(sweepPrefix('{wh}-{n:03}', 'AMD', 'BULK')).toBe('AMD-')
  })

  it('returns nothing for a pattern with neither, so the full code is drawn', () => {
    expect(sweepPrefix('BAY{n:03}', 'AMD', 'BULK')).toBe('')
  })
})

describe('ghostLabels', () => {
  const units = [unit(1, 3, 3, 'AMADIYA-B-3-3'), unit(2, 4, 3, 'AMADIYA-B-4-3')]
  const placements = new Map([[1, placement(1, 3, 3)], [2, placement(2, 4, 3)]])
  const opts = {
    template: WIZARD_DEFAULT_PATTERN.template,
    block: 'BULK', start: 1, order: 'row' as const, wh: 'AMADIYA',
    takenCodes: new Map<string, number>(),
  }

  it('draws the trimmed proposed code on each selected bin', () => {
    const plan = planRecode(units, opts)
    const labels = ghostLabels({ units, placements, plan, template: opts.template, wh: opts.wh, block: opts.block })
    expect(labels.map((l) => l.text)).toEqual(['1-1', '1-2'])
  })

  it('carries the cell geometry so the layer can place it without the canvas', () => {
    const plan = planRecode(units, opts)
    const [first] = ghostLabels({ units, placements, plan, template: opts.template, wh: opts.wh, block: opts.block })
    expect(first).toMatchObject({ locationId: 1, floor: 0, x: 3, y: 3, w: 1, h: 1 })
  })

  // A refused plan writes nothing, but its rendered codes are exactly how the
  // operator SEES the refusal — two bins showing the same number, say.
  // What the operator needs to see is that both bins carry the SAME text — that is
  // the duplicate, made visible on the map before they press anything.
  it('still labels a refused plan, from its refusals', () => {
    const plan = planRecode(units, { ...opts, template: '{wh}-{block}' })
    expect(plan.writes).toEqual([])
    const texts = ghostLabels({
      units, placements, plan, template: '{wh}-{block}', wh: opts.wh, block: opts.block,
    }).map((l) => l.text)
    expect(texts).toHaveLength(2)
    expect(texts[0]).toBe(texts[1])
    expect('AMADIYA-BULK'.endsWith(texts[0])).toBe(true)
  })

  /**
   * Found in a browser on dev, and the reason `plan.proposed` exists.
   *
   * A refused batch writes NOTHING, so reading the labels off `plan.writes` left
   * every non-offending unit with no proposed code — it fell back to its CURRENT
   * one. The map then showed a mix: the two colliding bins in their new scheme and
   * all the rest in the old, which reads as "only those two are changing" when in
   * fact none of them are. Exactly backwards, in the one case the operator most
   * needs to understand.
   */
  it('labels EVERY unit with what it would get, even when the batch is refused', () => {
    // A collision the batch cannot have: something outside it already owns 1-1.
    const taken = new Map([['amadiya-bulk-1-1', 999]])
    const plan = planRecode(units, { ...opts, takenCodes: taken })
    expect(plan.writes).toEqual([])
    expect(plan.refusals.some((r) => r.kind === 'collision')).toBe(true)

    const texts = ghostLabels({
      units, placements, plan, template: opts.template, wh: opts.wh, block: opts.block,
    }).map((l) => l.text)
    // Both proposed codes, not one proposal and one stale code.
    expect(texts).toEqual(['1-1', '1-2'])
  })

  // An already-settled bin produces no write and no refusal, so its own code IS the
  // answer — and it must read like its neighbours, not stand out with a full code
  // just because this sweep would leave it alone.
  it('labels an unchanged unit from its own code, trimmed the same way', () => {
    const settled = [unit(1, 3, 3, 'AMADIYA-BULK-1-1')]
    settled[0].codeBlock = 'BULK'
    settled[0].codeSeq = 1
    const plan = planRecode(settled, opts)
    expect(plan.writes).toEqual([])
    expect(ghostLabels({
      units: settled, placements, plan, template: opts.template, wh: opts.wh, block: opts.block,
    })[0].text).toBe('1-1')
  })

  it('skips a unit with no placement rather than drawing it at the origin', () => {
    const plan = planRecode(units, opts)
    expect(ghostLabels({ units, placements: new Map([[1, placement(1, 3, 3)]]), plan, template: opts.template, wh: opts.wh, block: opts.block }))
      .toHaveLength(1)
  })
})

describe('refusalRemedy', () => {
  it('points a collision at the block name', () => {
    const r = refusalRemedy({ id: 1, from: 'A', to: 'B', kind: 'collision', detail: 'taken', heldBy: 9 })
    expect(r.step).toBe(2)
    expect(r.action).toMatch(/block/i)
  })

  // The overwhelmingly likely cause of a duplicate is a pattern with nothing to tell
  // two bins apart, so the remedy names that rather than restating the symptom.
  it('offers row & column numbering for a duplicate, and explains the cause', () => {
    const r = refusalRemedy({ id: 1, from: 'A', to: 'B', kind: 'duplicate', detail: 'dupe' })
    expect(r.step).toBe(3)
    expect(r.detail).toMatch(/counter or a row\/column/)
  })

  it('points drift at the numbering origin', () => {
    const r = refusalRemedy({ id: 0, from: '', to: '', kind: 'drift', detail: '48 would move' })
    expect(r.step).toBe(3)
    expect(r.action).toMatch(/numbering starts/)
  })

  it('offers to drop an unsweepable kind from the selection', () => {
    const r = refusalRemedy({ id: 1, from: 'Z', to: 'Z', kind: 'kind', detail: 'not storage' })
    expect(r.step).toBe(1)
  })

  it('always produces something to say, even for a bare charset refusal', () => {
    const r = refusalRemedy({ id: 1, from: 'A', to: 'a-b', kind: 'charset', detail: '' })
    expect(r.detail.length).toBeGreaterThan(0)
  })
})

// The step rail's ticks.
//
// SATISFACTION, NOT VISITEDNESS. Every step here is reachable at any time — the rail
// is four buttons, not a gate — so "have you been here" says nothing useful: an
// operator who clicked straight to Review has visited it and answered nothing.
describe('stepSatisfaction', () => {
  const args = (over = {}) => ({
    selectedCount: 3,
    block: 'BULK',
    template: '{wh}-{block}-{row}-{col}',
    hasPreview: true,
    refusedTotal: 0,
    willRecode: 3,
    ...over,
  })

  it('ticks every step for a sweep that is ready to apply', () => {
    expect(stepSatisfaction(args())).toEqual({ 1: true, 2: true, 3: true, 4: true })
  })

  it('leaves Select unticked with nothing painted', () => {
    expect(stepSatisfaction(args({ selectedCount: 0 }))[1]).toBe(false)
  })

  it('leaves Block unticked for a blank or unusable name', () => {
    expect(stepSatisfaction(args({ block: '' }))[2]).toBe(false)
    expect(stepSatisfaction(args({ block: '   ' }))[2]).toBe(false)
  })

  it('leaves Numbering unticked for a malformed pattern', () => {
    expect(stepSatisfaction(args({ template: '{wh}-{nope}' }))[3]).toBe(false)
  })

  // The one that matters most: 1 to 3 can all be green while the sweep is not
  // remotely ready, because only the server can answer step 4.
  it('leaves Review unticked until the server has answered usefully', () => {
    expect(stepSatisfaction(args({ hasPreview: false }))).toMatchObject({ 1: true, 2: true, 3: true, 4: false })
    expect(stepSatisfaction(args({ refusedTotal: 2 }))[4]).toBe(false)
    expect(stepSatisfaction(args({ willRecode: 0 }))[4]).toBe(false)
  })

  // Steps are independent: an empty selection must not drag the others down, or the
  // rail would say nothing until everything was done at once.
  it('scores each step on its own question', () => {
    expect(stepSatisfaction(args({ selectedCount: 0, hasPreview: false })))
      .toEqual({ 1: false, 2: true, 3: true, 4: false })
  })
})
