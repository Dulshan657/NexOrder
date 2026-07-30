// Consolidated "problems with this PO" computation for the PO Inbox.
//
// Surfaces the same class of warnings the operator already sees for sender
// mismatch — now also for stock shortfalls, unresolved product lines, and an
// unmatched customer — so they render identically in the queue (pill) and the
// detail modal (banner). Pure and React-free so vitest can exercise it.
//
// Stock classification reuses lineStockStatus (poInboxStock.ts). A line that
// is merely "low" but still fully fillable is NOT an issue here — only
// out-of-stock or short-of-ordered lines are.

import { lineStockStatus } from './poInboxStock'

export type PoIssueKind =
  | 'sender_mismatch'
  | 'customer_name_mismatch'
  | 'stock'
  | 'unresolved_lines'
  | 'no_customer'

export interface PoIssue {
  kind: PoIssueKind
  severity: 'warn' | 'error'
  label: string
  detail: string
}

export interface PoIssueLine {
  /** Did this line resolve to a product? Unresolved lines have no inventory. */
  resolved: boolean
  /** Current inventory of the resolved product, or null when unresolved/unknown. */
  inventory: number | null
  /** Ordered quantity (selling units). */
  ordered: number
}

export interface PoIssueInputs {
  hasCustomer: boolean
  /** Sender-mismatch payload (from senderMismatch()), or null when fine. */
  senderMismatch: { sender: string | null } | null
  /**
   * Document/customer name-mismatch payload (from customerNameMismatch()), or
   * null when fine. Optional so existing callers keep compiling.
   */
  customerNameMismatch?: { documentName: string | null; matchedName: string | null } | null
  lines: PoIssueLine[]
  lowThreshold: number
}

export function computePoIssues(input: PoIssueInputs): PoIssue[] {
  const issues: PoIssue[] = []

  // Error-level first so the most serious problem leads.
  if (input.senderMismatch) {
    const sender = input.senderMismatch.sender ?? 'An unknown address'
    issues.push({
      kind: 'sender_mismatch',
      severity: 'error',
      label: 'Sender mismatch',
      detail: `${sender} is not a known address for this customer. Verify the sender is genuine before approving.`,
    })
  }

  if (input.customerNameMismatch) {
    const doc = input.customerNameMismatch.documentName ?? 'A different company'
    const matched = input.customerNameMismatch.matchedName ?? 'the selected customer'
    issues.push({
      kind: 'customer_name_mismatch',
      severity: 'error',
      label: 'Different customer on document',
      detail: `The document is addressed from ${doc}, but this PO is being booked against ${matched}. Confirm the customer before approving.`,
    })
  }

  if (!input.hasCustomer) {
    issues.push({
      kind: 'no_customer',
      severity: 'warn',
      label: 'No customer matched',
      detail: 'Pick a HoReCa customer for this PO before approving.',
    })
  }

  const unresolvedCount = input.lines.filter(l => !l.resolved).length
  if (unresolvedCount > 0) {
    issues.push({
      kind: 'unresolved_lines',
      severity: 'warn',
      label: 'Unresolved line(s)',
      detail: `${unresolvedCount} line${unresolvedCount > 1 ? 's' : ''} not matched to a product yet.`,
    })
  }

  // Stock: only resolved lines have inventory to check. A line is a stock
  // issue when it cannot be fully filled (out_of_stock or insufficient).
  let anyOut = false
  let shortCount = 0
  for (const line of input.lines) {
    if (!line.resolved || line.inventory == null) continue
    const status = lineStockStatus(line.inventory, line.ordered, input.lowThreshold)
    if (status.kind === 'out_of_stock') {
      anyOut = true
      shortCount++
    } else if (status.kind === 'insufficient') {
      shortCount++
    }
  }
  if (shortCount > 0) {
    issues.push({
      kind: 'stock',
      severity: 'warn',
      label: anyOut ? 'Out of stock' : 'Short on stock',
      detail: `${shortCount} line${shortCount > 1 ? 's' : ''} cannot be fully filled from current inventory.`,
    })
  }

  return issues
}
