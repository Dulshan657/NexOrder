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

  it('confidenceOverall is the minimum of the ESSENTIAL per-field confidences', () => {
    // requested_date is advisory and excluded from the floor, so the lowest
    // essential field (po_number) wins — not the lower requested_date.
    const result = decidePendingPoStatus({
      confidence: { ...fullConfidence, po_number: 0.6, requested_date: 0.4 },
      customerResolved: true,
      allLinesResolved: true,
    })
    expect(result.confidenceOverall).toBe(0.6)
  })

  it('auto-approves when only advisory fields (requested_date, ship_to) are low', () => {
    // The Sydney Tools case: a clean PO with no requested-delivery date.
    // Essentials are all high; advisory fields must not block auto-approval.
    const result = decidePendingPoStatus({
      confidence: { ...fullConfidence, requested_date: 0, ship_to: 0.2 },
      customerResolved: true,
      allLinesResolved: true,
    })
    expect(result.status).toBe('auto_approved')
    expect(result.confidenceOverall).toBe(1.0)
    expect(result.reason).toEqual([])
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

  // ── Policy toggles (app_settings, mig 00044) ──────────────────────────────
  it('routes everything to needs_review when the master switch is off', () => {
    const result = decidePendingPoStatus({
      confidence: fullConfidence,
      customerResolved: true,
      allLinesResolved: true,
      autoApproveEnabled: false,
    })
    expect(result.status).toBe('needs_review')
    expect(result.reason).toContain('auto-approval disabled in settings')
  })

  it('still auto-approves a clean PO when the master switch is explicitly true', () => {
    const result = decidePendingPoStatus({
      confidence: fullConfidence,
      customerResolved: true,
      allLinesResolved: true,
      autoApproveEnabled: true,
    })
    expect(result.status).toBe('auto_approved')
    expect(result.reason).toEqual([])
  })

  it('does NOT block on sender mismatch when blockOnSenderMismatch is off', () => {
    const result = decidePendingPoStatus({
      confidence: fullConfidence,
      customerResolved: true,
      allLinesResolved: true,
      senderMismatch: true,
      blockOnSenderMismatch: false,
    })
    expect(result.status).toBe('auto_approved')
    expect(result.reason.some(r => /spoofing/.test(r))).toBe(false)
  })

  it('still blocks on sender mismatch by default (toggle absent)', () => {
    const result = decidePendingPoStatus({
      confidence: fullConfidence,
      customerResolved: true,
      allLinesResolved: true,
      senderMismatch: true,
    })
    expect(result.status).toBe('needs_review')
    expect(result.reason.some(r => /spoofing/.test(r))).toBe(true)
  })

  // ── Customer-name mismatch (mig 00088) ────────────────────────────────────
  // The gate that would have caught a Hallidays PO being booked against
  // Executive. It is independent of senderMismatch on purpose: the sender was
  // trusted, which is exactly why nothing objected.
  it('routes to needs_review when the document names a different customer', () => {
    const result = decidePendingPoStatus({
      confidence: fullConfidence,
      customerResolved: true,
      allLinesResolved: true,
      senderMismatch: false,
      customerNameMismatch: true,
    })
    expect(result.status).toBe('needs_review')
    expect(result.reason).toContain('document names a different customer')
  })

  it('auto-approves when customerNameMismatch is false', () => {
    const result = decidePendingPoStatus({
      confidence: fullConfidence,
      customerResolved: true,
      allLinesResolved: true,
      customerNameMismatch: false,
    })
    expect(result.status).toBe('auto_approved')
    expect(result.reason).toEqual([])
  })

  it('does NOT block on customer mismatch when blockOnCustomerMismatch is off', () => {
    const result = decidePendingPoStatus({
      confidence: fullConfidence,
      customerResolved: true,
      allLinesResolved: true,
      customerNameMismatch: true,
      blockOnCustomerMismatch: false,
    })
    expect(result.status).toBe('auto_approved')
    expect(result.reason).toEqual([])
  })

  it('blocks on customer mismatch by default (toggle absent)', () => {
    const result = decidePendingPoStatus({
      confidence: fullConfidence,
      customerResolved: true,
      allLinesResolved: true,
      customerNameMismatch: true,
    })
    expect(result.status).toBe('needs_review')
    expect(result.reason).toContain('document names a different customer')
  })

  it('reports both mismatch reasons when both fire', () => {
    const result = decidePendingPoStatus({
      confidence: fullConfidence,
      customerResolved: true,
      allLinesResolved: true,
      senderMismatch: true,
      customerNameMismatch: true,
    })
    expect(result.reason).toHaveLength(2)
  })

  it('leaves the two mismatch toggles independent', () => {
    const result = decidePendingPoStatus({
      confidence: fullConfidence,
      customerResolved: true,
      allLinesResolved: true,
      senderMismatch: true,
      customerNameMismatch: true,
      blockOnSenderMismatch: false,
    })
    expect(result.status).toBe('needs_review')
    expect(result.reason).toEqual(['document names a different customer'])
  })
})
