// Logic shared by the gmail-oauth-callback and outlook-oauth-callback
// Edge Functions. Both follow the same shape:
//
//   1. Rate-limit by client IP (OAuth callbacks are unauthenticated GET)
//   2. Parse `code` and `state` out of the query string
//   3. Consume the oauth_pending_states row atomically — DELETE … WHERE
//      state=$1 AND provider=$2 AND expires_at > now() RETURNING ...
//      so an expired token is distinguishable from a forged one in logs
//   4. Exchange the code for tokens at the provider's token endpoint
//   5. Look up the connecting user's email address via the provider
//   6. Encrypt the refresh token, upsert email_accounts
//   7. Redirect the browser back to /admin/email-accounts with a status code
//
// Each callback wires in its own provider-specific helpers via the
// CallbackProviderHandlers interface below.

// deno-lint-ignore-file no-explicit-any
import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.103.0'
import { encryptToken } from './encryption.ts'
import { readEnv, sanitizeForLog } from './env.ts'
import { buildCallbackUri, type Provider } from './oauthUrls.ts'
import { checkRateLimit, clientIp } from '../rateLimit.ts'

export { type Provider } from './oauthUrls.ts'

export interface PendingState {
  state: string
  provider: Provider
  pkce_verifier: string | null
  requested_by: string
  expires_at: string
}

export interface TokenExchangeResult {
  refreshToken: string
  /** Resolved via id_token (Google) or /me (Microsoft). */
  email: string
}

export interface CallbackProviderHandlers {
  provider: Provider
  /** Exchange code + verifier for tokens and resolve the user email. */
  exchange(input: {
    code: string
    pkceVerifier: string | null
    redirectUri: string
  }): Promise<TokenExchangeResult>
}

// PO_OAUTH_APP_BASE is read from env. Defaults to production; non-prod
// environments MUST set the secret explicitly. To prevent an
// open-redirect class of bug if the env var is ever set to an attacker-
// controlled value, we allowlist the acceptable hosts.
const ALLOWED_APP_BASES = new Set<string>([
  'https://nexorder.vercel.app',
  'http://localhost:3000',
])

const PRODUCTION_DEFAULT = 'https://nexorder.vercel.app'

function resolveAppBase(): string {
  const raw = (readEnv('PO_OAUTH_APP_BASE') ?? PRODUCTION_DEFAULT).replace(/\/+$/, '')
  if (!ALLOWED_APP_BASES.has(raw)) {
    console.warn(
      `[oauth-callback] PO_OAUTH_APP_BASE=${sanitizeForLog(raw, 80)} not in allowlist — falling back to ${PRODUCTION_DEFAULT}`,
    )
    return PRODUCTION_DEFAULT
  }
  return raw
}

function buildAppRedirect(query: Record<string, string>): string {
  const u = new URL('/admin/email-accounts', resolveAppBase())
  for (const [k, v] of Object.entries(query)) u.searchParams.set(k, v)
  return u.toString()
}

export function htmlRedirect(target: string): Response {
  // 303 forces GET on the follow-up redirect even if a provider sent a POST.
  return new Response(null, {
    status: 303,
    headers: { Location: target, 'Cache-Control': 'no-store' },
  })
}

export function callbackRedirectSuccess(): Response {
  // We don't include the account_id in the URL — the React page refetches
  // email_accounts immediately and the new row is the most recent.
  return htmlRedirect(buildAppRedirect({ connected: '1' }))
}

// Map provider-returned error codes onto our internal taxonomy so a
// provider-controlled string never lands in our `connect_error` field.
const KNOWN_PROVIDER_ERRORS = new Set<string>([
  'access_denied',
  'server_error',
  'temporarily_unavailable',
  'invalid_scope',
  'unauthorized_client',
  'unsupported_response_type',
])

function classifyProviderError(code: string): string {
  return KNOWN_PROVIDER_ERRORS.has(code) ? code : 'PROVIDER_ERROR'
}

export function callbackRedirectError(code: string, message: string): Response {
  const safeMessage = message.length > 120 ? `${message.slice(0, 120)}…` : message
  return htmlRedirect(buildAppRedirect({ connect_error: code, message: safeMessage }))
}

/**
 * Atomically claim a non-expired pending state row. The WHERE clause
 * includes `expires_at > now()` so the row stays in the table when
 * expired — separating "forged" (returns null because no row) from
 * "expired" (returns null because the row's expiry already passed).
 *
 * Returns null in either case; the caller logs at higher granularity
 * via the pre-emptive lookup in runCallback.
 */
