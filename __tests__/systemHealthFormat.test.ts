import { describe, it, expect } from 'vitest'
import { uptimePercent, latencySeries, formatSha, statusTone } from '../components/admin/systemHealthFormat'
import type { HealthCheckRow, HealthStatus } from '../services/supabase/systemHealthService'

function row(overrides: Partial<HealthCheckRow> & { checked_at: string }): HealthCheckRow {
  return {
    id: crypto.randomUUID(),
    status: 'ok',
    db_latency_ms: 50,
    frontend_ok: true,
    frontend_version: 'abc1234',
    error_count_10m: 0,
    error: null,
    metadata: {},
    ...overrides,
  }
}

function minutesAgo(n: number): string {
  return new Date(Date.now() - n * 60_000).toISOString()
}

describe('uptimePercent', () => {
  it('returns null for an empty window (no data is not 100%)', () => {
    expect(uptimePercent([], 24)).toBeNull()
    // rows exist but all outside the window
    expect(uptimePercent([row({ checked_at: minutesAgo(48 * 60) })], 24)).toBeNull()
  })

  it('is 100 when every check in the window is ok', () => {
    const rows = [row({ checked_at: minutesAgo(10) }), row({ checked_at: minutesAgo(20) })]
    expect(uptimePercent(rows, 24)).toBe(100)
  })

  it('counts degraded as up but down as outage', () => {
    const rows = [
      row({ checked_at: minutesAgo(5), status: 'ok' }),
      row({ checked_at: minutesAgo(10), status: 'degraded' }),
      row({ checked_at: minutesAgo(15), status: 'down' }),
      row({ checked_at: minutesAgo(20), status: 'down' }),
    ]
    expect(uptimePercent(rows, 24)).toBe(50)
  })

  it('only considers rows inside the trailing window', () => {
    const rows = [
      row({ checked_at: minutesAgo(30), status: 'ok' }),
      row({ checked_at: minutesAgo(25 * 60), status: 'down' }), // outside 24h
    ]
    expect(uptimePercent(rows, 24)).toBe(100)
  })
})

describe('latencySeries', () => {
  it('returns points oldest -> newest and skips rows without latency', () => {
    const rows = [
      row({ checked_at: minutesAgo(5), db_latency_ms: 30 }),
      row({ checked_at: minutesAgo(15), db_latency_ms: null }),
      row({ checked_at: minutesAgo(10), db_latency_ms: 20 }),
    ]
    const series = latencySeries(rows, 10)
    expect(series.map((p) => p.latencyMs)).toEqual([20, 30])
  })

  it('downsamples evenly to the requested point budget', () => {
    const rows = Array.from({ length: 100 }, (_, i) =>
      row({ checked_at: minutesAgo(100 - i), db_latency_ms: i }),
    )
    const series = latencySeries(rows, 10)
    expect(series).toHaveLength(10)
    expect(series[0].latencyMs).toBe(0)
    // strictly increasing sample of an increasing series
    for (let i = 1; i < series.length; i++) {
      expect(series[i].latencyMs).toBeGreaterThan(series[i - 1].latencyMs)
    }
  })

  it('passes through when there are fewer rows than points', () => {
    const rows = [row({ checked_at: minutesAgo(1), db_latency_ms: 7 })]
    expect(latencySeries(rows, 48)).toEqual([{ checkedAt: rows[0].checked_at, latencyMs: 7 }])
  })
})

describe('formatSha', () => {
  it('shortens full shas to 7 chars', () => {
    expect(formatSha('ba78272fe20d6aff0e5cfc06ae627442e272936f')).toBe('ba78272')
  })
  it('passes through short markers and handles null', () => {
    expect(formatSha('dev')).toBe('dev')
    expect(formatSha(null)).toBe('—')
    expect(formatSha(undefined)).toBe('—')
  })
})

describe('statusTone', () => {
  it('maps every status to a distinct tone and defaults unknown to stone', () => {
    const tones = (['ok', 'degraded', 'down'] as HealthStatus[]).map((s) => statusTone(s).dot)
    expect(new Set(tones).size).toBe(3)
    expect(statusTone(null).dot).toContain('stone')
  })
})
