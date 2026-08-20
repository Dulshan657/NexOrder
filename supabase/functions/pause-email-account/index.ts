// pause-email-account Edge Function
//
// Toggles email_accounts.status between 'active' and 'paused'.
//
// Role boundaries:
//   * Admin can pause/resume any account.
//   * Manager can pause/resume only accounts they connected (connected_by = self).
//
// Why not full DELETE: the inbound_messages FK has ON DELETE RESTRICT to
// preserve PO audit history. Operators decommission a mailbox by setting
// status='paused' (poll-inbox skips it) rather than deleting the row.
//
// Status 'error' can't move out via this function — the user must complete
// a reconnect flow which writes status='active' via the OAuth callback
// upsert.

// deno-lint-ignore-file no-explicit-any
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.103.0'
import { corsHeadersFor } from '../_shared/cors.ts'
import { EdgeFunctionError, errorResponse } from '../_shared/errors.ts'
import { requireAuth } from '../_shared/auth.ts'
import { checkRateLimit } from '../_shared/rateLimit.ts'
import { logAuditEvent } from '../_shared/audit.ts'
import { requireModule } from '../_shared/modules.ts'

interface PauseRequest {
  emailAccountId: string
  desiredStatus: 'active' | 'paused'
}

serve(async (req: Request) => {
  const corsHeaders = corsHeadersFor(req)
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })
  if (req.method !== 'POST') {
    return errorResponse('INVALID_INPUT', 'POST only', undefined, 405, req)
  }

  try {
    requireModule('po_inbox')
    const ctx = await requireAuth(req, { allowedRoles: ['Admin', 'Manager'] })

    const rl = await checkRateLimit(`pause-email-account:${ctx.userId}`, {
      windowMs: 60_000,
      max: 30,
    })
    if (!rl.ok) {
      return errorResponse('TOO_MANY_REQUESTS', 'Too many toggles — slow down', undefined, 429, req)
    }

    let body: PauseRequest
    try {
      body = await req.json()
    } catch {
      throw new EdgeFunctionError('INVALID_INPUT', 'Body must be JSON')
    }
    if (!body.emailAccountId || typeof body.emailAccountId !== 'string') {
      throw new EdgeFunctionError('INVALID_INPUT', 'emailAccountId required')
    }
    if (body.desiredStatus !== 'active' && body.desiredStatus !== 'paused') {
      throw new EdgeFunctionError('INVALID_INPUT', "desiredStatus must be 'active' or 'paused'")
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const serviceClient = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false },
    })

    // Look up current state to preserve audit trail (before/after) and to
    // enforce Manager-only-on-own-account.
    const { data: current, error: lookupError } = await serviceClient
      .from('email_accounts')
      .select('id, provider, email_address, status, connected_by')
      .eq('id', body.emailAccountId)
      .maybeSingle()
    if (lookupError) {
      console.warn('[pause-email-account] lookup failed:', lookupError.message)
      throw new EdgeFunctionError('INTERNAL', 'Lookup failed')
    }
    if (!current) {
      throw new EdgeFunctionError('NOT_FOUND', 'Email account not found')
    }

    // Manager can only pause/resume an account they themselves connected.
    if (ctx.role === 'Manager' && current.connected_by !== ctx.userId) {
      throw new EdgeFunctionError(
        'FORBIDDEN',
        'Manager can only pause/resume mailboxes they connected — ask an Admin for others',
      )
    }

    if (current.status === 'error' && body.desiredStatus === 'active') {
      throw new EdgeFunctionError(
        'CONFLICT',
        'Account is in error state — start a new OAuth connection to recover',
      )
    }
    if (current.status === body.desiredStatus) {
      return new Response(JSON.stringify({ ok: true, unchanged: true }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const { data: updated, error: updateError } = await serviceClient
      .from('email_accounts')
      .update({ status: body.desiredStatus, updated_at: new Date().toISOString() })
      .eq('id', body.emailAccountId)
      .select('id, status')
      .single()
    if (updateError || !updated) {
      // Detailed message stays in Edge Function logs; client only sees a generic one.
      console.warn('[pause-email-account] update failed:', updateError?.message)
      throw new EdgeFunctionError('INTERNAL', 'Update failed')
    }

    await logAuditEvent(serviceClient, {
      actorId: ctx.userId,
      actorRole: ctx.role,
      action: 'update',
      resource: 'email_account',
      resourceId: body.emailAccountId,
      before: { status: current.status },
      after: { status: body.desiredStatus },
      metadata: { provider: current.provider, email_address: current.email_address },
    })

    return new Response(
      JSON.stringify({ ok: true, status: (updated as { status: string }).status }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  } catch (err) {
    if (err instanceof EdgeFunctionError) return err.toResponse(req)
    console.warn('[pause-email-account] unexpected error:', err)
    return errorResponse('INTERNAL', 'Unexpected error', undefined, 500, req)
  }
})
