// Client-side access to email_accounts + the OAuth-flow Edge Functions.
// Reads are direct (RLS gates to Admin/Manager); writes route through
// Edge Functions so the service-role lockdown is preserved.

import { supabase } from '@/lib/supabase'

export type EmailAccountProvider = 'gmail' | 'outlook'
export type EmailAccountStatus = 'active' | 'paused' | 'error' | 'signed_out'

export interface EmailAccountRow {
  id: string
  provider: EmailAccountProvider
  email_address: string
  status: EmailAccountStatus
  watermark: string | null
  last_sync_at: string | null
  last_error: string | null
  connected_by: string | null
  /** Back-to-back failed poll cycles; >0 with status 'active' means "reconnecting". */
  consecutive_failures: number
  /** Backoff gate: while in the future the account is skipped this cycle but stays active. */
  next_retry_at: string | null
  created_at: string
  updated_at: string
}

export async function listEmailAccounts(): Promise<EmailAccountRow[]> {
  const { data, error } = await supabase
    .from('email_accounts')
    .select('id, provider, email_address, status, watermark, last_sync_at, last_error, connected_by, consecutive_failures, next_retry_at, created_at, updated_at')
    // Hide signed-out rows from the admin list — they remain in the DB
    // so historical inbound_messages keep their FK, but the operator
    // reconnects via the top Connect button (which upserts the same row).
    .neq('status', 'signed_out')
    .order('created_at', { ascending: false })
  if (error) throw new Error(`listEmailAccounts: ${error.message}`)
  return (data ?? []) as unknown as EmailAccountRow[]
}

export interface StartOAuthResponse {
  authorizeUrl: string
}

/**
 * `supabase.functions.invoke` only surfaces an `error` on network /
 * non-2xx failures — but structured `{ error: { code, message } }`
 * bodies returned from our Edge Functions on 4xx/5xx flow through as
 * `data`. This helper detects that shape and rethrows.
 */
function throwOnStructuredError(data: unknown, fallback: string): void {
  if (
    data &&
    typeof data === 'object' &&
    'error' in data &&
    data.error &&
    typeof (data as { error: { message?: unknown; code?: unknown } }).error === 'object'
  ) {
    const err = (data as { error: { message?: string; code?: string } }).error
    throw new Error(err.message ?? err.code ?? fallback)
  }
}

export async function startOAuthFlow(
  provider: EmailAccountProvider,
): Promise<StartOAuthResponse> {
  const { data, error } = await supabase.functions.invoke('start-po-oauth', {
    body: { provider },
  })
  if (error) throw new Error(`startOAuthFlow: ${error.message}`)
  throwOnStructuredError(data, 'start-po-oauth failed')
  if (!data || typeof (data as { authorizeUrl?: unknown }).authorizeUrl !== 'string') {
    throw new Error('startOAuthFlow: no authorizeUrl in response')
  }
  return data as StartOAuthResponse
}

export async function pauseEmailAccount(
  emailAccountId: string,
  desiredStatus: 'active' | 'paused',
): Promise<void> {
  const { data, error } = await supabase.functions.invoke('pause-email-account', {
    body: { emailAccountId, desiredStatus },
  })
  if (error) throw new Error(`pauseEmailAccount: ${error.message}`)
  throwOnStructuredError(data, 'pause-email-account failed')
}

export interface DisconnectEmailAccountResponse {
  provider: EmailAccountProvider
  /** Present for Outlook only — Microsoft has no programmatic revoke. */
  manualRevokeUrl?: string
  alreadySignedOut?: boolean
}

export async function disconnectEmailAccount(
  emailAccountId: string,
): Promise<DisconnectEmailAccountResponse> {
  const { data, error } = await supabase.functions.invoke('disconnect-email-account', {
    body: { emailAccountId },
  })
  if (error) throw new Error(`disconnectEmailAccount: ${error.message}`)
  throwOnStructuredError(data, 'disconnect-email-account failed')
  return data as DisconnectEmailAccountResponse
}

/** Result of an on-demand "Retry now" poll of a single mailbox. */
export type RetryOutcome = 'synced' | 'still_failing' | 'needs_reconnect'

export interface RetryEmailAccountResponse {
  outcome: RetryOutcome
  /** New messages stored this poll (only meaningful when outcome === 'synced'). */
  newMessages: number
  /** The persisted last_error when the retry didn't succeed; null on success. */
  lastError: string | null
}

/**
 * Force an immediate poll of a transiently-failing ("Reconnecting…") mailbox,
 * bypassing the backoff timer. Returns the outcome so the UI can report it
 * inline. Errored/paused accounts are rejected server-side.
 */
export async function retryEmailAccount(
  emailAccountId: string,
): Promise<RetryEmailAccountResponse> {
  const { data, error } = await supabase.functions.invoke('retry-email-account', {
    body: { emailAccountId },
  })
  if (error) throw new Error(`retryEmailAccount: ${error.message}`)
  throwOnStructuredError(data, 'retry-email-account failed')
  return data as RetryEmailAccountResponse
}
