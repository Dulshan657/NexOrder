// The app's calendar: named periods ("today", "this week", "this month") and
// calendar days turned into exact instants.
//
// ONE calendar for every reader. Nex (lib/voice), the Admin Dashboard's period
// toggle, the order pipeline card and the semantic layer's day ranges and day
// buckets all resolve days here, so "this month" is the same set of orders
// whoever is asked. Until NX-0008 the dashboard built its windows in the
// BROWSER's zone with a Sunday week start and the semantic layer used UTC days,
// while Nex used Sydney days with a Monday week start.
//
// Calendar days are the APP TIME ZONE's (Australia/Sydney, _shared/voice/timeZone.ts),
// the same zone voice-session uses to tell the model today's date.
//
// A window is two exact instants, local midnight starting its first day and the
// last millisecond of its last day, so it plugs straight into an OrderFilter
// (whose from/to are instants, filter.ts). Local midnight is found through Intl,
// never a fixed offset: Sydney moves to UTC+11 at 02:00 on the first Sunday of
// October and back to UTC+10 at 03:00 on the first Sunday of April, so those
// two days are 23 and 25 hours long. No Sydney transition happens at midnight,
// so local midnight always exists and is unique.
//
// A period still in progress (today, this week, this month) is compared with
// the SAME POINT of the period before (NX-0010, owner's call):
// today until 3 pm against yesterday until 3 pm; Monday to Wednesday 3 pm
// against last Monday to last Wednesday 3 pm; 1 to 29 October against 1 to 29
// September, ending at the end of a shorter previous month. Comparing "so far"
// with a whole previous period made every morning's arrows point down.
//
// A finished period (last month, the last 30 days, a custom range) is compared
// with the window of EQUAL LENGTH IN DAYS immediately before it, touching it
// with no gap and no overlap.
//
// Internally a calendar day is carried as a Date at UTC midnight of that date
// (a "civil date"), only ever read with getUTC*. It is NOT an instant anything
// filters on.

import { APP_TIME_ZONE } from '@/supabase/functions/_shared/voice/timeZone'

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
const SECOND_MS = 1000
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const
const YMD = /^(\d{4})-(\d{2})-(\d{2})$/

const WALL_CLOCK = new Intl.DateTimeFormat('en-US', {
  timeZone: APP_TIME_ZONE,
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
})

/** The app-zone wall clock at `ms` (whole seconds), written as if it were a UTC instant. */
function wallClockAsUtc(ms: number): number {
  const parts: Record<string, number> = {}
  for (const part of WALL_CLOCK.formatToParts(new Date(ms))) {
    if (part.type !== 'literal') parts[part.type] = Number(part.value)
  }
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour % 24, parts.minute, parts.second)
}

/** The app zone's offset from UTC at instant `ms`, in milliseconds (+11 h in AEDT). */
function offsetAt(ms: number): number {
  const wholeSecond = Math.floor(ms / SECOND_MS) * SECOND_MS
  return wallClockAsUtc(wholeSecond) - wholeSecond
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS)
}

/** The civil date of the app-zone calendar day containing `instant`. */
function localDayOf(instant: Date): Date {
  const wall = wallClockAsUtc(instant.getTime())
  return new Date(wall - (((wall % DAY_MS) + DAY_MS) % DAY_MS))
}

/** The instant of app-zone midnight starting civil date `day`. */
function startOfLocalDay(day: Date): Date {
  // First guess with the offset at UTC midnight of the date, then correct with
  // the offset at the guess itself, which is the offset in force at local
  // midnight (Sydney changes offset at 02:00 or 03:00, never across midnight).
  const guess = day.getTime() - offsetAt(day.getTime())
  return new Date(day.getTime() - offsetAt(guess))
}

/** The last millisecond of the app-zone calendar day `day`. */
function endOfLocalDay(day: Date): Date {
  return new Date(startOfLocalDay(addDays(day, 1)).getTime() - 1)
}

/** The app-zone calendar date of an instant, as YYYY-MM-DD (a late-evening UTC order is the next day in Sydney). */
export function localYmd(instant: Date): string {
  return localDayOf(instant).toISOString().slice(0, 10)
}

