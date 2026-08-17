// When Apply can be pressed, and what it says when it cannot.
//
// The reported complaint was "I only see a Preview button and no button to apply."
// The button existed — `Recode {N}`, inside a dialog that only opened after Preview
// succeeded, disabled on three separate conditions. It did not read as one because
// nothing on screen said it was there or what would reveal it.
//
// So the footer is now always rendered and always explains itself. That makes the
// REASON a piece of logic worth pinning: a disabled control with a reason is a
// signpost, one without is a dead end, and an absent one is worse than either.

import { describe, it, expect } from 'vitest'
import { applyBlockedReason } from '@/components/inventory/warehouse/recode/RecodePanel'
import type { RecodePreview } from '@/services/supabase/warehouseLocationService'

const preview = (over: Partial<RecodePreview> = {}): RecodePreview => ({
  willRecode: 3, units: 3, levels: 0, unchanged: 0, nextCounter: 4, startedAt: 1,
  block: 'BULK', template: '{wh}-{block}-{row}-{col}', examples: [],
  refusals: [], refusedTotal: 0, labelPrinted: 0, holdingStock: 0, codes: ['A-1'],
  frame: { rows: 1, cols: 3 }, drift: [], driftTotal: 0, incumbents: 0,
  origin: 'nw', order: 'row', suggestedFraming: null,
  ...over,
})

const args = (over: Partial<Parameters<typeof applyBlockedReason>[0]> = {}) => ({
  selectedCount: 3,
  block: 'BULK',
  preview: preview(),
  previewing: false,
  applying: false,
  ackPrinted: false,
  ...over,
})

describe('applyBlockedReason', () => {
  it('permits a clean sweep', () => {
    expect(applyBlockedReason(args())).toBeNull()
  })

  // Ordered by what the operator can act on FIRST. Telling someone with an empty
  // selection to resolve three refusals would be true and useless.
  it('asks for a selection before anything else', () => {
    expect(applyBlockedReason(args({
      selectedCount: 0,
      block: '',
      preview: preview({ refusedTotal: 2 }),
    }))).toMatch(/paint some bins/i)
  })

  it('asks for a block name once there is a selection', () => {
    expect(applyBlockedReason(args({ block: '   ' }))).toMatch(/block a name/i)
  })

  it('reports the in-flight check rather than looking broken', () => {
    expect(applyBlockedReason(args({ previewing: true, preview: null })))
      .toMatch(/checking/i)
  })

  // The state the old flow had no words for: everything is filled in, but the
  // server has not been asked yet.
  it('sends the operator to Review when nothing has been checked', () => {
    expect(applyBlockedReason(args({ preview: null }))).toMatch(/review/i)
  })

  it('counts the refusals rather than naming only the first', () => {
    expect(applyBlockedReason(args({ preview: preview({ refusedTotal: 3 }) })))
      .toBe('Resolve 3 problems')
    expect(applyBlockedReason(args({ preview: preview({ refusedTotal: 1 }) })))
      .toBe('Resolve 1 problem')
  })

  it('holds for the printed-label acknowledgement, and releases once ticked', () => {
    const withLabels = preview({ labelPrinted: 4 })
    expect(applyBlockedReason(args({ preview: withLabels }))).toMatch(/printed labels/i)
    expect(applyBlockedReason(args({ preview: withLabels, ackPrinted: true }))).toBeNull()
  })

  // Idempotence, surfaced. Re-running the identical sweep is a no-op and the button
  // must say so rather than appearing broken.
  it('says nothing would change when the sweep is already applied', () => {
    expect(applyBlockedReason(args({ preview: preview({ willRecode: 0, unchanged: 3 }) })))
      .toMatch(/nothing would change/i)
  })

  it('reports the in-flight write above every other reason', () => {
    expect(applyBlockedReason(args({ applying: true, selectedCount: 0 }))).toBe('Applying…')
  })
})
