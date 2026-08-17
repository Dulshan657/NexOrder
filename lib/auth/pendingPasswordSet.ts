/**
 * "This session has not set a password yet."
 *
 * A recovery or invite link produces an ORDINARY Supabase session — `verifyOtp`
 * hands back the real thing, RLS sees the real user, and since `lib/supabase.ts`
 * runs with `persistSession: true` it is written straight to localStorage.
 * Nothing about that session says how it was obtained: `hooks/useAuth.ts`
 * discards the `onAuthStateChange` event name, so `PASSWORD_RECOVERY` and
 * `SIGNED_IN` are indistinguishable downstream.
 *
 * That mattered the moment `ResetPasswordView` started stripping the token out
 * of the URL as soon as the session existed — correct for credential hygiene,
 * but it left the URL as the app's ONLY record that a reset was in progress.
 * Refresh the set-password screen and the URL is bare, `Root` sees nothing
 * special, and the app renders for a user who never chose a password. On the
 * invite flow that account has no password at all.
 *
 * So the fact is recorded explicitly, here, and `Root` decides from the marker
 * as well as the URL.
 *
 * WHY localStorage: it must have exactly the lifetime of the session it guards,
 * and supabase-js persists that to localStorage under `sb-<ref>-auth-token`.
 * sessionStorage would be dropped by a tab discard/restore while the session
 * survived — the very case `persistSession` was turned on for — reopening the
 * hole this module closes.
 *
 * The decision half (`decideAuthScreen`, `isExpired`) is pure and takes `now`,
 * so it is testable without a DOM. Same split as `lib/auth/recoveryLink.ts`,
 * which parses and touches nothing.
 */

import type { AuthLink, AuthLinkFlow } from './recoveryLink'

const STORAGE_KEY = 'nexorder.auth.pending-password-set'

/**
 * How long a half-finished flow stays resumable.
 *
 * This is Supabase's `mailer_otp_exp` — see `supabase/apply-auth-config.mjs`,
 * which is the source of truth — expressed in ms. Bounding the marker to the
 * life of the link that created it is what stops an abandoned reset leaving a
 * privileged session parked in a browser indefinitely.
 */
export const PASSWORD_SET_WINDOW_MS = 3_600_000

/** The same window as prose, for the one place that has to say it out loud. */
export const PASSWORD_SET_WINDOW_LABEL = '1 hour'

export interface PendingPasswordSet {
    /** Whose session this is. Guards against a marker outliving its session. */
    userId: string
    /** Which email produced it — the screen's wording differs. */
    flow: AuthLinkFlow
    /** Epoch ms, stamped when the session was established. */
    issuedAt: number
}

/** What the top-level switch in `index.tsx` should render. */
export type AuthScreen = 'set-password' | 'app'

export function isExpired(marker: PendingPasswordSet, now: number): boolean {
    return now - marker.issuedAt >= PASSWORD_SET_WINDOW_MS
}

/**
 * Pure. The URL is checked first and still wins on its own, so a fresh link
 * routes here even with no marker yet — including `kind: 'error'`, which is
 * what lets a dead link explain itself instead of dropping the user on a bare
 * sign-in page.
 *
 * EXPIRY IS NOT DECIDED HERE, and that is deliberate — an earlier cut of this
 * treated a stale marker as absent and sent it to the app tree "to be signed
 * out there". Nothing in the app tree signs anything out: `AuthGate` sees a
 * perfectly good persisted session and renders the app. Verified against the
 * live demo, where an aged marker put a recovery session straight into the
 * admin UI — the original bug with an hour's delay on it.
 *
 * So ANY marker routes to the set-password screen, and `ResetPasswordView` —
 * the one place that can actually end a session — reads `isExpired` on mount
 * and turns a stale one into a sign-out plus a dead end.
 */
export function decideAuthScreen(
    linkKind: AuthLink['kind'],
    marker: PendingPasswordSet | null,
): AuthScreen {
    if (linkKind !== 'none') return 'set-password'
    if (marker !== null) return 'set-password'
    return 'app'
}

function isPendingPasswordSet(value: unknown): value is PendingPasswordSet {
    if (typeof value !== 'object' || value === null) return false
    const candidate = value as Record<string, unknown>
    return (
        typeof candidate.userId === 'string' &&
        candidate.userId !== '' &&
        (candidate.flow === 'recovery' || candidate.flow === 'invite') &&
        typeof candidate.issuedAt === 'number' &&
        Number.isFinite(candidate.issuedAt)
    )
}

/**
 * Every access is wrapped: localStorage throws outright in some private modes
 * and on quota. A storage failure must never be the thing that stops someone
 * setting a password — it degrades to the pre-existing behaviour, which is the
 * URL-only path.
 */
export function readPendingPasswordSet(): PendingPasswordSet | null {
    if (typeof localStorage === 'undefined') return null
    try {
        const raw = localStorage.getItem(STORAGE_KEY)
        if (raw === null) return null
        const parsed: unknown = JSON.parse(raw)
        return isPendingPasswordSet(parsed) ? parsed : null
    } catch {
        return null
    }
}

export function writePendingPasswordSet(marker: PendingPasswordSet): void {
    if (typeof localStorage === 'undefined') return
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(marker))
    } catch {
        // ignore — see readPendingPasswordSet
    }
}

export function clearPendingPasswordSet(): void {
    if (typeof localStorage === 'undefined') return
    try {
        localStorage.removeItem(STORAGE_KEY)
    } catch {
        // ignore — see readPendingPasswordSet
    }
}

export { STORAGE_KEY as PENDING_PASSWORD_SET_KEY }