/** A real calendar date as UTC midnight (a civil date), or null. "2026-02-30" is not one. */
export function parseYmd(value: string): Date | null {
  const match = YMD.exec(value)
  if (!match) return null
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])]
  const date = new Date(Date.UTC(year, month - 1, day))
  const real = date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  return real ? date : null
}

function formatCivil(day: Date, withYear: boolean): string {
  const text = `${day.getUTCDate()} ${MONTHS[day.getUTCMonth()]}`
  return withYear ? `${text} ${day.getUTCFullYear()}` : text
}

function formatCivilRange(from: Date, to: Date): string {
  if (from.getTime() === to.getTime()) return formatCivil(from, true)
  if (from.getUTCFullYear() === to.getUTCFullYear()) return `${formatCivil(from, false)} to ${formatCivil(to, true)}`
  return `${formatCivil(from, true)} to ${formatCivil(to, true)}`
}

/**
 * The app-zone calendar days two instants fall on: "20 Oct 2026",
 * "19 Oct to 21 Oct 2026", or "28 Dec 2025 to 3 Jan 2026".
 */
export function formatRange(from: Date, to: Date): string {
  return formatCivilRange(localDayOf(from), localDayOf(to))
}

function requireCustomRange(custom: CustomRange | undefined): { from: Date; to: Date } {
  if (!custom?.from || !custom.to) throw new Error('A custom period needs from and to as YYYY-MM-DD')
  const from = parseYmd(custom.from)
  const to = parseYmd(custom.to)
  if (!from || !to) throw new Error('Custom dates must be real dates written YYYY-MM-DD')
  if (from.getTime() > to.getTime()) throw new Error('The custom from date is before the to date')
  return { from, to }
}

