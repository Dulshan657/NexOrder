// decide-slotting-suggestion Edge Function
//
// Close out a re-slotting suggestion produced by wie-batch-reoptimize: reject it,
// or accept it and physically move the stock from its current bin to the
// suggested bin via inv_transfer_stock (AVAILABLE stock only). Suggestions never
// auto-move — a human decides here. Accept uses claim-before-move (mirrors
// decide-putaway): atomically flip status 'suggested'→'accepted' first so
// concurrent accepts can't double-transfer, then move; revert on any failure.

// deno-lint-ignore-file no-explicit-any
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.103.0'
import { z } from 'https://esm.sh/zod@3.23.8'
import { requireAuth, type UserRole } from '../_shared/auth.ts'
import { EdgeFunctionError, errorResponse, isEdgeFunctionError } from '../_shared/errors.ts'
import { logAuditEvent } from '../_shared/audit.ts'
import { corsHeadersFor } from '../_shared/cors.ts'
import { checkRateLimit } from '../_shared/rateLimit.ts'
import { requireModule } from '../_shared/modules.ts'

const ALLOWED: ReadonlyArray<UserRole> = ['Admin', 'Manager']

const inputSchema = z.object({
  suggestion_id: z.number().int().positive(),
  decision: z.enum(['accept', 'reject']),
})

serve(async (req: Request) => {
  const corsHeaders = corsHeadersFor(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    requireModule('inventory_dispatch')
    const auth = await requireAuth(req, { allowedRoles: ALLOWED })
    const rl = await checkRateLimit(`decide-slotting-suggestion:${auth.userId}`, { windowMs: 60_000, max: 120 })
    if (!rl.ok) throw new EdgeFunctionError('TOO_MANY_REQUESTS', 'Rate limit exceeded')

    const body = await req.json().catch(() => {
      throw new EdgeFunctionError('INVALID_INPUT', 'Request body must be valid JSON')
    })
    const parsed = inputSchema.safeParse(body)
    if (!parsed.success) throw new EdgeFunctionError('INVALID_INPUT', 'Invalid request body', parsed.error.flatten())
    const { suggestion_id, decision } = parsed.data

    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
      auth: { persistSession: false },
    })

    const { data: sug, error: sErr } = await admin.from('wie_slotting_suggestions')
      .select('*').eq('id', suggestion_id).single()
    if (sErr || !sug) throw new EdgeFunctionError('NOT_FOUND', `Suggestion ${suggestion_id} not found`)
    if ((sug as any).status !== 'suggested') {
      throw new EdgeFunctionError('CONFLICT', `Suggestion already ${(sug as any).status}`)
    }

    const warehouseId = (sug as any).warehouse_id as number
    const productId = (sug as any).product_id as number
    const fromLoc = (sug as any).from_location_id as number
    const toLoc = (sug as any).to_location_id as number
    const qty = (sug as any).qty as number

    // ── Reject: mark rejected, no stock movement. ──────────────────────────────
    if (decision === 'reject') {
      const { data: rejected, error: rejErr } = await admin.from('wie_slotting_suggestions').update({
        status: 'rejected', decided_at: new Date().toISOString(), actor_id: auth.userId,
      }).eq('id', suggestion_id).eq('status', 'suggested').select().single()
      if (rejErr || !rejected) throw new EdgeFunctionError('CONFLICT', 'Suggestion already decided')

      await logAuditEvent(admin, {
        actorId: auth.userId, actorRole: auth.role, action: 'update', resource: 'wie_slotting_suggestions',
        resourceId: String(suggestion_id), after: rejected as Record<string, unknown>,
        metadata: { decision },
      })
      return new Response(JSON.stringify({ ok: true, suggestion: rejected }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // ── Accept: claim BEFORE moving so concurrent accepts can't double-transfer.
    const { data: claimed, error: claimErr } = await admin.from('wie_slotting_suggestions').update({
      status: 'accepted', decided_at: new Date().toISOString(), actor_id: auth.userId,
    }).eq('id', suggestion_id).eq('status', 'suggested').select().single()
    if (claimErr || !claimed) throw new EdgeFunctionError('CONFLICT', 'Suggestion already decided')

    // Release a failed claim back to 'suggested' so it can be retried. If a
    // concurrent reoptimize already re-opened the same (wh,product,from,to) tuple,
    // the partial unique index rejects 'suggested' — fall back to 'expired' so the
    // row never sticks in a bogus 'accepted' state with no stock moved.
    const releaseClaim = async (): Promise<void> => {
      const { error } = await admin.from('wie_slotting_suggestions')
        .update({ status: 'suggested', decided_at: null, actor_id: null }).eq('id', suggestion_id)
      if (error) {
        await admin.from('wie_slotting_suggestions')
          .update({ status: 'expired', decided_at: new Date().toISOString() }).eq('id', suggestion_id)
      }
    }

    // Verify the destination bin is still valid; revert the claim on any mismatch.
    const { data: binRow, error: binErr } = await admin.from('locations')
      .select('id, is_active').eq('id', toLoc).single()
    const { data: root, error: rootErr } = await admin.rpc('inv_root_warehouse', { p_location_id: toLoc })
    if (binErr || !binRow || !(binRow as any).is_active || rootErr || root !== warehouseId) {
      await releaseClaim()
      throw new EdgeFunctionError('CONFLICT', 'Destination bin is no longer valid for this warehouse — re-run re-optimize')
    }

    // Move AVAILABLE stock from the current bin to the suggested bin. On failure
    // (e.g. the stock was picked/moved since) release the claim so it can retry.
    const { data: moved, error: mErr } = await admin.rpc('inv_transfer_stock', {
      p_product_id: productId, p_from_loc: fromLoc, p_to_loc: toLoc, p_qty: qty,
      p_actor: auth.userId, p_reason: 'reslot',
    })
    if (mErr) {
      await releaseClaim()
      throw new EdgeFunctionError('INTERNAL', `reslot move failed: ${mErr.message}`)
    }

    await logAuditEvent(admin, {
      actorId: auth.userId, actorRole: auth.role, action: 'update', resource: 'wie_slotting_suggestions',
      resourceId: String(suggestion_id), after: claimed as Record<string, unknown>,
      metadata: { decision, from_location_id: fromLoc, to_location_id: toLoc, qty, moved },
    })

    return new Response(JSON.stringify({ ok: true, moved, suggestion: claimed }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (e) {
    if (isEdgeFunctionError(e)) return e.toResponse(req)
    return errorResponse('INTERNAL', e instanceof Error ? e.message : 'Unknown error', undefined, undefined, req)
  }
})
