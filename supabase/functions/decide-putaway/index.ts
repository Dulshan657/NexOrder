// decide-putaway Edge Function
//
// Close out a putaway recommendation: accept the suggested bin or override to
// another, then move the received stock from the warehouse ROOT (un-put-away
// staging) into the chosen bin. The recommendation row is marked
// accepted/overridden for the audit trail. Re-evaluation (picking a fresh
// recommendation that excludes a bin) is done by calling recommend-putaway with
// `replaces_recommendation_id`, so this function stays focused on the commit step.
//
// An optional `quantity` puts away PART of a line (a pallet that physically
// split across two bays): the decided portion becomes its own audit row and the
// remainder stays in the queue. The claim, the split and the stock move all
// happen inside wie_decide_putaway_tx (mig 00071) so a failed transfer rolls the
// decision back instead of needing a compensating write from here.

// deno-lint-ignore-file no-explicit-any
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.103.0'
import { z } from 'https://esm.sh/zod@3.23.8'
import { requireAuth, type UserRole } from '../_shared/auth.ts'
import { EdgeFunctionError, errorResponse, isEdgeFunctionError } from '../_shared/errors.ts'
import { logAuditEvent } from '../_shared/audit.ts'
import { corsHeadersFor } from '../_shared/cors.ts'
import { checkRateLimit } from '../_shared/rateLimit.ts'

const ALLOWED: ReadonlyArray<UserRole> = ['Admin', 'Manager', 'Warehouse']

const inputSchema = z.object({
  recommendation_id: z.number().int().positive(),
  decision: z.enum(['accept', 'override']),
  chosen_location_id: z.number().int().positive().optional(),
  // Partial putaway. Omitted = the whole remaining quantity.
  quantity: z.number().positive().optional(),
}).refine((d) => d.decision !== 'override' || d.chosen_location_id !== undefined, {
  message: 'override requires chosen_location_id',
})

// wie_decide_putaway_tx raises P0001 with a `CODE: message` prefix. Map the ones
// the operator can act on so the UI shows "already decided" rather than a 500.
const PG_ERROR_CODES: ReadonlyArray<['NOT_FOUND' | 'CONFLICT' | 'INVALID_INPUT', string]> = [
  ['NOT_FOUND', 'NOT_FOUND:'],
  ['CONFLICT', 'CONFLICT:'],
  ['INVALID_INPUT', 'INVALID_QTY:'],
  ['INVALID_INPUT', 'INVALID_INPUT:'],
  ['INVALID_INPUT', 'INVALID_DECISION:'],
  ['CONFLICT', 'INSUFFICIENT_STOCK:'],
]

function rpcError(message: string): EdgeFunctionError {
  for (const [code, prefix] of PG_ERROR_CODES) {
    if (message.includes(prefix)) {
      return new EdgeFunctionError(code, message.slice(message.indexOf(prefix) + prefix.length).trim())
    }
  }
  return new EdgeFunctionError('INTERNAL', `putaway failed: ${message}`)
}

