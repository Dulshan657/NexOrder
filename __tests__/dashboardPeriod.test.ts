// The Admin Dashboard's period toggle and Nex must mean the same days by
// "today", "this week" and "this month". Both now come from lib/period, which
// works in the app's time zone (Sydney) whatever the browser's own zone is.
// Before this, the dashboard built them in the BROWSER's zone and started the
// week on Sunday, while Nex started it on Monday in Sydney.

import { describe, expect, it } from 'vitest'
import { dashboardRange, resolvePeriod } from '../lib/period'

// Tuesday 20 Oct 2026, 15:00 in Sydney (AEDT, UTC+11).
const NOW = new Date('2026-10-20T04:00:00.000Z')

describe('dashboardRange', () => {
  it('starts This Week on Monday at Sydney midnight, like Nex', () => {
    const range = dashboardRange('this_week', NOW)
    const nex = resolvePeriod('this_week', NOW)
    expect(range.from.toISOString()).toBe('2026-10-18T13:00:00.000Z')
    expect(range.from).toEqual(nex.from)
    expect(range.to).toEqual(nex.to)
  })

  it('uses the same Today and This Month windows as Nex, previous period included', () => {
    for (const period of ['today', 'this_month'] as const) {
      const nex = resolvePeriod(period, NOW)
      expect(dashboardRange(period, NOW)).toEqual({ from: nex.from, to: nex.to, previous: nex.previous })
    }
    expect(dashboardRange('this_month', NOW).from.toISOString()).toBe('2026-09-30T14:00:00.000Z')
  })

  it('reads a custom range as whole Sydney days', () => {
    const range = dashboardRange('custom', NOW, '2026-10-01', '2026-10-07')
    expect(range.from.toISOString()).toBe('2026-09-30T14:00:00.000Z')
    expect(range.to.toISOString()).toBe('2026-10-07T12:59:59.999Z')
  })

  it('falls back to the last 30 days when a custom range is incomplete or reversed', () => {
    const fallback = resolvePeriod('last_30_days', NOW)
    expect(dashboardRange('custom', NOW, '', '2026-10-07')).toMatchObject({ from: fallback.from, to: fallback.to })
    expect(dashboardRange('custom', NOW, '2026-10-09', '2026-10-01')).toMatchObject({ from: fallback.from, to: fallback.to })
  })
})
