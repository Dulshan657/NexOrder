// Where Apply sends you when it will not fire.
//
// `applyBlockedReason` (pinned next door in recodePanelGating.test.ts) answers WHY.
// It could not answer WHERE, and that gap was a live defect rather than a missing
// nicety: the footer disabled Apply on `!!blocked`, and `blocked` is
// "Review the sweep first" whenever there is no preview — which is always true on
// steps 1 to 3. So the comment above that button, promising that pressing it from
// step 1 takes you to Review, described a branch in runRecode that could never run.
//
// `applyBlock` adds the destination. The rule the footer applies to it is that a
// blocker on ANOTHER step is navigable, and only a blocker on the step you are
// standing on — or one with nowhere to go — actually greys the button out.

import { describe, it, expect } from 'vitest'
import { applyBlock, applyBlockedReason } from '@/components/inventory/warehouse/recode/RecodePanel'
import type { RecodePreview } from '@/services/supabase/warehouseLocationService'

const preview = (over: Partial<RecodePreview> = {}): RecodePreview => ({
  willRecode: 3, units: 3, levels: 0, unchanged: 0, nextCounter: 4, startedAt: 1,
  block: 'BULK', template: '{wh}-{block}-{row}-{col}', examples: [],
  refusals: [], refusedTotal: 0, labelPrinted: 0, holdingStock: 0, codes: ['A-1'],
  frame: { rows: 1, cols: 3 }, drift: [], driftTotal: 0, incumbents: 0,
  origin: 'nw', order: 'row', suggestedFraming: null,
  ...over,
})

const args = (over: Partial<Parameters<typeof applyBlock>[0]> = {}) => ({
  selectedCount: 3,
  block: 'BULK',
  preview: preview(),
  previewing: false,
  applying: false,
  ackPrinted: false,
  ...over,
})

/** The footer's rule, restated here so the tests exercise the decision rather than
 *  the two halves it is made of. */
const navigable = (step: 1 | 2 | 3 | 4, over = {}) => {
  const b = applyBlock(args(over))
  return !!b && b.step !== null && b.step !== step
}

describe('applyBlock', () => {
  it('permits a clean sweep, exactly as the reason view does', () => {
    expect(applyBlock(args())).toBeNull()
    expect(applyBlockedReason(args())).toBeNull()
  })

  // The wrapper must stay a pure projection: recodePanelGating.test.ts pins the
  // strings, and it would keep passing even if applyBlock started disagreeing.
  it('agrees with applyBlockedReason on every branch', () => {
    const cases = [
      {}, { applying: true }, { selectedCount: 0 }, { block: '  ' },
      { previewing: true, preview: null }, { preview: null },
      { preview: preview({ refusedTotal: 2 }) },
      { preview: preview({ labelPrinted: 4 }) },
      { preview: preview({ willRecode: 0 }) },
    ]
    for (const c of cases) {
      expect(applyBlock(args(c))?.reason ?? null).toBe(applyBlockedReason(args(c)))
    }
  })

  it('sends an empty selection to Select and a nameless block to Block', () => {
    expect(applyBlock(args({ selectedCount: 0 }))).toMatchObject({ step: 1, tone: 'todo' })
    expect(applyBlock(args({ block: '   ' }))).toMatchObject({ step: 2, tone: 'todo' })
  })

  // THE defect. Standing on step 1 with everything filled in, the only thing left is
  // to ask the server — so Apply must be pressable and must land on Review.
  it('makes Apply navigable from steps 1 to 3 when the sweep has not been checked', () => {
    expect(applyBlock(args({ preview: null }))).toMatchObject({ step: 4 })
    expect(navigable(1, { preview: null })).toBe(true)
    expect(navigable(2, { preview: null })).toBe(true)
    expect(navigable(3, { preview: null })).toBe(true)
  })

  // The mirror of the above, and the reason `navigable` compares against the CURRENT
  // step rather than just checking for a non-null one: on Review there is nowhere
  // further to send anybody, so the button has to go grey and stay grey.
  it('leaves Apply disabled once you are already standing on Review', () => {
    expect(navigable(4, { preview: null })).toBe(false)
    expect(navigable(4, { preview: preview({ refusedTotal: 2 }) })).toBe(false)
    expect(navigable(4, { preview: preview({ labelPrinted: 4 }) })).toBe(false)
  })

  it('marks refusals and the unacknowledged label reprint as problems, not chores', () => {
    expect(applyBlock(args({ preview: preview({ refusedTotal: 2 }) })))
      .toMatchObject({ tone: 'problem', step: 4 })
    expect(applyBlock(args({ preview: preview({ labelPrinted: 4 }) })))
      .toMatchObject({ tone: 'problem', step: 4 })
  })

  // Nowhere to go: no step answers "the server says this would change nothing", and
  // an in-flight request answers itself. Both must disable rather than navigate.
  it('offers no destination for the states that have none', () => {
    expect(applyBlock(args({ applying: true }))).toMatchObject({ tone: 'busy', step: null })
    expect(applyBlock(args({ previewing: true, preview: null })))
      .toMatchObject({ tone: 'busy', step: null })
    expect(applyBlock(args({ preview: preview({ willRecode: 0 }) })))
      .toMatchObject({ tone: 'todo', step: null })
    expect(navigable(1, { applying: true })).toBe(false)
    expect(navigable(1, { preview: preview({ willRecode: 0 }) })).toBe(false)
  })
})