/** The first and last app-zone calendar day a named period covers, as civil dates. */
function calendarDays(period: PeriodName, now: Date, custom?: CustomRange): { from: Date; to: Date; label: string } {
  const today = localDayOf(now)
  const year = today.getUTCFullYear()
  const month = today.getUTCMonth()
  switch (period) {
    case 'today':
      return { from: today, to: today, label: 'today' }
    case 'this_week': {
      const sinceMonday = (today.getUTCDay() + 6) % 7
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

/** Local midnight starting `first` to the last millisecond of `last`. */
function localWindow(first: Date, last: Date): DateWindow {
  return { from: startOfLocalDay(first), to: endOfLocalDay(last) }
}

/**
 * Resolve a period against `now`. Throws on a custom range that is missing,
 * reversed or not a real date; runVoiceTool validates arguments first, so that
 * is a programming error by the time it gets here.
 */
export function resolvePeriod(period: PeriodName, now: Date, custom?: CustomRange): ResolvedPeriod {
  if (Number.isNaN(now.getTime())) throw new RangeError('now is not a valid date')
  const days = calendarDays(period, now, custom)
  const label = `${days.label} (${formatCivilRange(days.from, days.to)})`
  const sameSpanBefore = inProgressPrevious(period, days.from, now)
  if (sameSpanBefore) {
    // The current window still ends at the END OF TODAY, not at `now`: a caller
    // that resolves once (the dashboard) would otherwise stop counting orders
    // that arrive after it did, and a date-only value dated today (a route,
    // read as UTC midnight = 10 or 11 am here) would sit outside "today" all
    // morning. Nothing is placed in the future, so the counts are the same.
    return { ...localWindow(days.from, days.to), previous: sameSpanBefore, label }
  }
  const length = Math.round((days.to.getTime() - days.from.getTime()) / DAY_MS) + 1
  const current = localWindow(days.from, days.to)
  const previous = localWindow(addDays(days.from, -length), addDays(days.from, -1))
  return { from: current.from, to: current.to, previous, label }
}

/**
 * For a period still in progress, the previous period up to the same point:
 * its first day's midnight to the same time of day on the matching day, or the
 * end of a previous month too short to have that day. Null for a finished period.
 *
 * "The same time of day" is the time elapsed since local midnight today, laid
 * onto the matching day; on the two daylight-saving change days that is an hour
 * off the wall clock, which no daily comparison can avoid.
 */
function inProgressPrevious(period: PeriodName, first: Date, now: Date): DateWindow | null {
  const today = localDayOf(now)
  const sinceMidnight = now.getTime() - startOfLocalDay(today).getTime()
  let previousFirst: Date
  let matchingDay: Date
  switch (period) {
    case 'today':
      previousFirst = addDays(today, -1)
      matchingDay = previousFirst
      break
    case 'this_week':
      previousFirst = addDays(first, -7)
      matchingDay = addDays(today, -7)
      break
    case 'this_month': {
      const year = today.getUTCFullYear()
      const month = today.getUTCMonth()
      previousFirst = new Date(Date.UTC(year, month - 1, 1))
      const lastOfPrevious = new Date(Date.UTC(year, month, 0))
      if (today.getUTCDate() > lastOfPrevious.getUTCDate()) {
        return { from: startOfLocalDay(previousFirst), to: endOfLocalDay(lastOfPrevious) }
      }
      matchingDay = new Date(Date.UTC(year, month - 1, today.getUTCDate()))
      break
    }
    default:
      return null
  }
  // Capped at the end of the matching day: on the 25-hour day daylight time
  // ends, the hours since midnight can outrun a 24-hour day and the window
  // would overlap the current one.
  const sameTime = startOfLocalDay(matchingDay).getTime() + sinceMidnight
  return {
    from: startOfLocalDay(previousFirst),
    to: new Date(Math.min(sameTime, endOfLocalDay(matchingDay).getTime())),
  }
}

/**
 * The app-zone calendar date (YYYY-MM-DD) of an instant given as a Date or an ISO
 * string. Used to bucket orders by the day they were placed in Sydney.
 */
export function appDateKey(instant: Date | string): string {
  const date = typeof instant === 'string' ? new Date(instant) : instant
  return localYmd(date)
}

/**
 * Two calendar dates, inclusive, as instants: app-zone midnight starting `from`
 * to the last millisecond of `to`. A `YYYY-MM-DD` string is read as that calendar
 * date; a Date as the app-zone day it falls on. An unparseable string falls back
 * to whatever `new Date` makes of it, so a bad input yields an empty range
 * rather than a throw (the dashboards feed this straight from date inputs).
 */
export function appDayRange(from: Date | string, to: Date | string): DateWindow {
  return localWindow(civilDayOf(from), civilDayOf(to))
}

function civilDayOf(value: Date | string): Date {
  if (typeof value === 'string') {
    const civil = parseYmd(value)
    if (civil) return civil
    return localDayOf(new Date(value))
  }
  return localDayOf(value)
}

/**
 * Every app-zone calendar date from the day `from` falls on to the day `to` falls
 * on, inclusive, as YYYY-MM-DD. Walks civil dates, not 24-hour steps, so the
 * 23- and 25-hour days at the daylight-saving changes neither skip nor repeat a
 * date. For filling a chart axis with the same keys sales.revenueByDate uses.
 */
export function appDateKeysBetween(from: Date, to: Date): string[] {
  const keys: string[] = []
  const last = localDayOf(to).getTime()
  for (let day = localDayOf(from); day.getTime() <= last; day = addDays(day, 1)) {
    keys.push(day.toISOString().slice(0, 10))
  }
  return keys
}

export type DashboardPeriod = 'today' | 'this_week' | 'this_month' | 'custom'

export interface DashboardRange extends DateWindow {
  previous: DateWindow
}

/**
 * The Admin Dashboard's period toggle, resolved by the same rules Nex uses
 * (resolvePeriod), previous period included. A custom range that is incomplete,
 * not a real date or reversed falls back to the last 30 days, which is what the
 * dashboard showed for a half-filled custom range before.
 */
export function dashboardRange(period: DashboardPeriod, now: Date, customStart?: string, customEnd?: string): DashboardRange {
  const resolved = period === 'custom' ? resolveCustom(now, customStart, customEnd) : resolvePeriod(period, now)
  return { from: resolved.from, to: resolved.to, previous: resolved.previous }
}

function resolveCustom(now: Date, from?: string, to?: string): ResolvedPeriod {
  const start = from ? parseYmd(from) : null
  const end = to ? parseYmd(to) : null
  if (!start || !end || start.getTime() > end.getTime()) return resolvePeriod('last_30_days', now)
  return resolvePeriod('custom', now, { from, to })
}
