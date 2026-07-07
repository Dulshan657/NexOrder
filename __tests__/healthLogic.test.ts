import { describe, it, expect } from 'vitest'
import {
  deriveStatus,
  shouldAlert,
  alertMessage,
  ERROR_SPIKE_THRESHOLD,
  type HealthStatus,
} from '../supabase/functions/_shared/healthLogic'

describe('deriveStatus', () => {
  it('is ok when everything is healthy', () => {
    expect(deriveStatus({ dbOk: true, frontendOk: true, errorCount: 0 })).toBe('ok')
  })

  it('is down whenever the DB ping fails, regardless of other signals', () => {
    expect(deriveStatus({ dbOk: false, frontendOk: true, errorCount: 0 })).toBe('down')
    expect(deriveStatus({ dbOk: false, frontendOk: false, errorCount: 0 })).toBe('down')
    expect(deriveStatus({ dbOk: false, frontendOk: true, errorCount: 999 })).toBe('down')
  })

  it('is degraded when the frontend is unreachable but the DB is fine', () => {
    expect(deriveStatus({ dbOk: true, frontendOk: false, errorCount: 0 })).toBe('degraded')
  })

  it('spike boundary: 9 errors is ok, 10 is degraded', () => {
    expect(ERROR_SPIKE_THRESHOLD).toBe(10)
    expect(deriveStatus({ dbOk: true, frontendOk: true, errorCount: ERROR_SPIKE_THRESHOLD - 1 })).toBe('ok')
    expect(deriveStatus({ dbOk: true, frontendOk: true, errorCount: ERROR_SPIKE_THRESHOLD })).toBe('degraded')
  })
})

describe('shouldAlert (transition matrix)', () => {
  const cases: Array<[HealthStatus | null, HealthStatus, boolean]> = [
    // first tick ever: only unhealthy states alert
    [null, 'ok', false],
    [null, 'degraded', true],
    [null, 'down', true],
    // steady states never re-alert
    ['ok', 'ok', false],
    ['degraded', 'degraded', false],
    ['down', 'down', false],
    // degradations alert
    ['ok', 'degraded', true],
    ['ok', 'down', true],
    ['degraded', 'down', true],
    // recoveries alert (including partial recovery)
    ['down', 'ok', true],
    ['down', 'degraded', true],
    ['degraded', 'ok', true],
  ]

  it.each(cases)('prev=%s next=%s => %s', (prev, next, expected) => {
    expect(shouldAlert(prev, next)).toBe(expected)
  })
})

describe('alertMessage', () => {
  const base = {
    dbOk: true,
    dbLatencyMs: 42,
    frontendOk: true,
    frontendVersion: 'abc1234',
    errorCount: 0,
    error: null,
  }

  it('describes recovery with the previous state', () => {
    const msg = alertMessage({ ...base, status: 'ok', previous: 'down' })
    expect(msg).toContain('recovered')
    expect(msg).toContain('down -> ok')
    expect(msg).toContain('42ms')
  })

  it('lists every failing cause for a down state', () => {
    const msg = alertMessage({
      ...base,
      status: 'down',
      previous: 'ok',
      dbOk: false,
      frontendOk: false,
      errorCount: ERROR_SPIKE_THRESHOLD,
    })
    expect(msg).toContain('DB ping failed')
    expect(msg).toContain('frontend unreachable')
    expect(msg).toContain(`${ERROR_SPIKE_THRESHOLD} client errors`)
  })

  it('falls back to the stored error summary when no structured cause exists', () => {
    const msg = alertMessage({ ...base, status: 'degraded', previous: 'ok', error: 'weird edge case' })
    expect(msg).toContain('weird edge case')
  })
})
