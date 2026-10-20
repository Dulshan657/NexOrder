import { describe, it, expect } from 'vitest'
import { formatRange, parseYmd, resolvePeriod } from '../../lib/voice/period'

const DAY_MS = 86_400_000
const at = (value: string): Date => new Date(value)
const startOf = (ymd: string): string => `${ymd}T00:00:00.000Z`
const endOf = (ymd: string): string => `${ymd}T23:59:59.999Z`
const lengthInDays = (w: { from: Date; to: Date }): number =>
  Math.round((w.to.getTime() - w.from.getTime() + 1) / DAY_MS)

function expectWindow(
  got: { from: Date; to: Date; previous: { from: Date; to: Date } },
  from: string,
  to: string,
  prevFrom: string,
  prevTo: string,
): void {
  expect(got.from.toISOString()).toBe(startOf(from))
  expect(got.to.toISOString()).toBe(endOf(to))
  expect(got.previous.from.toISOString()).toBe(startOf(prevFrom))
  expect(got.previous.to.toISOString()).toBe(endOf(prevTo))
}

describe('resolvePeriod', () => {
  describe('today', () => {
    it('is the whole UTC day, previous is yesterday', () => {
      const got = resolvePeriod('today', at('2026-10-21T09:30:00.000Z'))
      expectWindow(got, '2026-10-21', '2026-10-21', '2026-10-20', '2026-10-20')
      expect(got.label).toBe('today (21 Oct 2026)')
    })

    it('judges the day in UTC at the very edges of it', () => {
      expectWindow(
        resolvePeriod('today', at('2026-10-20T23:59:59.999Z')),
        '2026-10-20', '2026-10-20', '2026-10-19', '2026-10-19',
      )
      expectWindow(
        resolvePeriod('today', at('2026-10-21T00:00:00.000Z')),
        '2026-10-21', '2026-10-21', '2026-10-20', '2026-10-20',
      )
    })
  })

  describe('this_week', () => {
    it('runs Monday to today, previous is the same number of days before Monday', () => {
      // Wednesday: three days so far, so the previous window is Fri to Sun.
      const got = resolvePeriod('this_week', at('2026-10-21T09:30:00.000Z'))
      expectWindow(got, '2026-10-19', '2026-10-21', '2026-10-16', '2026-10-18')
      expect(got.label).toBe('this week (19 Oct to 21 Oct 2026)')
    })

    it('is a single day on a Monday', () => {
      const got = resolvePeriod('this_week', at('2026-10-19T00:00:00.000Z'))
      expectWindow(got, '2026-10-19', '2026-10-19', '2026-10-18', '2026-10-18')
    })

    it('is seven days on a Sunday', () => {
      const got = resolvePeriod('this_week', at('2026-10-25T23:59:59.999Z'))
      expectWindow(got, '2026-10-19', '2026-10-25', '2026-10-12', '2026-10-18')
      expect(lengthInDays(got)).toBe(7)
    })

    it('starts in the previous month when the week does', () => {
      const got = resolvePeriod('this_week', at('2026-09-02T10:00:00.000Z'))
      expect(got.from.toISOString()).toBe(startOf('2026-08-31'))
      expect(got.label).toBe('this week (31 Aug to 2 Sep 2026)')
    })
  })

  describe('this_month', () => {
    it('runs the 1st to today, previous is the same number of days before the 1st', () => {
      const got = resolvePeriod('this_month', at('2026-10-20T04:00:00.000Z'))
      expectWindow(got, '2026-10-01', '2026-10-20', '2026-09-11', '2026-09-30')
      expect(got.label).toBe('this month (1 Oct to 20 Oct 2026)')
    })

    it('is a single day on the 1st', () => {
      expectWindow(
        resolvePeriod('this_month', at('2026-10-01T12:00:00.000Z')),
        '2026-10-01', '2026-10-01', '2026-09-30', '2026-09-30',
      )
    })
  })

  describe('last_month', () => {
    it('is the whole previous calendar month, previous is the same number of days before it', () => {
      const got = resolvePeriod('last_month', at('2026-10-20T04:00:00.000Z'))
      expectWindow(got, '2026-09-01', '2026-09-30', '2026-08-02', '2026-08-31')
      expect(got.label).toBe('last month (1 Sep to 30 Sep 2026)')
    })

    it('crosses the year boundary in January', () => {
      const got = resolvePeriod('last_month', at('2026-01-15T00:00:00.000Z'))
      expectWindow(got, '2025-12-01', '2025-12-31', '2025-10-31', '2025-11-30')
      expect(got.label).toBe('last month (1 Dec to 31 Dec 2025)')
    })

    it('knows February is short', () => {
      const got = resolvePeriod('last_month', at('2026-03-10T00:00:00.000Z'))
      expectWindow(got, '2026-02-01', '2026-02-28', '2026-01-04', '2026-01-31')
      expect(lengthInDays(got)).toBe(28)
    })
  })

  describe('last_30_days', () => {
    it('is thirty whole days ending today', () => {
      const got = resolvePeriod('last_30_days', at('2026-10-20T04:00:00.000Z'))
      expectWindow(got, '2026-09-21', '2026-10-20', '2026-08-22', '2026-09-20')
      expect(lengthInDays(got)).toBe(30)
      expect(got.label).toBe('the last 30 days (21 Sep to 20 Oct 2026)')
    })

    it('has a previous window that touches it with no gap and no overlap', () => {
      const got = resolvePeriod('last_30_days', at('2026-10-20T04:00:00.000Z'))
      expect(got.previous.to.getTime() + 1).toBe(got.from.getTime())
      expect(lengthInDays(got.previous)).toBe(30)
    })
  })

  describe('custom', () => {
    const now = at('2026-10-20T04:00:00.000Z')

    it('uses the dates given, whole days at both ends', () => {
      const got = resolvePeriod('custom', now, { from: '2026-10-05', to: '2026-10-09' })
      expectWindow(got, '2026-10-05', '2026-10-09', '2026-09-30', '2026-10-04')
      expect(got.label).toBe('custom range (5 Oct to 9 Oct 2026)')
    })

    it('accepts a single day', () => {
      const got = resolvePeriod('custom', now, { from: '2026-10-05', to: '2026-10-05' })
      expectWindow(got, '2026-10-05', '2026-10-05', '2026-10-04', '2026-10-04')
      expect(got.label).toBe('custom range (5 Oct 2026)')
    })

    it('names both years when the range spans two', () => {
      const got = resolvePeriod('custom', now, { from: '2025-12-28', to: '2026-01-03' })
      expect(got.label).toBe('custom range (28 Dec 2025 to 3 Jan 2026)')
    })

    it('refuses a missing range', () => {
      expect(() => resolvePeriod('custom', now)).toThrow(/from and to/)
      expect(() => resolvePeriod('custom', now, { from: '2026-10-05' })).toThrow(/from and to/)
    })

    it('refuses a reversed range', () => {
      expect(() => resolvePeriod('custom', now, { from: '2026-10-09', to: '2026-10-05' })).toThrow(/before/)
    })

    it('refuses malformed and impossible dates', () => {
      expect(() => resolvePeriod('custom', now, { from: '05/10/2026', to: '09/10/2026' })).toThrow(/YYYY-MM-DD/)
      expect(() => resolvePeriod('custom', now, { from: '2026-02-30', to: '2026-03-02' })).toThrow(/YYYY-MM-DD/)
    })
  })

  it('refuses a clock that is not a real instant', () => {
    expect(() => resolvePeriod('today', new Date('nonsense'))).toThrow(/valid/)
  })

  it('does not modify the Date it is given', () => {
    const now = at('2026-10-21T09:30:00.000Z')
    resolvePeriod('this_week', now)
    expect(now.toISOString()).toBe('2026-10-21T09:30:00.000Z')
  })
})

describe('formatRange', () => {
  it('names one day once', () => {
    expect(formatRange(at(startOf('2026-10-20')), at(endOf('2026-10-20')))).toBe('20 Oct 2026')
  })

  it('shares the year when both ends are in it', () => {
    expect(formatRange(at(startOf('2026-09-21')), at(endOf('2026-10-20')))).toBe('21 Sep to 20 Oct 2026')
  })
})

describe('parseYmd', () => {
  it('reads a real calendar date as UTC midnight', () => {
    expect(parseYmd('2026-10-05')?.toISOString()).toBe(startOf('2026-10-05'))
    expect(parseYmd('2024-02-29')?.toISOString()).toBe(startOf('2024-02-29'))
  })

  it('refuses anything else', () => {
    for (const bad of ['2026-02-30', '2026-13-01', '2026-1-5', '05/10/2026', '2026-10-05T00:00:00Z', '', 'today']) {
      expect(parseYmd(bad)).toBeNull()
    }
  })
})
