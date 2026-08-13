// retry-email-account Edge Function
//
// On-demand "Retry now" for a mailbox stuck auto-retrying transient failures
// (status='active' with consecutive_failures > 0, shown as "Reconnecting…" in
// the admin UI). It runs the SAME per-account poll engine the cron uses
// (_shared/poInbox/pollAccount.ts → processAccount) for this one account,
// bypassing the next_retry_at backoff gate, and reports the outcome inline.
//
// processAccount owns all state transitions:
//   * success           -> markAccountSynced clears consecutive_failures /
//                          next_retry_at / last_error
//   * transient failure  -> markAccountTransientFailure re-backs-off (stays active)
//   * grant revocation   -> markAccountErrored flips status='error' so the UI
//                          swaps to the OAuth Reconnect button
//
// Role boundaries (mirrors pause-email-account):
//   * Admin can retry any account.
//   * Manager can retry only accounts they connected (connected_by = self).
//
// Only status='active' is retriable here. 'error' must go through the OAuth
// reconnect flow; 'paused'/'signed_out' must be resumed/reconnected first.

// deno-lint-ignore-file no-explicit-any
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.103.0'
import { corsHeadersFor } from '../_shared/cors.ts'
import { EdgeFunctionError, errorResponse } from '../_shared/errors.ts'
import { requireAuth } from '../_shared/auth.ts'
import { checkRateLimit } from '../_shared/rateLimit.ts'
import { logAuditEvent } from '../_shared/audit.ts'
import { type AccountRow, processAccount } from '../_shared/poInbox/pollAccount.ts'
import { deriveRetryOutcome } from '../_shared/poInbox/retryOutcome.ts'
import { requireModule } from '../_shared/modules.ts'

interface RetryRequest {
  emailAccountId: string
}

serve(async (req: Request) => {
  const corsHeaders = corsHeadersFor(req)
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })
  if (req.method !== 'POST') {
    return errorResponse('INVALID_INPUT', 'POST only', undefined, 405, req)
  }

  try {
    requireModule('sales_orders')
    const ctx = await requireAuth(req, { allowedRoles: ['Admin', 'Manager'] })

    // On-demand provider polls are heavier than a status toggle — keep the
    // ceiling tighter than pause-email-account's 30/min.
    const rl = await checkRateLimit(`retry-email-account:${ctx.userId}`, {
      windowMs: 60_000,
      max: 10,
    })
    if (!rl.ok) {
      return errorResponse('TOO_MANY_REQUESTS', 'Too many retries — slow down', undefined, 429, req)
    }

    let body: RetryRequest
    try {
      body = await req.json()
    } catch {
      throw new EdgeFunctionError('INVALID_INPUT', 'Body must be JSON')
    }
    if (!body.emailAccountId || typeof body.emailAccountId !== 'string') {
      throw new EdgeFunctionError('INVALID_INPUT', 'emailAccountId required')
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const serviceClient = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false },
    })

    // Load the full row — processAccount needs the encrypted token + watermark
    // + backoff counters; we also need status/connected_by for the guards.
    const { data: account, error: lookupError } = await serviceClient
      .from('email_accounts')
      .select(
        'id, provider, email_address, oauth_refresh_token_encrypted, watermark, status, connected_by, consecutive_failures, next_retry_at',
      )
      .eq('id', body.emailAccountId)
      .maybeSingle()
    if (lookupError) {
      console.warn('[retry-email-account] lookup failed:', lookupError.message)
      throw new EdgeFunctionError('INTERNAL', 'Lookup failed')
    }
    if (!account) {
      throw new EdgeFunctionError('NOT_FOUND', 'Email account not found')
    }

    // Manager can only retry an account they themselves connected.
    if (ctx.role === 'Manager' && account.connected_by !== ctx.userId) {
      throw new EdgeFunctionError(
        'FORBIDDEN',
        'Manager can only retry mailboxes they connected — ask an Admin for others',
      )
    }

    if (account.status === 'error') {
      throw new EdgeFunctionError(
        'CONFLICT',
        'Account needs reconnecting — start a new OAuth connection with Reconnect',
      )
    }
    if (account.status !== 'active') {
      throw new EdgeFunctionError('CONFLICT', 'Resume the mailbox before retrying')
    }

    // Run the same engine the cron uses, for this one account, ignoring the
    // next_retry_at backoff gate. processAccount persists the resulting state.
    const result = await processAccount(account as AccountRow, serviceClient, supabaseUrl, serviceKey)

    // CycleResult.status is 'error' for BOTH transient and reauth failures, so
    // read back the authoritative DB status to disambiguate the outcome.
    const { data: after } = await serviceClient
      .from('email_accounts')
      .select('status, last_error')
      .eq('id', account.id)
      .maybeSingle()
    const afterStatus = (after as { status?: string } | null)?.status ?? account.status
    const lastError = (after as { last_error?: string | null } | null)?.last_error ?? result.errorMessage ?? null

    const outcome = deriveRetryOutcome(afterStatus, result.status)

    await logAuditEvent(serviceClient, {
      actorId: ctx.userId,
      actorRole: ctx.role,
      action: 'update',
      resource: 'email_account',
      resourceId: account.id,
      metadata: {
        retry: true,
        outcome,
        provider: account.provider,
        email_address: account.email_address,
        new_messages: result.newMessages,
      },
    })

    return new Response(
      JSON.stringify({
        ok: true,
        outcome,
        newMessages: outcome === 'synced' ? result.newMessages : 0,
        lastError: outcome === 'synced' ? null : lastError,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  } catch (err) {
    if (err instanceof EdgeFunctionError) return err.toResponse(req)
    console.warn('[retry-email-account] unexpected error:', err)
    return errorResponse('INTERNAL', 'Unexpected error', undefined, 500, req)
  }
})
