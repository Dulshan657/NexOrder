// mutate-order-draft Edge Function
//
// Admin/Manager save and delete of a New Order draft (`order_drafts`, mig
// 00150). The table is written by nothing else except `place-order`, which
// deletes a draft once the order it became commits.
//
// Drafts are shared, so an upsert of another person's draft is allowed and
// records the new `updated_by`; `created_by` never changes. Validation is the
// pure `_shared/orderDraftPayload.ts`, the same module the screen builds the
// body from.
//
// Auto-save fires this on a debounce while the operator types, so the rate
// budget is wider than an ordinary admin mutation's.

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.103.0'
import { requireAuth, type UserRole } from '../_shared/auth.ts'
import { EdgeFunctionError, errorResponse, isEdgeFunctionError } from '../_shared/errors.ts'
import { checkRateLimit } from '../_shared/rateLimit.ts'
import { logAuditEvent } from '../_shared/audit.ts'
import { corsHeadersFor } from '../_shared/cors.ts'
import { requireModule } from '../_shared/modules.ts'
import { parseOrderDraftRequest } from '../_shared/orderDraftPayload.ts'

const ALLOWED: ReadonlyArray<UserRole> = ['Admin', 'Manager']

const DRAFT_COLUMNS = 'id, horeca_id, lines, delivery_date, notes, created_by, updated_by, created_at, updated_at'

serve(async (req: Request) => {
  const corsHeaders = corsHeadersFor(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

  try {
    requireModule('sales_orders')
    const auth = await requireAuth(req, { allowedRoles: ALLOWED })

    // 60/min: one save per ~1.5s of continuous typing, with room to spare.
    const rl = await checkRateLimit(`mutate-order-draft:${auth.userId}`, { windowMs: 60_000, max: 60 })
    if (!rl.ok) {
      throw new EdgeFunctionError('TOO_MANY_REQUESTS', `Rate limit exceeded; try again in ${Math.ceil(rl.resetMs / 1000)}s`)
    }

    const body = await req.json().catch(() => {
      throw new EdgeFunctionError('INVALID_INPUT', 'Request body must be valid JSON')
    })
    const parsed = parseOrderDraftRequest(body)
    if (!parsed.ok || !parsed.value) throw new EdgeFunctionError('INVALID_INPUT', parsed.error ?? 'Invalid request body')
    const input = parsed.value

    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
      auth: { persistSession: false },
    })

    if (input.action === 'delete') {
      const { data: existing } = await admin.from('order_drafts').select(DRAFT_COLUMNS).eq('id', input.id).maybeSingle()
      if (!existing) throw new EdgeFunctionError('NOT_FOUND', 'Draft not found — it may already have been placed or deleted')
      const { error } = await admin.from('order_drafts').delete().eq('id', input.id)
      if (error) throw new EdgeFunctionError('INTERNAL', error.message)
      await logAuditEvent(admin, {
        actorId: auth.userId,
        actorRole: auth.role,
        action: 'delete',
        resource: 'order_drafts',
        resourceId: input.id,
        before: existing as Record<string, unknown>,
      })
      return json({ ok: true, deletedId: input.id })
    }

    const fields = {
      horeca_id: input.hoReCaId,
      lines: input.lines,
      delivery_date: input.deliveryDate,
      notes: input.notes,
      updated_by: auth.userId,
      updated_at: new Date().toISOString(),
    }

    if (input.id === null) {
      const { data: created, error } = await admin
        .from('order_drafts')
        .insert({ ...fields, created_by: auth.userId })
        .select(DRAFT_COLUMNS)
        .single()
      if (error || !created) throw new EdgeFunctionError('INTERNAL', error?.message ?? 'Failed to save draft')
      // Creation is audited; the stream of auto-saves that follows is not —
      // every keystroke batch would otherwise be an audit row.
      await logAuditEvent(admin, {
        actorId: auth.userId,
        actorRole: auth.role,
        action: 'create',
        resource: 'order_drafts',
        resourceId: String((created as { id: string }).id),
        after: created as Record<string, unknown>,
      })
      return json({ ok: true, draft: created }, 201)
    }

    const { data: updated, error } = await admin
      .from('order_drafts')
      .update(fields)
      .eq('id', input.id)
      .select(DRAFT_COLUMNS)
      .maybeSingle()
    if (error) throw new EdgeFunctionError('INTERNAL', error.message)
    if (!updated) throw new EdgeFunctionError('NOT_FOUND', 'Draft not found — it may already have been placed or deleted')
    return json({ ok: true, draft: updated })
  } catch (e) {
    if (isEdgeFunctionError(e)) return e.toResponse(req)
    return errorResponse('INTERNAL', e instanceof Error ? e.message : 'Unknown error', undefined, undefined, req)
  }
})
