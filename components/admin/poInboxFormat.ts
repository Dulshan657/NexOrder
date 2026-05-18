// Pure formatting helpers for the PO Inbox UI. Kept in a separate file
// so vitest can exercise them without mounting React components.

import type {
  PendingPoStatus,
  PendingPoSummaryRow,
} from '@/services/supabase/poInboxService'

export interface StatusTabSpec {
  key: PendingPoStatus | 'all'
  label: string
  description: string
}

export const PO_INBOX_TABS: ReadonlyArray<StatusTabSpec> = [
  {
    key: 'needs_review',
    label: 'Needs Review',
    description: 'Pending POs awaiting human approval',
  },
  {
    key: 'auto_approved',
    label: 'Auto Approved',
    description: 'High-confidence POs that became real orders automatically',
  },
  {
    key: 'approved',
    label: 'Approved',
    description: 'Manually approved by an operator',
  },
  {
    key: 'rejected',
    label: 'Rejected',
    description: 'Operator rejected (with reason recorded)',
  },
]

export interface StatusBadgeStyle {
  label: string
  className: string
}

export function statusBadge(status: PendingPoStatus): StatusBadgeStyle {
  switch (status) {
    case 'needs_review':
      return {
        label: 'Needs review',
        className: 'bg-amber-50 text-amber-800 border-amber-200',
      }
    case 'auto_approved':
      return {
        label: 'Auto-approved',
        className: 'bg-teal-50 text-teal-700 border-teal-200',
      }
    case 'approved':
      return {
        label: 'Approved',
        className: 'bg-emerald-50 text-emerald-700 border-emerald-200',
      }
    case 'rejected':
      return {
        label: 'Rejected',
        className: 'bg-rose-50 text-rose-700 border-rose-200',
      }
  }
}

export function confidenceBadgeStyle(confidence: number): string {
  if (confidence >= 0.95) return 'bg-emerald-50 text-emerald-700 border-emerald-200'
  if (confidence >= 0.75) return 'bg-amber-50 text-amber-800 border-amber-200'
  return 'bg-rose-50 text-rose-700 border-rose-200'
}

/**
 * Human-readable relative age. Mirrors the formatter on the Email
 * Accounts tab but is duplicated here so this tab has no cross-tab
 * import. Kept tiny to avoid pulling in date-fns.
 */
export function formatAge(iso: string, nowMs: number = Date.now()): string {
  const t = new Date(iso).getTime()
  if (!Number.isFinite(t)) return 'unknown'
  const sec = Math.round((nowMs - t) / 1000)
  if (sec < 60) return 'just now'
  if (sec < 3600) return `${Math.round(sec / 60)} min ago`
  if (sec < 86_400) return `${Math.round(sec / 3600)} h ago`
  return `${Math.round(sec / 86_400)} d ago`
}

/**
 * Sort rows for display: needs_review first (newest first within the
 * status), then everything else newest first. Used both inside a tab
 * (where every row has the same status) and on the "all" view.
 */
export function sortForDisplay(
  rows: PendingPoSummaryRow[],
): PendingPoSummaryRow[] {
  const statusOrder: Record<PendingPoStatus, number> = {
    needs_review: 0,
    auto_approved: 1,
    approved: 2,
    rejected: 3,
  }
  return [...rows].sort((a, b) => {
    const sa = statusOrder[a.status]
    const sb = statusOrder[b.status]
    if (sa !== sb) return sa - sb
    return new Date(b.received_at).getTime() - new Date(a.received_at).getTime()
  })
}
