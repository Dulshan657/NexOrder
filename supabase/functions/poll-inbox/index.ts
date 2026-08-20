// poll-inbox Edge Function
//
// Invoked every minute by the pg_cron + pg_net job documented in
// migration 00020 and the OAUTH_SETUP runbook. For each active
// email_accounts row it runs the shared per-account poll engine
// (see _shared/poInbox/pollAccount.ts) which:
//
//   1. Decrypts the refresh token, exchanges for an access token
//   2. Lists new messages since the stored watermark
//   3. Archives + inserts each new message and fires extract-po
//   4. Updates the watermark + last_sync_at on the account
//   5. On failure: a genuine grant revocation flips status='error'
//      (admin UI surfaces a Reconnect CTA); everything else stays
//      active and retries with backoff.
//
// Authentication: the cron job sends `Authorization: Bearer
// <POLL_INBOX_CRON_TOKEN>`. The function refuses any call without it,
// even from a service-role JWT — this token is the only legitimate
// invocation path.

// deno-lint-ignore-file no-explicit-any
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.103.0'
import { corsHeadersFor } from '../_shared/cors.ts'
import { isAuthorizedCronCall } from '../_shared/poInbox/pollDispatch.ts'
import { type AccountRow, processAccount } from '../_shared/poInbox/pollAccount.ts'
import { isModuleEnabled } from '../_shared/modules.ts'

serve(async (req: Request) => {
  const corsHeaders = corsHeadersFor(req)
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: { code: 'INVALID_INPUT', message: 'POST only' } }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  if (!isAuthorizedCronCall(req.headers.get('Authorization'))) {
    return new Response(
      JSON.stringify({ error: { code: 'UNAUTHORIZED', message: 'Cron token required' } }),
      { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  }

  // The module gate, and the ONE place it is a no-op rather than a refusal.
  //
  // Every other function in this module calls `requireModule`, which throws an
  // EdgeFunctionError that its try/catch turns into a 403. This one has no
  // try/catch — it composes raw Responses — so a throw would surface as an
  // unhandled 500. More to the point, it is a CRON: it fires every minute
  // whether or not the tenant bought PO Inbox, and a 403 a minute is a log full
  // of errors describing a deployment working exactly as configured.
  //
  // Reporting success having done nothing is the honest answer to "poll the
  // mailboxes" when there are no mailboxes to poll. It sits AFTER the cron-token
  // gate on purpose: an unauthenticated caller learns nothing about which
  // modules this deployment has.
  if (!isModuleEnabled('po_inbox')) {
    return new Response(JSON.stringify({ ok: true, skipped: 'module_disabled', accounts: [] }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const serviceClient = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false },
  })

  // Only poll active accounts that aren't in a backoff window. A row stays
  // 'active' through transient failures (timeouts, 5xx, 429); next_retry_at
  // just paces the retries. status='error' is reserved for a genuine grant
  // revocation that needs the operator to reconnect — those are skipped here.
  const nowIso = new Date().toISOString()
  const { data: accountsData, error: listError } = await serviceClient
    .from('email_accounts')
    .select('id, provider, email_address, oauth_refresh_token_encrypted, watermark, status, connected_by, consecutive_failures, next_retry_at')
    .eq('status', 'active')
    .or(`next_retry_at.is.null,next_retry_at.lte.${nowIso}`)
  if (listError) {
    console.warn('[poll-inbox] failed to list email_accounts:', listError.message)
    return new Response(
      JSON.stringify({ error: { code: 'INTERNAL', message: 'List accounts failed' } }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  }
  const accounts = (accountsData ?? []) as AccountRow[]

  // Run accounts in parallel — provider APIs are the bottleneck, not the DB.
  const results = await Promise.all(
    accounts.map(account => processAccount(account, serviceClient, supabaseUrl, serviceKey)),
  )

  return new Response(JSON.stringify({ ok: true, accounts: results }), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
})
