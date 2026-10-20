import { describe, it, expect } from 'vitest'
import {
  DAILY_SECONDS,
  MIN_START_SECONDS,
  SESSION_CAP_SECONDS,
  START_BURST_PER_HOUR,
  maxSecondsForNewSession,
  remainingSeconds,
  rowsBefore,
  secondsUsedToday,
} from '../../supabase/functions/_shared/voice/budget'
import type { IdentifiedLedgerRow, LedgerRow } from '../../supabase/functions/_shared/voice/budget'

const NOW = new Date('2026-10-20T10:00:00.000Z')
const HOUR = 3_600_000
const DAY = 24 * HOUR

function at(msBeforeNow: number): string {
  return new Date(NOW.getTime() - msBeforeNow).toISOString()
}

function closed(startedAgoMs: number, seconds: number): LedgerRow {
  const start = NOW.getTime() - startedAgoMs
  return {
    startedAt: new Date(start).toISOString(),
    endedAt: new Date(start + seconds * 1000).toISOString(),
  }
}

function open(startedAgoMs: number): LedgerRow {
  return { startedAt: at(startedAgoMs), endedAt: null }
}

describe('budget constants', () => {
  it('pins the agreed limits', () => {
    expect(DAILY_SECONDS).toBe(1800)
    expect(SESSION_CAP_SECONDS).toBe(900)
    expect(START_BURST_PER_HOUR).toBe(10)
    expect(MIN_START_SECONDS).toBe(60)
  })

  it('keeps them in a sensible order', () => {
    expect(MIN_START_SECONDS).toBeLessThan(SESSION_CAP_SECONDS)
    expect(SESSION_CAP_SECONDS).toBeLessThan(DAILY_SECONDS)
  })
})

describe('secondsUsedToday', () => {
  it('is zero with no sessions', () => {
    expect(secondsUsedToday([], NOW)).toBe(0)
  })

  it('counts an open session at the full session cap', () => {
    // It has only been running for ten seconds, but nobody has closed it, so
    // the ledger must assume the worst.
    expect(secondsUsedToday([open(10_000)], NOW)).toBe(SESSION_CAP_SECONDS)
  })

  it('counts a closed session for its real length', () => {
    expect(secondsUsedToday([closed(HOUR, 125)], NOW)).toBe(125)
  })

  it('caps a closed session at the session cap', () => {
    expect(secondsUsedToday([closed(3 * HOUR, 7200)], NOW)).toBe(SESSION_CAP_SECONDS)
  })

  it('adds sessions together, open and closed', () => {
    const rows = [closed(5 * HOUR, 100), closed(3 * HOUR, 200), open(60_000)]
    expect(secondsUsedToday(rows, NOW)).toBe(100 + 200 + SESSION_CAP_SECONDS)
  })

  it('counts a session that started 23 hours 59 minutes ago', () => {
    expect(secondsUsedToday([closed(DAY - 60_000, 300)], NOW)).toBe(300)
  })

  it('counts a session that started exactly 24 hours ago', () => {
    expect(secondsUsedToday([closed(DAY, 300)], NOW)).toBe(300)
  })

  it('ignores a session that started one millisecond over 24 hours ago', () => {
    expect(secondsUsedToday([closed(DAY + 1, 300)], NOW)).toBe(0)
  })

  it('lets an abandoned open session age out after 24 hours', () => {
    expect(secondsUsedToday([open(DAY + 1)], NOW)).toBe(0)
    expect(secondsUsedToday([open(DAY - 1)], NOW)).toBe(SESSION_CAP_SECONDS)
  })

  it('uses the start time, not the end time, to place a session in the window', () => {
    // Started 25 h ago and ended 23 h 50 m ago: it began outside the window.
    const row: LedgerRow = { startedAt: at(25 * HOUR), endedAt: at(23 * HOUR + 50 * 60_000) }
    expect(secondsUsedToday([row], NOW)).toBe(0)
  })

  it('counts a session whose start is slightly in the future (clock skew)', () => {
    const row: LedgerRow = {
      startedAt: new Date(NOW.getTime() + 5000).toISOString(),
      endedAt: new Date(NOW.getTime() + 65_000).toISOString(),
    }
    expect(secondsUsedToday([row], NOW)).toBe(60)
  })

  it('treats a session that ends before it starts as zero seconds', () => {
    const row: LedgerRow = { startedAt: at(HOUR), endedAt: at(HOUR + 30_000) }
    expect(secondsUsedToday([row], NOW)).toBe(0)
  })

  it('rounds a partial second up', () => {
    const start = NOW.getTime() - HOUR
    const row: LedgerRow = {
      startedAt: new Date(start).toISOString(),
      endedAt: new Date(start + 10_001).toISOString(),
    }
    expect(secondsUsedToday([row], NOW)).toBe(11)
  })

  it('rejects a timestamp it cannot read rather than guessing', () => {
    expect(() => secondsUsedToday([{ startedAt: 'not a date', endedAt: null }], NOW)).toThrow(RangeError)
    expect(() => secondsUsedToday([{ startedAt: at(HOUR), endedAt: 'nonsense' }], NOW)).toThrow(RangeError)
  })

  it('does not change the rows it is given', () => {
    const rows = [open(1000), closed(HOUR, 60)]
    const before = JSON.stringify(rows)
    secondsUsedToday(rows, NOW)
    expect(JSON.stringify(rows)).toBe(before)
  })
})

