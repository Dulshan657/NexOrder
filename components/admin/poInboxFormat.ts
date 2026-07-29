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

/**
 * Normalise the builder named on a PO for display.
 *
 * Three distinct inputs all mean "no builder" and must collapse to one:
 * rows extracted before the field shipped (key absent -> null), documents with
 * no builder at all (model returns null), and documents that print a "Builder:"
 * heading with nothing under it (model returns an empty or blank string).
 * Extracted values also routinely carry surrounding whitespace, since the label
 * and value sit on separate lines in the source PDF.
 */
export function builderLabel(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
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

export type ConfidenceBandKey = 'high' | 'mid' | 'low'

export interface ConfidenceBand {
  key: ConfidenceBandKey
  /** CSS colour for the conic-gradient fill. */
  ringColor: string
  /** CSS colour for the unfilled track. */
  trackColor: string
  /** Tailwind class for the centred percentage text. */
  textClass: string
}

/** Unfilled track colour for the confidence ring (stone-tinted). */
const RING_TRACK = '#f1f0ee'

/**
 * Maps a 0..1 confidence to its colour band. Thresholds mirror the
 * existing `confidenceBadgeStyle` / per-row tone helpers so every
 * confidence surface agrees: >=0.95 emerald, >=0.75 amber, else rose.
 */
export function confidenceBand(confidence: number): ConfidenceBand {
  if (confidence >= 0.95) {
    return { key: 'high', ringColor: '#34d399', trackColor: RING_TRACK, textClass: 'text-emerald-700' }
  }
  if (confidence >= 0.75) {
    return { key: 'mid', ringColor: '#fbbf24', trackColor: RING_TRACK, textClass: 'text-amber-700' }
  }
  return { key: 'low', ringColor: '#f43f5e', trackColor: RING_TRACK, textClass: 'text-rose-700' }
}

// Short, human-readable labels for the per-field extraction confidences.
const CONFIDENCE_FIELD_LABELS: Record<string, string> = {
  po_number: 'PO #',
  customer_name_raw: 'Customer',
  order_date: 'Order date',
  requested_date: 'Req. date',
  ship_to: 'Ship-to',
  lines: 'Lines',
}

const pct = (n: unknown): string => `${Math.round((typeof n === 'number' && Number.isFinite(n) ? n : 0) * 100)}%`

/**
 * Concise hover-reasoning for the confidence ring. The overall score is the
 * MINIMUM of the per-field extraction confidences, so it skews to 0% / 100%;
 * this explains why — the weakest field(s) that drag it down, plus the gating
 * reasons for needs_review. Pure + tiny so it can be a `title` tooltip.
 *
 * Reads `pending_pos.confidence_fields` (`per_field`, `gating_reasons`).
 */
export function confidenceReasoning(
  confidenceOverall: number,
  fields: Record<string, unknown> | null | undefined,
): string {
  const lines: string[] = [`AI match confidence ${pct(confidenceOverall)}`]

  const per = fields?.per_field
  if (per && typeof per === 'object') {
    const entries = Object.entries(CONFIDENCE_FIELD_LABELS).filter(
      ([key]) => typeof (per as Record<string, unknown>)[key] === 'number',
    )
    if (entries.length > 0) {
      const min = Math.min(...entries.map(([key]) => (per as Record<string, number>)[key]))
      // Only call out the weak fields when something is dragging the score down.
      if (min < 1) {
        const weakest = entries
          .filter(([key]) => (per as Record<string, number>)[key] === min)
          .map(([key, label]) => `${label} ${pct((per as Record<string, number>)[key])}`)
        lines.push(`Lowest: ${weakest.join(', ')}`)
      }
    }
  }

  const reasons = fields?.gating_reasons
  if (Array.isArray(reasons) && reasons.length > 0) {
    lines.push(reasons.join('; '))
  }

  return lines.join('\n')
}
