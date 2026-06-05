import { describe, it, expect } from 'vitest'

import { confidenceReasoning } from '../components/admin/poInboxFormat'

const fullFields = {
  per_field: {
    po_number: 1,
    customer_name_raw: 1,
    order_date: 1,
    requested_date: 1,
    ship_to: 1,
    lines: 1,
  },
  gating_reasons: [],
}

describe('confidenceReasoning', () => {
  it('is a single concise line when everything is 100%', () => {
    const text = confidenceReasoning(1, fullFields)
    expect(text).toBe('AI match confidence 100%')
    expect(text.split('\n')).toHaveLength(1)
  })

  it('calls out the single weakest field that drags the score to 0%', () => {
    const text = confidenceReasoning(0, {
      per_field: { ...fullFields.per_field, order_date: 0 },
      gating_reasons: ['confidence_overall=0.00 below 0.95 auto-approve threshold'],
    })
    expect(text).toContain('AI match confidence 0%')
    expect(text).toContain('Lowest: Order date 0%')
    expect(text).toContain('below 0.95')
  })

  it('lists multiple fields tied at the minimum', () => {
    const text = confidenceReasoning(0.4, {
      per_field: { ...fullFields.per_field, order_date: 0.4, ship_to: 0.4 },
    })
    expect(text).toContain('Lowest: Order date 40%, Ship-to 40%')
  })

  it('shows gating reasons even when all fields are 100% (e.g. sender mismatch)', () => {
    const text = confidenceReasoning(1, {
      per_field: fullFields.per_field,
      gating_reasons: ['possible sender spoofing — verify sender'],
    })
    // No "Lowest" line because nothing is below 100%, but the reason still shows.
    expect(text).not.toContain('Lowest')
    expect(text).toContain('possible sender spoofing')
  })

  it('degrades gracefully when confidence_fields is empty or missing', () => {
    expect(confidenceReasoning(0.5, {})).toBe('AI match confidence 50%')
    expect(confidenceReasoning(0.5, null)).toBe('AI match confidence 50%')
    expect(confidenceReasoning(0.5, undefined)).toBe('AI match confidence 50%')
  })
})
