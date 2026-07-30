// Shared PO auto-approval policy config (app_settings, mig 00044). Used by both
// the Settings → Automation tab and the PO Inbox header popover
// (AutoApprovalMenu) so the two surfaces can never drift.
//
// Four toggles, all default on (server fails open when a column is absent):
//   * po_auto_approve_enabled                    — master switch
//   * po_auto_approve_block_on_short_stock       — hold short-stock POs for review
//   * po_auto_approve_block_on_sender_mismatch   — hold spoofed-sender POs for review
//   * po_auto_approve_block_on_customer_mismatch — hold wrong-letterhead POs (mig 00088)

export type PolicyKey =
  | 'po_auto_approve_enabled'
  | 'po_auto_approve_block_on_short_stock'
  | 'po_auto_approve_block_on_sender_mismatch'
  | 'po_auto_approve_block_on_customer_mismatch'

export interface PolicyToggle {
  key: PolicyKey
  label: string
  help: string
  /** Sub-policies only matter while the master switch is on. */
  sub?: boolean
}

export const TOGGLES: readonly PolicyToggle[] = [
  {
    key: 'po_auto_approve_enabled',
    label: 'Auto-approve matching orders',
    help: 'Trusted sender, all items matched and high confidence → approved automatically.',
  },
  {
    key: 'po_auto_approve_block_on_short_stock',
    label: 'Hold for review when stock is short',
    help: "A PO that can't be fully filled from current inventory waits for a human.",
    sub: true,
  },
  {
    key: 'po_auto_approve_block_on_sender_mismatch',
    label: 'Hold for review on possible sender spoofing',
    help: 'A PO whose sender is not a known address for the customer waits for a human.',
    sub: true,
  },
  {
    key: 'po_auto_approve_block_on_customer_mismatch',
    label: 'Hold for review when the document names another company',
    help: "A PO whose letterhead doesn't match the customer it was matched to waits for a human.",
    sub: true,
  },
]

/** Absent column ⇒ default on (matches the server's fail-open behaviour). */
export function policyValue(
  settings: Record<string, unknown> | undefined,
  key: PolicyKey,
): boolean {
  return settings?.[key] !== false
}