export async function consumePendingState(
  serviceClient: SupabaseClient,
  state: string,
  provider: Provider,
): Promise<PendingState | null> {
  // Use an RPC-less approach: do a SELECT-then-DELETE chained in one
  // function so we can distinguish missing-vs-expired in logs.
  const { data: peek, error: peekError } = await serviceClient
    .from('oauth_pending_states')
    .select('state, provider, pkce_verifier, requested_by, expires_at')
    .eq('state', state)
    .eq('provider', provider)
    .maybeSingle()
  if (peekError) {
    console.warn('[oauth-callback] state peek error:', peekError.message)
    return null
  }
  if (!peek) {
    console.warn('[oauth-callback] state not found — possible forgery or replay')
    return null
  }
  const row = peek as PendingState
  if (new Date(row.expires_at).getTime() < Date.now()) {
    console.warn('[oauth-callback] state expired before redemption')
    // Clean up the expired row so the table doesn't grow unboundedly.
    await serviceClient.from('oauth_pending_states').delete().eq('state', state)
    return null
  }
  // Atomically claim by DELETE … RETURNING; if a concurrent callback
  // already deleted the row we'll get zero rows back.
  const { data: claimed, error: claimError } = await serviceClient
    .from('oauth_pending_states')
    .delete()
    .eq('state', state)
    .select('state')
    .maybeSingle()
  if (claimError || !claimed) {
    console.warn('[oauth-callback] state claim lost a race')
    return null
  }
  return row
}

/**
 * Run the shared callback pipeline. Wired by gmail-oauth-callback /
 * outlook-oauth-callback with provider-specific token-exchange logic.
 */
export async function runCallback(
  req: Request,
  handlers: CallbackProviderHandlers,
): Promise<Response> {
  // Cheap IP-based rate limit. OAuth callbacks are unauthenticated GETs
  // and a single user should hit them at most once per flow, so a
  // generous 30 / min / IP is plenty for legitimate traffic.
  const ip = clientIp(req)
  const rl = await checkRateLimit(`oauth-cb:${handlers.provider}:${ip}`, {
    windowMs: 60_000,
    max: 30,
  })
  if (!rl.ok) {
    return htmlRedirect(buildAppRedirect({
      connect_error: 'RATE_LIMITED',
      message: 'Too many callback attempts — try again in a minute',
    }))
  }

  const url = new URL(req.url)
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  const errorParam = url.searchParams.get('error')

  if (errorParam) {
    // Provider explicitly told us the user cancelled or there was a
    // scope/server error. Don't echo the provider's free-text message
    // into our error code — map it to a known taxonomy.
    return callbackRedirectError(
      classifyProviderError(errorParam),
      url.searchParams.get('error_description') ?? errorParam,
    )
  }
  if (!code || !state) {
    return callbackRedirectError('MISSING_PARAMS', 'OAuth callback missing code or state')
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const serviceClient = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false },
  })

  const pending = await consumePendingState(serviceClient, state, handlers.provider)
  if (!pending) {
    return callbackRedirectError(
      'INVALID_STATE',
      'OAuth state token is invalid or has expired — start the connect flow again',
    )
  }

  let exchanged: TokenExchangeResult
  try {
    exchanged = await handlers.exchange({
      code,
      pkceVerifier: pending.pkce_verifier,
      redirectUri: buildCallbackUri(supabaseUrl, handlers.provider),
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.warn(`[${handlers.provider}-oauth-callback] exchange failed:`, sanitizeForLog(msg))
    return callbackRedirectError('EXCHANGE_FAILED', 'Provider token exchange failed')
  }

  let encryptedRefresh: string
  try {
    encryptedRefresh = await encryptToken(exchanged.refreshToken)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.warn(`[${handlers.provider}-oauth-callback] encryption failed:`, msg)
    return callbackRedirectError('ENCRYPTION_FAILED', 'Failed to encrypt refresh token')
  }

  const upsertPayload = {
    provider: handlers.provider,
    email_address: exchanged.email.trim().toLowerCase(),
    oauth_refresh_token_encrypted: encryptedRefresh,
    status: 'active' as const,
    watermark: null,
    last_sync_at: null,
    last_error: null,
    connected_by: pending.requested_by,
    updated_at: new Date().toISOString(),
  }

  // Upsert on (provider, email_address) — the UNIQUE constraint from
  // migration 00018. Reconnecting an errored mailbox reuses the same row
  // and preserves its inbound_messages history.
  const { error: upsertError } = await serviceClient
    .from('email_accounts')
    .upsert(upsertPayload, { onConflict: 'provider,email_address' })
  if (upsertError) {
    console.warn(
      `[${handlers.provider}-oauth-callback] email_accounts upsert failed:`,
      upsertError.message,
    )
    return callbackRedirectError('DB_WRITE_FAILED', 'Failed to record connected mailbox')
  }

  return callbackRedirectSuccess()
}
