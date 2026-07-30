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
  /**
   * True when the customer was resolved but the inbound sender is not a
   * trusted address for that customer (possible spoofing). Forces human
   * review regardless of confidence (unless blockOnSenderMismatch is off).
   * Defaults to false.
   */
  senderMismatch?: boolean
  /**
   * True when the customer was resolved but the DOCUMENT names a different
   * company (see customerNameMatch.ts). Distinct from senderMismatch: that one
   * asks whether the sender may order for this customer, this one asks whether
   * the customer is who the paperwork says. Defaults to false.
   */
  customerNameMismatch?: boolean
  /**
   * Master auto-approval switch (app_settings.po_auto_approve_enabled).
   * When false, every PO is routed to review. Defaults to true.
   */
  autoApproveEnabled?: boolean
  /**
   * Whether a sender mismatch blocks auto-approval
   * (app_settings.po_auto_approve_block_on_sender_mismatch). Defaults to true.
   */
  blockOnSenderMismatch?: boolean
  /**
   * Whether a document/customer name mismatch blocks auto-approval
   * (app_settings.po_auto_approve_block_on_customer_mismatch, mig 00088).
   * Defaults to true.
   */
  blockOnCustomerMismatch?: boolean
}

export interface StatusDecisionResult {
  status: PendingPoStatus
  confidenceOverall: number
  reason: string[]
}

/**
 * Compute the pending_po status and overall confidence from the
 * extractor output + alias-resolver result. We compute
 *   confidenceOverall = min(po_number, customer_name_raw, order_date, lines)
 * — the ESSENTIAL fields needed to act on an order. `requested_date` and
 * `ship_to` are advisory (many legitimate POs omit a requested-delivery
 * date or print only a billing address), so they are deliberately excluded
 * from the hard floor: an absent advisory field must not block an otherwise
 * confident, fully-resolved PO from auto-approving.
 *
 * Auto-approval requires all three:
 *   * confidenceOverall >= 0.95 (over essential fields)
 *   * customer was resolved
 *   * every line resolved to a product
 * and must be flagged for neither sender mismatch nor customer-name mismatch.
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
    safeNumber(c.lines),
  )

  // Policy toggles (app_settings, mig 00044). Absent ⇒ default true, preserving
  // the historical always-on behaviour.
  const autoApproveEnabled = input.autoApproveEnabled !== false
  const blockOnSenderMismatch = input.blockOnSenderMismatch !== false
  const blockOnCustomerMismatch = input.blockOnCustomerMismatch !== false

  const reasons: string[] = []
  if (!autoApproveEnabled) reasons.push('auto-approval disabled in settings')
  if (confidenceOverall < AUTO_APPROVE_CONFIDENCE_THRESHOLD) {
    reasons.push(
      `confidence_overall=${confidenceOverall.toFixed(2)} below threshold ${AUTO_APPROVE_CONFIDENCE_THRESHOLD}`,
    )
  }
  if (!input.customerResolved) reasons.push('customer not resolved')
  if (!input.allLinesResolved) reasons.push('one or more lines failed to resolve to a product')
  if (input.senderMismatch && blockOnSenderMismatch) {
    reasons.push('sender does not match customer (possible spoofing)')
  }
  if (input.customerNameMismatch && blockOnCustomerMismatch) {
    reasons.push('document names a different customer')
  }

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
