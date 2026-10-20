// Spoken periods ("this week", "last month") turned into exact instants.
//
// Everything is UTC, for the reason lib/semantic/filter.ts gives: order dates
// are grouped on their UTC day, so a window edge that moved with the viewer's
// timezone would disagree with the day labels beside it. The whole-day
// boundaries come from the semantic layer's own `dayRange`, so a voice answer
// and a dashboard asking the same question cannot differ by a second.
//
// `previous` is the window of EQUAL LENGTH immediately before the current one,
// touching it with no gap and no overlap. "This week so far" (Mon to Wed) is
// therefore compared with the same number of days before Monday, not with last
// week's Mon to Wed.

import { dayRange } from '@/lib/semantic'

export type PeriodName = 'today' | 'this_week' | 'this_month' | 'last_month' | 'last_30_days' | 'custom'

export interface CustomRange {
  readonly from?: string
  readonly to?: string
}

export interface DateWindow {
  from: Date
  to: Date
}

export interface ResolvedPeriod extends DateWindow {
  previous: DateWindow
  /** Spoken description including the dates, e.g. "this week (19 Oct to 21 Oct 2026)". */
  label: string
}

const DAY_MS = 86_400_000
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const
const YMD = /^(\d{4})-(\d{2})-(\d{2})$/

/** `YYYY-MM-DD` of the UTC day containing `date`. */
function ymdOf(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS)
}

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
}

/** A real calendar date as UTC midnight, or null. "2026-02-30" is not one. */
export function parseYmd(value: string): Date | null {
  const match = YMD.exec(value)
  if (!match) return null
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])]
  const date = new Date(Date.UTC(year, month - 1, day))
  const real = date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  return real ? date : null
}

function formatDay(date: Date, withYear: boolean): string {
  const text = `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]}`
  return withYear ? `${text} ${date.getUTCFullYear()}` : text
}

/** "20 Oct 2026", "19 Oct to 21 Oct 2026", or "28 Dec 2025 to 3 Jan 2026". */
export function formatRange(from: Date, to: Date): string {
  if (ymdOf(from) === ymdOf(to)) return formatDay(from, true)
  if (from.getUTCFullYear() === to.getUTCFullYear()) return `${formatDay(from, false)} to ${formatDay(to, true)}`
  return `${formatDay(from, true)} to ${formatDay(to, true)}`
}

function requireCustomRange(custom: CustomRange | undefined): { from: Date; to: Date } {
  if (!custom?.from || !custom.to) throw new Error('A custom period needs from and to as YYYY-MM-DD')
  const from = parseYmd(custom.from)
  const to = parseYmd(custom.to)
  if (!from || !to) throw new Error('Custom dates must be real dates written YYYY-MM-DD')
  if (from.getTime() > to.getTime()) throw new Error('The custom from date is before the to date')
  return { from, to }
}

/** The first and last UTC calendar day a named period covers, as dates at midnight. */
function calendarDays(period: PeriodName, now: Date, custom?: CustomRange): { from: Date; to: Date; label: string } {
  const today = startOfUtcDay(now)
  const year = now.getUTCFullYear()
  const month = now.getUTCMonth()
  switch (period) {
    case 'today':
      return { from: today, to: today, label: 'today' }
    case 'this_week': {
      const sinceMonday = (now.getUTCDay() + 6) % 7
      return { from: addDays(today, -sinceMonday), to: today, label: 'this week' }
    }
    case 'this_month':
      return { from: new Date(Date.UTC(year, month, 1)), to: today, label: 'this month' }
    case 'last_month':
      return { from: new Date(Date.UTC(year, month - 1, 1)), to: new Date(Date.UTC(year, month, 0)), label: 'last month' }
    case 'last_30_days':
      return { from: addDays(today, -29), to: today, label: 'the last 30 days' }
    case 'custom':
      return { ...requireCustomRange(custom), label: 'custom range' }
    default:
      throw new RangeError(`Unknown period: ${String(period)}`)
  }
}

/**
 * Resolve a period against `now`. Throws on a custom range that is missing,
 * reversed or not a real date; runVoiceTool validates arguments first, so that
 * is a programming error by the time it gets here.
 */
export function resolvePeriod(period: PeriodName, now: Date, custom?: CustomRange): ResolvedPeriod {
  if (Number.isNaN(now.getTime())) throw new RangeError('now is not a valid date')
  const days = calendarDays(period, now, custom)
  const current = dayRange(ymdOf(days.from), ymdOf(days.to))
  const length = Math.round((current.to.getTime() - current.from.getTime() + 1) / DAY_MS)
  const previous = {
    from: addDays(current.from, -length),
    to: new Date(current.from.getTime() - 1),
  }
  const label = `${days.label} (${formatRange(current.from, current.to)})`
  return { from: current.from, to: current.to, previous, label }
}
