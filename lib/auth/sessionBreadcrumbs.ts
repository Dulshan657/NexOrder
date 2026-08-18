// A record that the session refreshed, so a shift-long soak test has an answer.
//
// ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
//
// `lib/auth/inProcessLock.ts` re-enabled `persistSession` and
// `autoRefreshToken`, which is what stopped warehouse staff being signed out
// roughly hourly, mid-task, on a phone. The fix is believed to work and has
// never been verified over a real shift, because there was nothing to verify it
// WITH: `hooks/useAuth.ts` discards the `onAuthStateChange` event name, so
// `TOKEN_REFRESHED` is indistinguishable from `SIGNED_IN` everywhere downstream,
// and the string appears nowhere else in the repo.
//
// The test is "leave the device logged in for 90 minutes, then scan". Without a
// breadcrumb its only outcomes are "it worked" and "it didn't" — neither of
// which says whether a refresh ever happened, which is the actual question. A
// session that simply never came close to expiry proves nothing at all.
//
// ── CONTRACT ────────────────────────────────────────────────────────────────
//
// EVERYTHING HERE MUST FAIL SILENTLY, for the same reason `scanFeedback.ts`
// must: these calls sit on the auth path. A browser with storage disabled, a
// private window, a full quota — each must cost a breadcrumb, never a session.
//
// Deliberately free of the Supabase client and its required env vars, so it is
// directly testable — the same reasoning that keeps `inProcessLock.ts` separate.
//
// localStorage, not sessionStorage: it must survive the tab discard that
// `persistSession` was turned back on for. It is diagnostic only and holds no
// credential — just counts and timestamps.

const KEY = 'nexorder.auth.breadcrumbs'

/**
 * How many refresh timestamps to keep.
 *
 * Enough to see the cadence over a long shift at the ~55-minute refresh
 * interval, and bounded because this is written on an auth event and never
 * pruned by anything else.
 */
const MAX_REFRESHES = 24

export interface SessionBreadcrumbs {
  /** When this session was established, epoch ms. */
  readonly signedInAt: number | null
  /** How many times the token has been refreshed since. */
  readonly refreshCount: number
  /** Most recent refresh timestamps, oldest first, capped at MAX_REFRESHES. */
  readonly refreshes: readonly number[]
  /** Token expiry as supabase reports it, epoch ms. */
  readonly expiresAt: number | null
}

const EMPTY: SessionBreadcrumbs = {
  signedInAt: null,
  refreshCount: 0,
  refreshes: [],
  expiresAt: null,
}

export function readSessionBreadcrumbs(): SessionBreadcrumbs {
  try {
    const raw = globalThis.localStorage?.getItem(KEY)
    if (!raw) return EMPTY
    const parsed = JSON.parse(raw) as Partial<SessionBreadcrumbs>
    // Validated field by field rather than trusted: this is parsed from
    // storage, which is a system boundary, and a half-written value from an
    // older shape must degrade to EMPTY rather than render as NaN.
    return {
      signedInAt: numberOrNull(parsed.signedInAt),
      refreshCount: Number.isFinite(parsed.refreshCount) ? Number(parsed.refreshCount) : 0,
      refreshes: Array.isArray(parsed.refreshes)
        ? parsed.refreshes.filter((n): n is number => Number.isFinite(n)).slice(-MAX_REFRESHES)
        : [],
      expiresAt: numberOrNull(parsed.expiresAt),
    }
  } catch {
    return EMPTY
  }
}

/**
 * A new session began. Resets the counters — the question is always "how has
 * THIS session behaved", and carrying a previous one's count forward would make
 * the soak unreadable.
 */
export function recordSignIn(expiresAt: number | null, now: number = Date.now()): void {
  write({ signedInAt: now, refreshCount: 0, refreshes: [], expiresAt })
}

/** The token was renewed — the event the whole soak is looking for. */
export function recordRefresh(expiresAt: number | null, now: number = Date.now()): void {
  const prev = readSessionBreadcrumbs()
  write({
    // A refresh seen without a preceding sign-in means the session was restored
    // from storage on load, which is itself the thing being tested. Stamp the
    // start rather than leaving it null, or the age reads as unknown forever.
    signedInAt: prev.signedInAt ?? now,
    refreshCount: prev.refreshCount + 1,
    refreshes: [...prev.refreshes, now].slice(-MAX_REFRESHES),
    expiresAt,
  })
}

/**
 * Route one `onAuthStateChange` event to the right breadcrumb.
 *
 * Lives here rather than in `hooks/useAuth.ts` so that the storage shape, the
 * event vocabulary and the seconds→ms conversion are all decided in one file,
 * and so the auth hook's callback stays a single synchronous call.
 *
 * `expiresAtSeconds` is supabase's `session.expires_at`, which is epoch
 * SECONDS — every other timestamp in this module is epoch milliseconds. Passing
 * it through unconverted would put token expiry in January 1970 and read as
 * "expired 56 years ago" on the health tab.
 *
 * Unknown events are ignored rather than defaulted: supabase-js emits several
 * this does not care about (`USER_UPDATED`, `INITIAL_SESSION`), and treating one
 * of them as a refresh would inflate the count the soak test is reading.
 */
export function recordAuthEvent(event: string, expiresAtSeconds: number | null | undefined): void {
  const expiresAt = Number.isFinite(expiresAtSeconds)
    ? Number(expiresAtSeconds) * 1000
    : null

  if (event === 'TOKEN_REFRESHED') {
    recordRefresh(expiresAt)
    return
  }
  if (event === 'SIGNED_IN') {
    recordSignIn(expiresAt)
    return
  }
  if (event === 'SIGNED_OUT') {
    clearSessionBreadcrumbs()
  }
}

/** Signed out. The record goes with the session it describes. */
export function clearSessionBreadcrumbs(): void {
  try {
    globalThis.localStorage?.removeItem(KEY)
  } catch {
    // Storage disabled — there was nothing to clear.
  }
}

function write(next: SessionBreadcrumbs): void {
  try {
    globalThis.localStorage?.setItem(KEY, JSON.stringify(next))
  } catch {
    // Storage disabled or full. A missing breadcrumb is a diagnostic gap, and
    // must never become an auth failure.
  }
}

function numberOrNull(value: unknown): number | null {
  return Number.isFinite(value) ? Number(value) : null
}
