/**
 * Parse the URL a Supabase auth email lands on.
 *
 * This module is deliberately pure — no React, no Supabase client — so the
 * parsing can be tested without standing up either. `ResetPasswordView`
 * consumes the result and owns all the session work.
 *
 * Supabase can deliver several meaningfully different URLs, and until this
 * module existed the app understood exactly one of them. Everything else fell
 * through to a bare login page with no explanation, which is the single most
 * confusing thing an emailed link can do.
 *
 * TWO flows land here, and they are the same screen with different words:
 *  - `type=recovery` — "I forgot my password" (ForgotPasswordDialog).
 *  - `type=invite`   — an admin invited a new user (`invite-user` calls
 *    `auth.admin.inviteUserByEmail`). The invitee has an auth row but no
 *    password, so the *only* way they can ever sign in is to set one here.
 *    Claiming `invite` is what makes onboarding staff possible without a
 *    direct database write.
 *
 * The distinction is carried on the parsed link as `flow` because `verifyOtp`
 * demands the matching `type` — passing 'recovery' for an invite token is
 * rejected server-side.
 */

/** Which email produced this link. Both end at "choose a password". */
export type AuthLinkFlow = 'recovery' | 'invite'

/** The `type=` values we claim, in the order they appear on the URL. */
const CLAIMED_FLOWS: readonly AuthLinkFlow[] = ['recovery', 'invite']

function readFlow(params: URLSearchParams): AuthLinkFlow | null {
    const type = params.get('type')
    return CLAIMED_FLOWS.find((flow) => flow === type) ?? null
}

export type AuthLink =
    /** Implicit flow: `#access_token=…&refresh_token=…&type=recovery|invite`. */
    | { kind: 'tokens'; flow: AuthLinkFlow; accessToken: string; refreshToken: string }
    /** `?token_hash=…&type=recovery|invite`, exchanged with verifyOtp. */
    | { kind: 'token_hash'; flow: AuthLinkFlow; tokenHash: string }
    /** The link was expired, already used, or otherwise refused. */
    | { kind: 'error'; errorCode: string | null; description: string }
    /** Not an auth link at all. */
    | { kind: 'none' }

/** Retained name — the old export, now covering invites too. */
export type RecoveryLink = AuthLink

// Deliberately flow-neutral: an error link usually carries no `type=`, so this
// string is shown without knowing whether a reset or an invitation died. Both
// are recoverable the same way — request a fresh link from the sign-in page.
const DEFAULT_ERROR = 'This link is invalid or has expired. Request a new one from the sign-in page.'

function toParams(fragment: string): URLSearchParams {
    const trimmed = fragment.startsWith('#') || fragment.startsWith('?') ? fragment.slice(1) : fragment
    return new URLSearchParams(trimmed)
}

/**
 * Supabase puts the failure in the hash when the redirect came back from
 * /auth/v1/verify, and in the query string on some other legs — so both are
 * checked. URLSearchParams already decodes `+` to a space, which is how the
 * description arrives ("Email+link+is+invalid+or+has+expired").
 */
function readError(params: URLSearchParams): AuthLink | null {
    const error = params.get('error')
    const errorCode = params.get('error_code')
    if (error === null && errorCode === null) return null
    const description = params.get('error_description')
    return {
        kind: 'error',
        errorCode,
        description: description !== null && description !== '' ? description : DEFAULT_ERROR,
    }
}

/**
 * @param hash   `window.location.hash` (with or without the leading '#')
 * @param search `window.location.search` (with or without the leading '?')
 *
 * Note on PKCE `?code=…` links: they are deliberately NOT claimed here, because
 * `?code=` is what the PO-Inbox OAuth popup uses — claiming it would hijack a
 * mailbox connection and drop the admin on a password screen. The project's
 * recovery and invite templates emit `?token_hash=…&type=…` — see
 * `supabase/apply-auth-config.mjs` `authLink()`, which moved them off
 * `{{ .ConfirmationURL }}` so the link a client clicks reads nexorder.com.au
 * rather than a project ref — and neither shape produces a `?code=`, so
 * nothing is lost by leaving it alone.
 */
export function parseAuthLink(hash: string, search: string): AuthLink {
    const hashParams = toParams(hash)
    const queryParams = toParams(search)

    const hashError = readError(hashParams)
    if (hashError !== null) return hashError
    const queryError = readError(queryParams)
    if (queryError !== null) return queryError

    const hashFlow = readFlow(hashParams)
    if (hashFlow !== null) {
        const accessToken = hashParams.get('access_token')
        const refreshToken = hashParams.get('refresh_token')
        // Both are required: setSession cannot establish a session from one.
        if (accessToken !== null && refreshToken !== null) {
            return { kind: 'tokens', flow: hashFlow, accessToken, refreshToken }
        }
    }

    const queryFlow = readFlow(queryParams)
    if (queryFlow !== null) {
        const tokenHash = queryParams.get('token_hash')
        if (tokenHash !== null && tokenHash !== '') {
            return { kind: 'token_hash', flow: queryFlow, tokenHash }
        }
    }

    return { kind: 'none' }
}

/** Retained name — prefer `parseAuthLink`. */
export const parseRecoveryLink = parseAuthLink

/**
 * True when the current URL should route to the set-password view rather than
 * the normal app tree — including failed links, so the reason can be shown.
 */
export function isAuthLinkUrl(): boolean {
    if (typeof window === 'undefined') return false
    return parseAuthLink(window.location.hash, window.location.search).kind !== 'none'
}

/** Retained name — prefer `isAuthLinkUrl`. */
export const isRecoveryUrl = isAuthLinkUrl

/**
 * Query marker the dead-link screen leaves behind so LoginPage opens the
 * forgot-password dialog on arrival. Lives here so the two ends of that
 * handoff cannot drift apart.
 *
 * It serves an expired *invitation* too: `inviteUserByEmail` has already
 * created the auth user, so a password-reset link is a legitimate second way
 * in for someone whose invite lapsed.
 */
export const RESET_REQUEST_PARAM = 'reset'

export function wantsResetRequest(search: string): boolean {
    return toParams(search).get(RESET_REQUEST_PARAM) === '1'
}

export { DEFAULT_ERROR as DEFAULT_RECOVERY_ERROR }
