// How long until a rate limit lets the caller try again, in words.
//
// Pure and dependency-free (voice-session imports it; __tests__/voice/retryAfter.test.ts
// pins the wording). The start burst window is an hour, and "try again in 3600s"
// asks the user to do arithmetic: from 90 seconds up the wait is said in whole
// minutes, rounded; below that in seconds, rounded up so it never says zero.

const SECOND_MS = 1000
const SECONDS_PER_MINUTE = 60
/** From this many seconds up, the wait is said in minutes. */
const MINUTES_FROM_SECONDS = 90

export function describeRetryAfter(resetMs: number): string {
  const seconds = Number.isFinite(resetMs) && resetMs > 0 ? Math.ceil(resetMs / SECOND_MS) : 1
  if (seconds < MINUTES_FROM_SECONDS) return seconds === 1 ? '1 second' : `${seconds} seconds`
  return `about ${Math.round(seconds / SECONDS_PER_MINUTE)} minutes`
}
