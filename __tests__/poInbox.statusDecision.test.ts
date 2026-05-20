import { describe, it, expect } from 'vitest'

import {
  AUTO_APPROVE_CONFIDENCE_THRESHOLD,
  decidePendingPoStatus,
} from '../supabase/functions/_shared/poInbox/statusDecision'
import type { ExtractedConfidence } from '../supabase/functions/_shared/poInbox/extractionSchema'

const fullConfidence: ExtractedConfidence = {
  po_number: 1.0,
  customer_name_raw: 1.0,
  order_date: 1.0,
  requested_date: 1.0,
  ship_to: 1.0,
  lines: 1.0,
}

describe('decidePendingPoStatus', () => {
  it('auto-approves when all three gates pass', () => {
    const result = decidePendingPoStatus({
      confidence: fullConfidence,
      customerResolved: true,
      allLinesResolved: true,
    })
    expect(result.status).toBe('auto_approved')
    expect(result.confidenceOverall).toBe(1.0)
    expect(result.reason).toEqual([])
  })

  it('routes to needs_review when customer is unresolved', () => {
    const result = decidePendingPoStatus({
      confidence: fullConfidence,
      customerResolved: false,
      allLinesResolved: true,
    })
    expect(result.status).toBe('needs_review')
    expect(result.reason).toContain('customer not resolved')
  })

  it('routes to needs_review when any line is unresolved', () => {
    const result = decidePendingPoStatus({
      confidence: fullConfidence,
      customerResolved: true,
      allLinesResolved: false,
    })
    expect(result.status).toBe('needs_review')
    expect(result.reason.some(r => /lines/.test(r))).toBe(true)
  })

  it('routes to needs_review when overall confidence is below threshold', () => {
    const result = decidePendingPoStatus({
      confidence: { ...fullConfidence, lines: 0.8 },
      customerResolved: true,
      allLinesResolved: true,
    })
    expect(result.status).toBe('needs_review')
    expect(result.confidenceOverall).toBe(0.8)
    expect(result.reason[0]).toMatch(/confidence_overall=0\.80/)
  })

  it('confidenceOverall is the minimum of per-field confidences', () => {
    const result = decidePendingPoStatus({
      confidence: { ...fullConfidence, po_number: 0.6, requested_date: 0.4 },
      customerResolved: true,
      allLinesResolved: true,
    })
    expect(result.confidenceOverall).toBe(0.4)
  })

  it('clamps non-finite or out-of-range per-field values to 0', () => {
    const broken = {
      po_number: NaN,
      customer_name_raw: -1,
      order_date: 2,
      requested_date: 0.9,
      ship_to: 0.9,
      lines: 0.9,
    } as unknown as ExtractedConfidence
    const result = decidePendingPoStatus({
      confidence: broken,
      customerResolved: true,
      allLinesResolved: true,
    })
    expect(result.confidenceOverall).toBe(0)
    expect(result.status).toBe('needs_review')
  })

  it('exposes 0.95 as the threshold constant the spec calls out', () => {
    expect(AUTO_APPROVE_CONFIDENCE_THRESHOLD).toBe(0.95)
  })

  it('accumulates all failing reasons (not first-only)', () => {
    const result = decidePendingPoStatus({
      confidence: { ...fullConfidence, lines: 0.5 },
      customerResolved: false,
      allLinesResolved: false,
    })
    expect(result.reason).toHaveLength(3)
  })

  it('routes to needs_review on sender mismatch even when all other gates pass', () => {
    const result = decidePendingPoStatus({
      confidence: fullConfidence,
      customerResolved: true,
      allLinesResolved: true,
      senderMismatch: true,
    })
    expect(result.status).toBe('needs_review')
    expect(result.confidenceOverall).toBe(1.0)
    expect(result.reason.some(r => /spoofing/.test(r))).toBe(true)
  })

  it('auto-approves when senderMismatch is false (default behavior unchanged)', () => {
    const result = decidePendingPoStatus({
      confidence: fullConfidence,
      customerResolved: true,
      allLinesResolved: true,
      senderMismatch: false,
    })
    expect(result.status).toBe('auto_approved')
    expect(result.reason).toEqual([])
  })
})
