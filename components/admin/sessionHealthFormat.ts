// Turning session breadcrumbs into the four readings the soak test needs.
//
// Split out and pure for the same reason `systemHealthFormat.ts` is: the numbers
// are the part worth testing, and "did this say 59 minutes or -56 years" is a
// question about arithmetic, not about React.
//
// The unit trap this exists to contain: supabase reports `expires_at` in epoch
// SECONDS while every timestamp beside it is epoch milliseconds. The conversion
// happens once, in `recordAuthEvent`; this file assumes milliseconds throughout
// and its tests pin what a mistake would look like.

import type { SessionBreadcrumbs } from '@/lib/auth/sessionBreadcrumbs'

export interface SessionReading {
  readonly age: string
  readonly signedInAtLabel: string
  readonly refreshCount: string
  readonly refreshHint: string
  readonly lastRefresh: string
  readonly lastRefreshAtLabel: string
  readonly expiresIn: string
  readonly expiresAtLabel: string
}

const DASH = '—'

/**
 * How close to expiry supabase-js lets a token get before it renews it.
 *
 * `AUTO_REFRESH_TICK_THRESHOLD` (3) × `AUTO_REFRESH_TICK_DURATION_MS` (30 s) in
 * `@supabase/auth-js/lib/constants` — ninety seconds, not the "roughly ten
 * minutes" this file asserted until 2026-08-19. That mistake was not academic:
 * it put the "one was due" boundary at 50 minutes on a one-hour token, when the
 * real one is ~58.5, so between those two figures the panel reported a failure
 * for a session behaving exactly as designed — in the window a 90-minute soak
 * actually lands in, which is the one reading this whole panel exists to give.
 *
 * Exported so a test can pin the boundary rather than restate the number.
 */
export const AUTO_REFRESH_MARGIN_MS = 90_000

export function describeSession(crumbs: SessionBreadcrumbs, now: number): SessionReading {
  return {
    age: crumbs.signedInAt == null ? DASH : formatDuration(now - crumbs.signedInAt),
    signedInAtLabel: crumbs.signedInAt == null ? 'no session recorded' : clockTime(crumbs.signedInAt),

    refreshCount: String(crumbs.refreshCount),
    refreshHint: refreshHint(crumbs, now),

    lastRefresh:
      crumbs.refreshes.length === 0
        ? DASH
        : `${formatDuration(now - crumbs.refreshes[crumbs.refreshes.length - 1])} ago`,
    lastRefreshAtLabel:
      crumbs.refreshes.length === 0 ? 'none yet' : clockTime(crumbs.refreshes[crumbs.refreshes.length - 1]),

    expiresIn: expiresIn(crumbs.expiresAt, now),
    expiresAtLabel: crumbs.expiresAt == null ? 'unknown' : clockTime(crumbs.expiresAt),
  }
}

/**
 * The line that actually answers the soak.
 *
 * Zero refreshes is only meaningful once one was DUE, and "due" is a fact about
 * the token, not about the clock: supabase renews when expiry comes within
 * AUTO_REFRESH_MARGIN_MS. Reading it off `expiresAt` rather than off session age
 * is what makes this correct at any token lifetime — the soak harness runs the
 * dev project at a five-minute one, where an age-based rule calibrated for an
 * hour would say "too soon to tell" for the entire run.
 *
 * A missing expiry is reported as such and never guessed at. The guess is the
 * defect being removed here; substituting a different one would keep it.
 */
function refreshHint(crumbs: SessionBreadcrumbs, now: number): string {
  if (crumbs.refreshCount > 0) return 'auto-refresh is working'
  if (crumbs.signedInAt == null) return 'nothing recorded yet'
  if (crumbs.expiresAt == null) return 'no expiry recorded — cannot tell'
  if (crumbs.expiresAt - now > AUTO_REFRESH_MARGIN_MS) return 'too soon to tell — none due yet'
  return 'none yet, and one was due'
}

function expiresIn(expiresAt: number | null, now: number): string {
  if (expiresAt == null) return DASH
  const remaining = expiresAt - now
  // A negative remainder is the failure the soak is looking for, and must read
  // as expired rather than as a negative duration.
  if (remaining <= 0) return 'expired'
  return formatDuration(remaining)
}

/**
 * Coarse on purpose. Seconds would make the panel flicker on a 30-second tick
 * and imply a precision the underlying timestamps do not have.
 */
function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return DASH
  const minutes = Math.floor(ms / 60_000)
  if (minutes < 1) return '<1m'
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`
}

function clockTime(at: number): string {
  try {
    return new Date(at).toLocaleTimeString()
  } catch {
    return DASH
  }
}