serve(async (req: Request) => {
  const corsHeaders = corsHeadersFor(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const auth = await requireAuth(req, { allowedRoles: ALLOWED })
    const rl = await checkRateLimit(`decide-putaway:${auth.userId}`, { windowMs: 60_000, max: 120 })
    if (!rl.ok) throw new EdgeFunctionError('TOO_MANY_REQUESTS', 'Rate limit exceeded')

    const body = await req.json().catch(() => {
      throw new EdgeFunctionError('INVALID_INPUT', 'Request body must be valid JSON')
    })
    const parsed = inputSchema.safeParse(body)
    if (!parsed.success) throw new EdgeFunctionError('INVALID_INPUT', 'Invalid request body', parsed.error.flatten())
    const { recommendation_id, decision, chosen_location_id, quantity } = parsed.data

    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
      auth: { persistSession: false },
    })

    const { data: rec, error: rErr } = await admin.from('wie_putaway_recommendations')
      .select('*').eq('id', recommendation_id).single()
    if (rErr || !rec) throw new EdgeFunctionError('NOT_FOUND', `Recommendation ${recommendation_id} not found`)
    if ((rec as any).status !== 'suggested') {
      throw new EdgeFunctionError('CONFLICT', `Recommendation already ${(rec as any).status}`)
    }

    const warehouseId = (rec as any).warehouse_id as number
    if (auth.role === 'Warehouse' && auth.profile.home_warehouse_id !== warehouseId) {
      throw new EdgeFunctionError('FORBIDDEN', 'You can only put away stock at your own warehouse')
    }

    const chosen = decision === 'accept' ? ((rec as any).recommended_location_id as number | null) : chosen_location_id!
    if (chosen == null) {
      throw new EdgeFunctionError('INVALID_INPUT', 'No recommended bin to accept — choose a bin instead')
    }

    // Fail fast with a legible message; wie_decide_putaway_tx re-checks this
    // under its row lock, which is what actually makes it safe.
    const remaining = Number((rec as any).quantity)
    if (quantity !== undefined && quantity > remaining) {
      throw new EdgeFunctionError(
        'INVALID_INPUT',
        `Only ${remaining} left on this recommendation — can't put away ${quantity}`,
      )
    }

    // The chosen bin must be active and belong to this warehouse.
    const { data: binRow, error: binErr } = await admin.from('locations')
      .select('id, is_active').eq('id', chosen).single()
    if (binErr || !binRow) throw new EdgeFunctionError('NOT_FOUND', `Bin ${chosen} not found`)
    if (!(binRow as any).is_active) {
      throw new EdgeFunctionError('CONFLICT', 'That bin is no longer active — re-run the recommendation')
    }
    const { data: root, error: rootErr } = await admin.rpc('inv_root_warehouse', { p_location_id: chosen })
    if (rootErr) throw new EdgeFunctionError('INTERNAL', `warehouse resolution failed: ${rootErr.message}`)
    if (root !== warehouseId) {
      throw new EdgeFunctionError('INVALID_INPUT', 'Chosen bin is not inside this warehouse')
    }

    // Guard against acting on a stale recommendation: the warehouse must still be
    // on the layout this recommendation was computed for (a republish invalidates
    // older suggestions, which could otherwise strand stock in a removed bin).
    const { data: whRow } = await admin.from('locations')
      .select('active_layout_id').eq('id', warehouseId).single()
    if ((whRow as any)?.active_layout_id !== (rec as any).layout_id) {
      throw new EdgeFunctionError('CONFLICT', 'The layout changed since this recommendation — re-run it')
    }

    // Claim + (optional) split + stock move, all in ONE transaction (mig 00071).
    // The function's SELECT … FOR UPDATE is what stops two operators
    // double-transferring the same recommendation, and a failed move rolls the
    // decision back with it — nothing to compensate for from out here.
    const { data: result, error: txErr } = await admin.rpc('wie_decide_putaway_tx', {
      p_rec_id: recommendation_id,
      p_decision: decision,
      p_chosen: chosen,
      p_qty: quantity ?? null,
      p_actor: auth.userId,
    })
    if (txErr) throw rpcError(txErr.message)

    const decided = result as {
      decided_id: number
      remainder_id: number | null
      remainder_qty: number
      moved: unknown
    }

    // Read the decided row back for the audit trail. With a partial putaway
    // that's the NEW copy, not the row the operator clicked.
    const { data: updated } = await admin.from('wie_putaway_recommendations')
      .select('*').eq('id', decided.decided_id).single()

    await logAuditEvent(admin, {
      actorId: auth.userId, actorRole: auth.role, action: 'update', resource: 'wie_putaway_recommendations',
      resourceId: String(decided.decided_id), after: (updated ?? {}) as Record<string, unknown>,
      metadata: {
        decision,
        chosen_location_id: chosen,
        quantity: quantity ?? remaining,
        remainder_qty: decided.remainder_qty,
        source_recommendation_id: recommendation_id,
        moved: decided.moved,
      },
    })

    return new Response(JSON.stringify({
      ok: true,
      moved: decided.moved,
      recommendation: updated,
      remainder_id: decided.remainder_id,
      remainder_qty: decided.remainder_qty,
    }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (e) {
    if (isEdgeFunctionError(e)) return e.toResponse(req)
    return errorResponse('INTERNAL', e instanceof Error ? e.message : 'Unknown error', undefined, undefined, req)
  }
})
