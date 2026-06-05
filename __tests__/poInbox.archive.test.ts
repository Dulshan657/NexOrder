import { describe, it, expect } from 'vitest'

import {
  ARCHIVE_AFTER_DAYS,
  ARCHIVABLE_STATUSES,
  archiveCutoffIso,
  isArchivable,
} from '../services/supabase/poArchive'

const DAY = 86_400_000
const NOW = Date.parse('2026-06-01T00:00:00.000Z')

describe('archive cutoff', () => {
  it('keeps the 30-day retention the spec calls out', () => {
    expect(ARCHIVE_AFTER_DAYS).toBe(30)
  })

  it('archives the three resolved states only', () => {
    expect(ARCHIVABLE_STATUSES).toEqual(['approved', 'auto_approved', 'rejected'])
  })

  it('archiveCutoffIso is exactly 30 days before now', () => {
    expect(archiveCutoffIso(NOW)).toBe(new Date(NOW - 30 * DAY).toISOString())
  })
})

describe('isArchivable', () => {
  const resolved = (daysAgo: number) => new Date(NOW - daysAgo * DAY).toISOString()

  it('never archives needs_review, regardless of age', () => {
    expect(isArchivable('needs_review', resolved(365), NOW)).toBe(false)
  })

  it('archives a resolved PO older than the cutoff', () => {
    for (const status of ARCHIVABLE_STATUSES) {
      expect(isArchivable(status, resolved(31), NOW)).toBe(true)
    }
  })

  it('keeps a resolved PO that is younger than the cutoff', () => {
    for (const status of ARCHIVABLE_STATUSES) {
      expect(isArchivable(status, resolved(29), NOW)).toBe(false)
    }
  })

  it('treats exactly 30 days old as still in the Queue (strictly older archives)', () => {
    // resolved exactly at the cutoff instant → not strictly older → not archived
    expect(isArchivable('approved', archiveCutoffIso(NOW), NOW)).toBe(false)
    // one millisecond older → archived
    expect(isArchivable('approved', new Date(NOW - 30 * DAY - 1).toISOString(), NOW)).toBe(true)
  })

  it('never archives a PO with no resolution timestamp', () => {
    expect(isArchivable('approved', null, NOW)).toBe(false)
    expect(isArchivable('approved', undefined, NOW)).toBe(false)
  })
})
