// reject-po Edge Function
//
// Admin/Manager only (Manager can only reject POs on mailboxes they
// connected, mirroring pause-email-account's role split).
//
// Marks a pending_pos row rejected with a required rejection_reason.
// No order is created. The pending_pos row's
// chk_pending_pos_rejected_has_reviewer CHECK forces reviewed_by +
// rejection_reason to be set when status='rejected'.

// deno-lint-ignore-file no-explicit-any
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.103.0'
import { corsHeadersFor } from '../_shared/cors.ts'
import { EdgeFunctionError, errorResponse } from '../_shared/errors.ts'
import { requireAuth, type AuthContext } from '../_shared/auth.ts'
import { checkRateLimit } from '../_shared/rateLimit.ts'
import { logAuditEvent } from '../_shared/audit.ts'
import { sanitizeForLog } from '../_shared/poInbox/env.ts'

interface RejectRequest {
  pendingPoId: string
  rejectionReason: string
}

serve(async (req: Request) => {
  const corsHeaders = corsHeadersFor(req)
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })
  if (req.method !== 'POST') {
    return errorResponse('INVALID_INPUT', 'POST only', undefined, 405, req)
  }

  try {
    const ctx = await requireAuth(req, { allowedRoles: ['Admin', 'Manager'] })

    const rl = checkRateLimit(`reject-po:${ctx.userId}`, { windowMs: 60_000, max: 30 })
    if (!rl.ok) {
      return errorResponse('TOO_MANY_REQUESTS', 'Slow down on rejections', undefined, 429, req)
    }

    let body: RejectRequest
    try {
      body = await req.json()
    } catch {
      throw new EdgeFunctionError('INVALID_INPUT', 'Body must be JSON')
    }
    if (!body.pendingPoId || typeof body.pendingPoId !== 'string') {
      throw new EdgeFunctionError('INVALID_INPUT', 'pendingPoId required')
    }
    const reason = (body.rejectionReason ?? '').trim()
    if (reason.length < 3) {
      throw new EdgeFunctionError(
        'INVALID_INPUT',
        'rejectionReason must be at least 3 characters',
      )
    }
    if (reason.length > 500) {
      throw new EdgeFunctionError('INVALID_INPUT', 'rejectionReason exceeds 500 chars')
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const serviceClient = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false },
    })

    const result = await runReject({
      supa: serviceClient,
      ctx,
      pendingPoId: body.pendingPoId,
      rejectionReason: reason,
    })

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    if (err instanceof EdgeFunctionError) return err.toResponse(req)
    console.warn(
      '[reject-po] unexpected error:',
      sanitizeForLog(err instanceof Error ? err.message : String(err)),
    )
    return errorResponse('INTERNAL', 'Unexpected error', undefined, 500, req)
  }
})

interface RunRejectArgs {
  supa: SupabaseClient
  ctx: AuthContext
  pendingPoId: string
  rejectionReason: string
}

async function runReject(args: RunRejectArgs) {
  const { data: pending, error: lookupError } = await args.supa
    .from('pending_pos')
    .select('id, status, inbound_message_id')
    .eq('id', args.pendingPoId)
    .single()
  if (lookupError || !pending) {
    throw new EdgeFunctionError('NOT_FOUND', `pending_pos ${args.pendingPoId} not found`)
  }
  const p = pending as { id: string; status: string; inbound_message_id: string }

  if (p.status === 'rejected') {
    return { ok: true, alreadyRejected: true }
  }
  if (p.status === 'approved' || p.status === 'auto_approved') {
    throw new EdgeFunctionError(
      'CONFLICT',
      'PO has already been approved and the order created — reject is not available',
    )
  }

  // Manager scope: only reject POs from mailboxes they connected.
  if (args.ctx.role === 'Manager') {
    const { data: inbound } = await args.supa
      .from('inbound_messages')
      .select('email_account_id')
      .eq('id', p.inbound_message_id)
      .single()
    if (inbound) {
      const { data: account } = await args.supa
        .from('email_accounts')
        .select('connected_by')
        .eq('id', (inbound as { email_account_id: string }).email_account_id)
        .single()
      if (account && (account as { connected_by: string }).connected_by !== args.ctx.userId) {
        throw new EdgeFunctionError(
          'FORBIDDEN',
          'Manager can only reject POs from mailboxes they connected — ask an Admin for others',
        )
      }
    }
  }

  const now = new Date().toISOString()
  const { error: updateError } = await args.supa
    .from('pending_pos')
    .update({
      status: 'rejected',
      rejection_reason: args.rejectionReason,
      reviewed_by: args.ctx.userId,
      reviewed_at: now,
      updated_at: now,
    })
    .eq('id', args.pendingPoId)
  if (updateError) {
    console.warn('[reject-po] update failed:', updateError.message)
    throw new EdgeFunctionError('INTERNAL', 'Failed to record rejection')
  }

  await logAuditEvent(args.supa, {
    actorId: args.ctx.userId,
    actorRole: args.ctx.role,
    action: 'update',
    resource: 'pending_po',
    resourceId: args.pendingPoId,
    after: { status: 'rejected' },
    reason: args.rejectionReason,
  })

  return { ok: true, status: 'rejected' as const }
}
