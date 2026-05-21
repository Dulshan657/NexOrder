// disconnect-email-account Edge Function
//
// "Sign out" of a connected mailbox. Stronger than pause:
//   1. Revoke the OAuth grant at the provider so the stored refresh token
//      is invalidated on their side too (Gmail only — Microsoft has no
//      programmatic revoke, so we surface a manual link for that path).
//   2. NULL out the locally-encrypted refresh token so the row can never
//      be polled again without going through a fresh OAuth flow.
//   3. Flip status='signed_out' (added in migration 00022). poll-inbox
//      already filters status='active' so polling stops immediately.
//   4. Record signed_out_at + signed_out_by for audit attribution.
//
// Idempotent: a second call on an already-signed-out row no-ops and
// returns alreadySignedOut:true.
//
// Role boundaries (matches pause-email-account):
//   * Admin: any account
//   * Manager: only mailboxes they connected (connected_by = self)

// deno-lint-ignore-file no-explicit-any
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.103.0'
import { corsHeadersFor } from '../_shared/cors.ts'
import { EdgeFunctionError, errorResponse } from '../_shared/errors.ts'
import { requireAuth } from '../_shared/auth.ts'
import { checkRateLimit } from '../_shared/rateLimit.ts'
import { logAuditEvent } from '../_shared/audit.ts'
import { decryptToken } from '../_shared/poInbox/encryption.ts'
import { sanitizeForLog } from '../_shared/poInbox/env.ts'

interface DisconnectRequest {
  emailAccountId: string
}

const GOOGLE_REVOKE_URL = 'https://oauth2.googleapis.com/revoke'
const OUTLOOK_MANUAL_REVOKE_URL = 'https://account.live.com/consent/Manage'
const REVOKE_TIMEOUT_MS = 10_000

serve(async (req: Request) => {
  const corsHeaders = corsHeadersFor(req)
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })
  if (req.method !== 'POST') {
    return errorResponse('INVALID_INPUT', 'POST only', undefined, 405, req)
  }

  try {
    const ctx = await requireAuth(req, { allowedRoles: ['Admin', 'Manager'] })

    const rl = await checkRateLimit(`disconnect-email-account:${ctx.userId}`, {
      windowMs: 60_000,
      max: 30,
    })
    if (!rl.ok) {
      return errorResponse('TOO_MANY_REQUESTS', 'Too many sign-outs — slow down', undefined, 429, req)
    }

    let body: DisconnectRequest
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

    const { data: current, error: lookupError } = await serviceClient
      .from('email_accounts')
      .select('id, provider, email_address, status, connected_by, oauth_refresh_token_encrypted')
      .eq('id', body.emailAccountId)
      .maybeSingle()
    if (lookupError) {
      console.warn('[disconnect-email-account] lookup failed:', lookupError.message)
      throw new EdgeFunctionError('INTERNAL', 'Lookup failed')
    }
    if (!current) {
      throw new EdgeFunctionError('NOT_FOUND', 'Email account not found')
    }

    if (ctx.role === 'Manager' && current.connected_by !== ctx.userId) {
      throw new EdgeFunctionError(
        'FORBIDDEN',
        'Manager can only sign out mailboxes they connected — ask an Admin for others',
      )
    }

    const provider = current.provider as 'gmail' | 'outlook'
    const manualRevokeUrl = provider === 'outlook' ? OUTLOOK_MANUAL_REVOKE_URL : undefined

    // Idempotency: already signed out → no-op success.
    if (current.status === 'signed_out') {
      return json(
        { ok: true, alreadySignedOut: true, provider, manualRevokeUrl },
        200,
        corsHeaders,
      )
    }

    // 1) Best-effort provider revoke. Failures are logged but never block
    //    the local cleanup — once we cut the local token, the polling
    //    pipeline is safe regardless of what the provider thinks.
    if (provider === 'gmail' && current.oauth_refresh_token_encrypted) {
      await tryRevokeGoogle(current.oauth_refresh_token_encrypted)
    }

    // 2 + 3 + 4) Atomic local update: clear token, flip status, audit columns.
    const { error: updateError } = await serviceClient
      .from('email_accounts')
      .update({
        status: 'signed_out',
        oauth_refresh_token_encrypted: null,
        last_error: null,
        watermark: null,            // next reconnect starts fresh from now
        signed_out_at: new Date().toISOString(),
        signed_out_by: ctx.userId,
        updated_at: new Date().toISOString(),
      })
      .eq('id', body.emailAccountId)
    if (updateError) {
      console.warn('[disconnect-email-account] update failed:', updateError.message)
      throw new EdgeFunctionError('INTERNAL', 'Update failed')
    }

    await logAuditEvent(serviceClient, {
      actorId: ctx.userId,
      actorRole: ctx.role,
      // The shared audit helper's action union is create|update|delete;
      // sign-out is modelled as an update with a sign_out flag in metadata.
      action: 'update',
      resource: 'email_account',
      resourceId: body.emailAccountId,
      before: { status: current.status },
      after: { status: 'signed_out' },
      metadata: {
        sign_out: true,
        provider,
        email_address: current.email_address,
      },
    })

    return json({ ok: true, provider, manualRevokeUrl }, 200, corsHeaders)
  } catch (err) {
    if (err instanceof EdgeFunctionError) return err.toResponse(req)
    console.warn('[disconnect-email-account] unexpected error:', err)
    return errorResponse('INTERNAL', 'Unexpected error', undefined, 500, req)
  }
})

function json(body: unknown, status: number, corsHeaders: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

/**
 * POST the refresh token to Google's revoke endpoint. 200 or 400
 * (token already invalid) are both "fine"; any other status logs a
 * warning. Network failures swallowed — the local cleanup that follows
 * is the source of truth for whether the mailbox is reachable.
 */
async function tryRevokeGoogle(encryptedRefreshToken: string): Promise<void> {
  let plain: string
  try {
    plain = await decryptToken(encryptedRefreshToken)
  } catch (e) {
    console.warn(
      '[disconnect-email-account] refresh-token decrypt failed (continuing with local cleanup):',
      sanitizeForLog(e instanceof Error ? e.message : String(e)),
    )
    return
  }

  try {
    const resp = await fetch(`${GOOGLE_REVOKE_URL}?token=${encodeURIComponent(plain)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      signal: AbortSignal.timeout(REVOKE_TIMEOUT_MS),
    })
    if (resp.status === 200) return
    if (resp.status === 400) {
      // Token already invalid at Google (e.g., user revoked from their
      // Google account page already). Functionally identical to success.
      console.log('[disconnect-email-account] Google revoke 400 (already invalid) — accepted')
      return
    }
    const bodyText = await resp.text().catch(() => '')
    console.warn(
      `[disconnect-email-account] Google revoke unexpected status ${resp.status}:`,
      sanitizeForLog(bodyText, 200),
    )
  } catch (e) {
    console.warn(
      '[disconnect-email-account] Google revoke network failure (continuing with local cleanup):',
      sanitizeForLog(e instanceof Error ? e.message : String(e)),
    )
  }
}
