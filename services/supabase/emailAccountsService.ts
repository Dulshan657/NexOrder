// Client-side access to email_accounts + the OAuth-flow Edge Functions.
// Reads are direct (RLS gates to Admin/Manager); writes route through
// Edge Functions so the service-role lockdown is preserved.

import { supabase } from '@/lib/supabase'

export type EmailAccountProvider = 'gmail' | 'outlook'
export type EmailAccountStatus = 'active' | 'paused' | 'error'

export interface EmailAccountRow {
  id: string
  provider: EmailAccountProvider
  email_address: string
  status: EmailAccountStatus
  watermark: string | null
  last_sync_at: string | null
  last_error: string | null
  connected_by: string | null
  created_at: string
  updated_at: string
}

export async function listEmailAccounts(): Promise<EmailAccountRow[]> {
  const { data, error } = await supabase
    .from('email_accounts')
    .select('id, provider, email_address, status, watermark, last_sync_at, last_error, connected_by, created_at, updated_at')
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
