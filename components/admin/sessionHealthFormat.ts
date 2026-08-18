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
 * Zero refreshes is only meaningful once the session is old enough to have
 * needed one. Supabase renews roughly ten minutes before a one-hour token
 * expires, so anything under about fifty minutes proves nothing either way, and
 * saying so is the difference between a result and a shrug.
 */
function refreshHint(crumbs: SessionBreadcrumbs, now: number): string {
  if (crumbs.refreshCount > 0) return 'auto-refresh is working'
  if (crumbs.signedInAt == null) return 'nothing recorded yet'
  const minutes = (now - crumbs.signedInAt) / 60_000
  if (minutes < 50) return 'too soon to tell — none due yet'
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