describe('remainingSeconds', () => {
  it('is the whole daily allowance when nothing has been used', () => {
    expect(remainingSeconds([], NOW)).toBe(DAILY_SECONDS)
  })

  it('subtracts what has been used', () => {
    expect(remainingSeconds([closed(HOUR, 600)], NOW)).toBe(DAILY_SECONDS - 600)
  })

  it('never goes below zero', () => {
    const rows = [open(1000), open(2000), open(3000)]
    expect(remainingSeconds(rows, NOW)).toBe(0)
  })

  it('is zero when the allowance is exactly spent', () => {
    expect(remainingSeconds([open(1000), open(2000)], NOW)).toBe(0)
  })
})

describe('maxSecondsForNewSession', () => {
  it('is the session cap on an untouched day', () => {
    expect(maxSecondsForNewSession([], NOW)).toBe(SESSION_CAP_SECONDS)
  })

  it('is what is left of the day when that is under the cap', () => {
    expect(maxSecondsForNewSession([closed(HOUR, 900), closed(2 * HOUR, 600)], NOW)).toBe(300)
  })

  it('is still the session cap while more than the cap remains', () => {
    expect(maxSecondsForNewSession([closed(HOUR, 100)], NOW)).toBe(SESSION_CAP_SECONDS)
  })

  it('is zero once the day is spent', () => {
    expect(maxSecondsForNewSession([open(1000), open(2000)], NOW)).toBe(0)
  })

  it('shrinks while an earlier session is still open', () => {
    const rows = [open(30_000), closed(HOUR, 400)]
    expect(maxSecondsForNewSession(rows, NOW)).toBe(DAILY_SECONDS - SESSION_CAP_SECONDS - 400)
  })
})

// Concurrent starts: each start inserts its open row, re-reads the ledger and
// counts only the rows that sort strictly before its own (earlier startedAt,
// tie-break by id), so of two simultaneous starts exactly one sees the other.
describe('rowsBefore', () => {
  const ID_A = '11111111-1111-4111-8111-111111111111'
  const ID_B = '22222222-2222-4222-8222-222222222222'

  function row(id: string, startedAgoMs: number, endedAfterSeconds: number | null = null): IdentifiedLedgerRow {
    const start = NOW.getTime() - startedAgoMs
    return {
      id,
      startedAt: new Date(start).toISOString(),
      endedAt: endedAfterSeconds === null ? null : new Date(start + endedAfterSeconds * 1000).toISOString(),
    }
  }

  it('orders two rows with the same startedAt by id', () => {
    const a = row(ID_A, 1000)
    const b = row(ID_B, 1000)
    expect(rowsBefore([a, b], b).map((r) => r.id)).toEqual([ID_A])
    expect(rowsBefore([a, b], a)).toEqual([])
  })

  it('lets a later row see an earlier open row at the full session cap', () => {
    const earlier = row(ID_B, 2000)
    const later = row(ID_A, 1000)
    const before = rowsBefore([earlier, later], later)
    expect(before.map((r) => r.id)).toEqual([ID_B])
    expect(secondsUsedToday(before, NOW)).toBe(SESSION_CAP_SECONDS)
  })

  it('does not let the earlier row see the later one', () => {
    const earlier = row(ID_B, 2000)
    const later = row(ID_A, 1000)
    expect(rowsBefore([earlier, later], earlier)).toEqual([])
    expect(remainingSeconds(rowsBefore([earlier, later], earlier), NOW)).toBe(DAILY_SECONDS)
  })

  it('never counts the row itself', () => {
    const mine = row(ID_A, 1000)
    expect(rowsBefore([mine], mine)).toEqual([])
  })

  it('still grants a legitimately low allowance when nothing sorts before the row', () => {
    // 1740 s used by closed sessions earlier today leaves exactly 60 s.
    const used1 = row(ID_B, 5 * HOUR, 900)
    const used2 = row('33333333-3333-4333-8333-333333333333', 4 * HOUR, 840)
    const mine = row(ID_A, 1000)
    const remaining = remainingSeconds(rowsBefore([used1, used2, mine], mine), NOW)
    expect(remaining).toBe(MIN_START_SECONDS)
    expect(remaining >= MIN_START_SECONDS).toBe(true)
  })

  it('refuses the second of two concurrent starts that would overshoot', () => {
    // 900 s used earlier; two simultaneous starts each see 900 s left alone,
    // but the later one also sees the earlier open row at the cap: 0 left.
    const used = row('33333333-3333-4333-8333-333333333333', 5 * HOUR, 900)
    const first = row(ID_A, 1000)
    const second = row(ID_B, 1000)
    const all = [used, first, second]
    expect(remainingSeconds(rowsBefore(all, first), NOW)).toBe(900)
    expect(remainingSeconds(rowsBefore(all, second), NOW)).toBe(0)
  })

  it('does not change the rows it is given', () => {
    const rows = [row(ID_B, 1000), row(ID_A, 2000)]
    const before = JSON.stringify(rows)
    rowsBefore(rows, rows[0])
    expect(JSON.stringify(rows)).toBe(before)
  })
})
