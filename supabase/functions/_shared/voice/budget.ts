// Nex Assistant (voice) - the usage budget, as a pure function of the ledger.
//
// PURE: the voice-session Edge Function reads the user's voice_sessions rows and
// calls these; the browser shows the same numbers. Nothing here reads a clock.
//
// "Today" is a ROLLING 24-hour window, not a calendar day: a session counts if it
// STARTED within the 24 hours before `now` (a session that started exactly 24 h
// ago still counts, one millisecond older does not). A calendar day would reset
// at an arbitrary midnight and let a user spend two days of budget around it.
//
// The ledger is deliberately pessimistic. A session still open (no endedAt) is
// charged at the full SESSION_CAP_SECONDS, because nobody has proved it stopped:
// a crashed tab must never earn the user free minutes. It stops counting once it
// is more than 24 hours old.

export const DAILY_SECONDS = 1800
export const SESSION_CAP_SECONDS = 900
export const START_BURST_PER_HOUR = 10
/** A session is not started with less than this left in the day. */
export const MIN_START_SECONDS = 60

export interface LedgerRow {
  /** ISO-8601 timestamp, as Postgres returns timestamptz. */
  startedAt: string
  /** ISO-8601 timestamp, or null while the session is open. */
  endedAt: string | null
}

const WINDOW_MS = 24 * 60 * 60 * 1000

function parseTime(value: string, field: string): number {
  const ms = Date.parse(value)
  if (Number.isNaN(ms)) {
    throw new RangeError('voice ledger: unreadable ' + field + ' timestamp "' + String(value) + '"')
  }
  return ms
}

function sessionSeconds(row: LedgerRow, startMs: number): number {
  if (row.endedAt === null) return SESSION_CAP_SECONDS
  const elapsedMs = Math.max(0, parseTime(row.endedAt, 'endedAt') - startMs)
  return Math.min(SESSION_CAP_SECONDS, Math.ceil(elapsedMs / 1000))
}

/**
 * Seconds of voice used in the 24 hours before `now`. An open session counts as
 * SESSION_CAP_SECONDS; a closed one counts its length (rounded up to a whole
 * second), capped at SESSION_CAP_SECONDS. Throws RangeError on an unreadable
 * timestamp rather than guessing.
 */
export function secondsUsedToday(rows: readonly LedgerRow[], now: Date): number {
  const windowStart = now.getTime() - WINDOW_MS
  return rows.reduce((sum, row) => {
    const startMs = parseTime(row.startedAt, 'startedAt')
    return startMs < windowStart ? sum : sum + sessionSeconds(row, startMs)
  }, 0)
}

/** Seconds left of the daily allowance, never negative. */
export function remainingSeconds(rows: readonly LedgerRow[], now: Date): number {
  return Math.max(0, DAILY_SECONDS - secondsUsedToday(rows, now))
}

/** How long a session started now may run: the cap, or what is left if less. */
export function maxSecondsForNewSession(rows: readonly LedgerRow[], now: Date): number {
  return Math.min(SESSION_CAP_SECONDS, remainingSeconds(rows, now))
}
