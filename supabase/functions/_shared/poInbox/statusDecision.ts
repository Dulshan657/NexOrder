// Pure logic that decides whether an extracted PO can be auto-approved
// or must go to human review. Isolated here so the rule is unit-testable
// without spinning up the whole extract-po pipeline.

import type { ExtractedConfidence } from './extractionSchema.ts'

/** Confidence below which we never auto-approve regardless of completeness. */
export const AUTO_APPROVE_CONFIDENCE_THRESHOLD = 0.95

export type PendingPoStatus = 'auto_approved' | 'needs_review'

export interface StatusDecisionInput {
  /** Per-field confidence from the extractor. */
  confidence: ExtractedConfidence
  /** Has the alias resolver assigned a horeca_id? */
  customerResolved: boolean
  /** Did every extracted line resolve to a product_id? */
  allLinesResolved: boolean
}

export interface StatusDecisionResult {
  status: PendingPoStatus
  confidenceOverall: number
  reason: string[]
}

/**
 * Compute the pending_po status and overall confidence from the
 * extractor output + alias-resolver result. We compute
 *   confidenceOverall = min(po_number, customer_name_raw, order_date,
 *                            requested_date, ship_to, lines)
 * so any single low-confidence field drags the overall down.
 *
 * Auto-approval requires all three:
 *   * confidenceOverall >= 0.95
 *   * customer was resolved
 *   * every line resolved to a product
 *
 * The `reason` array captures every check that failed (or, on success,
 * the empty array). It's logged + persisted to confidence_fields for
 * operator debugging.
 */
export function decidePendingPoStatus(input: StatusDecisionInput): StatusDecisionResult {
  const c = input.confidence
  const confidenceOverall = Math.min(
    safeNumber(c.po_number),
    safeNumber(c.customer_name_raw),
    safeNumber(c.order_date),
    safeNumber(c.requested_date),
    safeNumber(c.ship_to),
    safeNumber(c.lines),
  )

  const reasons: string[] = []
  if (confidenceOverall < AUTO_APPROVE_CONFIDENCE_THRESHOLD) {
    reasons.push(
      `confidence_overall=${confidenceOverall.toFixed(2)} below threshold ${AUTO_APPROVE_CONFIDENCE_THRESHOLD}`,
    )
  }
  if (!input.customerResolved) reasons.push('customer not resolved')
  if (!input.allLinesResolved) reasons.push('one or more lines failed to resolve to a product')

  return {
    status: reasons.length === 0 ? 'auto_approved' : 'needs_review',
    confidenceOverall: roundTo(confidenceOverall, 2),
    reason: reasons,
  }
}

function safeNumber(value: number | undefined | null): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0
  if (value < 0) return 0
  if (value > 1) return 1
  return value
}

function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals
  return Math.round(value * factor) / factor
}
