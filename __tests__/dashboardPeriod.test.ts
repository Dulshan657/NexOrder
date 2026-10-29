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

  // NX-0010: compare with the SAME POINT last period. NOW is Tue 20 Oct, 15:00
  // in Sydney (AEDT, UTC+11); daylight time began on Sun 4 Oct.
  it('compares today so far with yesterday up to the same time', () => {
    const range = dashboardRange('today', NOW)
    expect(range.from.toISOString()).toBe('2026-10-19T13:00:00.000Z') // Tue 00:00
    expect(range.to.toISOString()).toBe('2026-10-20T12:59:59.999Z') // end of Tue: later orders still count
    expect(range.previous.from.toISOString()).toBe('2026-10-18T13:00:00.000Z') // Mon 00:00
    expect(range.previous.to.toISOString()).toBe('2026-10-19T04:00:00.000Z') // Mon 15:00
  })

  it('compares this week so far with last week up to the same weekday and time', () => {
    const range = dashboardRange('this_week', NOW)
    expect(range.to.toISOString()).toBe('2026-10-20T12:59:59.999Z')
    expect(range.previous.from.toISOString()).toBe('2026-10-11T13:00:00.000Z') // Mon 12 Oct 00:00
    expect(range.previous.to.toISOString()).toBe('2026-10-13T04:00:00.000Z') // Tue 13 Oct 15:00
  })

  it('compares this month so far with last month up to the same day and time', () => {
    const range = dashboardRange('this_month', NOW)
    expect(range.to.toISOString()).toBe('2026-10-20T12:59:59.999Z')
    // 1 Sep 00:00 and 20 Sep 15:00 in Sydney, both standard time (UTC+10).
    expect(range.previous.from.toISOString()).toBe('2026-08-31T14:00:00.000Z')
    expect(range.previous.to.toISOString()).toBe('2026-09-20T05:00:00.000Z')
  })

  it('keeps counting orders placed after the dashboard was opened', () => {
    // The dashboard resolves its range once, when it opens. Ending the current
    // period at that instant froze it: an order arriving a minute later fell
    // outside Today until a reload (gate NO-GO on e54549c).
    const openedAt = NOW
    const later = new Date(NOW.getTime() + 60_000).getTime()
    for (const period of ['today', 'this_week', 'this_month'] as const) {
      const range = dashboardRange(period, openedAt)
      expect(later <= range.to.getTime(), period).toBe(true)
    }
  })

  it('never lets the comparison overlap the current period', () => {
    // 23:30 on Sun 5 Apr 2026, the 25-hour day daylight time ends: 23.5 h
    // since midnight, laid onto a 24-hour Saturday, would run past its end.
    const lateOnLongDay = new Date('2026-04-05T13:30:00.000Z')
    for (const period of ['today', 'this_week'] as const) {
      const range = dashboardRange(period, lateOnLongDay)
      expect(range.previous.to.getTime() < range.from.getTime(), period).toBe(true)
    }
  })

  it('ends the comparison at the end of a shorter previous month', () => {
    // Sat 31 Oct, 14:00 in Sydney: September has no 31st.
    const range = dashboardRange('this_month', new Date('2026-10-31T03:00:00.000Z'))
    expect(range.previous.from.toISOString()).toBe('2026-08-31T14:00:00.000Z')
    expect(range.previous.to.toISOString()).toBe('2026-09-30T13:59:59.999Z') // end of 30 Sep
  })
})
