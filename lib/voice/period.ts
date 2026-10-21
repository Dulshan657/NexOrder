// Spoken periods ("this week", "last month") turned into exact instants.
//
// Calendar days are the APP TIME ZONE's (Australia/Sydney, _shared/voice/timeZone.ts),
// the same zone voice-session uses to tell the model today's date. Until the
// final review they were UTC days, which matched lib/semantic/filter.ts but not
// the prompt: at 09:00 on 1 November in Sydney the model believed it was
// November while "this month" resolved to all of October.
//
// A window is two exact instants, local midnight starting its first day and the
// last millisecond of its last day, so it plugs straight into an OrderFilter
// (whose from/to are instants, filter.ts). Local midnight is found through Intl,
// never a fixed offset: Sydney moves to UTC+11 at 02:00 on the first Sunday of
// October and back to UTC+10 at 03:00 on the first Sunday of April, so those
// two days are 23 and 25 hours long. No Sydney transition happens at midnight,
// so local midnight always exists and is unique.
//
// `previous` is the window of EQUAL LENGTH IN DAYS immediately before the
// current one, touching it with no gap and no overlap. "This week so far" (Mon
// to Wed) is therefore compared with the same number of days before Monday, not
// with last week's Mon to Wed.
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
  const length = Math.round((days.to.getTime() - days.from.getTime()) / DAY_MS) + 1
  const current = localWindow(days.from, days.to)
  const previous = localWindow(addDays(days.from, -length), addDays(days.from, -1))
  const label = `${days.label} (${formatCivilRange(days.from, days.to)})`
  return { from: current.from, to: current.to, previous, label }
}
