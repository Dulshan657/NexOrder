import { describe, it, expect } from 'vitest'

import {
  confidenceBadgeStyle,
  formatAge,
  PO_INBOX_TABS,
  sortForDisplay,
  statusBadge,
} from '../components/admin/poInboxFormat'
import type {
  PendingPoStatus,
  PendingPoSummaryRow,
} from '../services/supabase/poInboxService'

const NOW = new Date('2026-05-18T12:00:00.000Z').getTime()

const baseRow = (overrides: Partial<PendingPoSummaryRow> = {}): PendingPoSummaryRow => ({
  id: 'po-1',
  status: 'needs_review',
  inbound_message_id: 'msg-1',
  matched_horeca_id: null,
  confidence_overall: 0.5,
  approved_order_id: null,
  reviewed_at: null,
  created_at: '2026-05-18T11:00:00Z',
  from_address: 'a@b.com',
  subject: 'PO',
  received_at: '2026-05-18T11:30:00Z',
  storage_path_prefix: 'po-archive/acct/msg',
  ...overrides,
})

describe('statusBadge', () => {
  it.each(['needs_review', 'auto_approved', 'approved', 'rejected'] as const)(
    'returns a label + className for %s',
    status => {
      const badge = statusBadge(status)
      expect(badge.label.length).toBeGreaterThan(0)
      expect(badge.className).toMatch(/bg-/)
    },
  )

  it('uses amber for needs_review (the most attention-grabbing tone)', () => {
    expect(statusBadge('needs_review').className).toContain('amber')
  })
})

describe('confidenceBadgeStyle', () => {
  it('uses emerald for confidence ≥0.95', () => {
    expect(confidenceBadgeStyle(0.95)).toContain('emerald')
    expect(confidenceBadgeStyle(1.0)).toContain('emerald')
  })

  it('uses amber for 0.75–0.94', () => {
    expect(confidenceBadgeStyle(0.85)).toContain('amber')
    expect(confidenceBadgeStyle(0.75)).toContain('amber')
  })

  it('uses rose for <0.75', () => {
    expect(confidenceBadgeStyle(0.5)).toContain('rose')
    expect(confidenceBadgeStyle(0)).toContain('rose')
  })
})

describe('formatAge', () => {
  it('returns "just now" within the first minute', () => {
    expect(formatAge(new Date(NOW - 30_000).toISOString(), NOW)).toBe('just now')
  })

  it('rounds to minutes / hours / days', () => {
    expect(formatAge(new Date(NOW - 5 * 60_000).toISOString(), NOW)).toBe('5 min ago')
    expect(formatAge(new Date(NOW - 2 * 3_600_000).toISOString(), NOW)).toBe('2 h ago')
    expect(formatAge(new Date(NOW - 3 * 86_400_000).toISOString(), NOW)).toBe('3 d ago')
  })

  it('handles unparseable input gracefully', () => {
    expect(formatAge('not a date', NOW)).toBe('unknown')
  })
})

describe('sortForDisplay', () => {
  it('places needs_review rows before resolved rows', () => {
    const input: PendingPoSummaryRow[] = [
      baseRow({ id: 'a', status: 'approved', received_at: '2026-05-18T12:00:00Z' }),
      baseRow({ id: 'b', status: 'needs_review', received_at: '2026-05-18T10:00:00Z' }),
    ]
    const out = sortForDisplay(input)
    expect(out.map(r => r.id)).toEqual(['b', 'a'])
  })

  it('within a status, sorts newest received first', () => {
    const input: PendingPoSummaryRow[] = [
      baseRow({ id: 'a', received_at: '2026-05-18T10:00:00Z' }),
      baseRow({ id: 'b', received_at: '2026-05-18T11:30:00Z' }),
      baseRow({ id: 'c', received_at: '2026-05-18T11:00:00Z' }),
    ]
    expect(sortForDisplay(input).map(r => r.id)).toEqual(['b', 'c', 'a'])
  })

  it('does not mutate the input', () => {
    const input: PendingPoSummaryRow[] = [baseRow({ id: 'a' }), baseRow({ id: 'b' })]
    const before = [...input]
    sortForDisplay(input)
    expect(input).toEqual(before)
  })

  it('handles every defined status', () => {
    const statuses: PendingPoStatus[] = ['needs_review', 'auto_approved', 'approved', 'rejected']
    const input = statuses.map((s, i) => baseRow({ id: String(i), status: s }))
    const out = sortForDisplay(input)
    // Lossless: same row count, same set of IDs.
    expect(out.map(r => r.id).sort()).toEqual(input.map(r => r.id).sort())
  })
})

describe('PO_INBOX_TABS', () => {
  it('exposes exactly the four operator-visible statuses', () => {
    expect(PO_INBOX_TABS.map(t => t.key)).toEqual([
      'needs_review',
      'auto_approved',
      'approved',
      'rejected',
    ])
  })

  it('every tab has a non-empty label and description', () => {
    for (const tab of PO_INBOX_TABS) {
      expect(tab.label).toBeTruthy()
      expect(tab.description).toBeTruthy()
    }
  })
})
