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
//
// Since mig 00080 this function covers all THREE desk-side decisions:
//
//   assign_only:true  → wie_assign_putaway_tx. Decide the bin, move nothing.
//                       The line becomes an 'assigned' task for the Walk view
//                       and the stock stays at the dock, which is where it is.
//                       complete-putaway moves it when someone carries it.
//   assign_only:false → wie_decide_putaway_tx, unchanged. One step, decide and
//                       move. This is the default, so every pre-00080 caller is
//                       byte-for-byte unaffected, and it stays the right path
//                       for desk/bulk work (notably the CSV opening-stock
//                       importer, which would otherwise need someone to walk
//                       hundreds of imaginary pallets).
//   'unassign'        → wie_unassign_putaway_tx. Walk an assigned task back to
//                       the queue when a run is abandoned. No stock has moved,
//                       so it is a pure state reversal.

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
  decision: z.enum(['accept', 'override', 'unassign']),
  chosen_location_id: z.number().int().positive().optional(),
  // Partial putaway. Omitted = the whole remaining quantity.
  quantity: z.number().positive().optional(),
  // Two-stage putaway (mig 00080). True = decide the bin and move NOTHING; the
  // line becomes an 'assigned' task and the stock stays at the dock until
  // complete-putaway records someone physically carrying it there.
  //
  // Defaults FALSE, so every existing caller keeps today's one-step behaviour
  // byte-for-byte. That is what lets this function deploy before the Walk view
  // exists, and it is the "Place now" escape hatch desk and bulk work still
  // need — the CSV opening-stock importer's follow-up putaway would otherwise
  // require someone to walk 300 imaginary pallets.
  assign_only: z.boolean().optional(),
  // Rack-level role gate (mig 00072). The chosen bin's level_role, when set,
  // is a HARD constraint against the SKU's allowed_level_roles — set this to
  // cross it anyway (e.g. no compliant level had room). The crossing is
  // recorded in audit_events, never silently allowed.
  role_override: z.boolean().optional(),
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
    const { recommendation_id, decision, chosen_location_id, quantity, role_override, assign_only } = parsed.data

    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
      auth: { persistSession: false },
    })

    const { data: rec, error: rErr } = await admin.from('wie_putaway_recommendations')
      .select('*').eq('id', recommendation_id).single()
    if (rErr || !rec) throw new EdgeFunctionError('NOT_FOUND', `Recommendation ${recommendation_id} not found`)

    // Unassign is the only decision that acts on an ALREADY-assigned task —
    // it walks the state back for a run someone started and abandoned. No stock
    // has moved at that point, so it is a pure state reversal.
    const requiredStatus = decision === 'unassign' ? 'assigned' : 'suggested'
    if ((rec as any).status !== requiredStatus) {
      throw new EdgeFunctionError('CONFLICT', `Recommendation already ${(rec as any).status}`)
    }

    const warehouseId = (rec as any).warehouse_id as number
    if (auth.role === 'Warehouse' && auth.profile.home_warehouse_id !== warehouseId) {
      throw new EdgeFunctionError('FORBIDDEN', 'You can only put away stock at your own warehouse')
    }

    if (decision === 'unassign') {
      const { error: uErr } = await admin.rpc('wie_unassign_putaway_tx', {
        p_rec_id: recommendation_id,
        p_actor: auth.userId,
      })
      if (uErr) throw rpcError(uErr.message)

      const { data: reverted } = await admin.from('wie_putaway_recommendations')
        .select('*').eq('id', recommendation_id).single()
      await logAuditEvent(admin, {
        actorId: auth.userId, actorRole: auth.role, action: 'update', resource: 'wie_putaway_recommendations',
        resourceId: String(recommendation_id), after: (reverted ?? {}) as Record<string, unknown>,
        metadata: { stage: 'unassign', previous_assigned_location_id: (rec as any).assigned_location_id },
      })

      return new Response(JSON.stringify({ ok: true, unassigned: true, recommendation: reverted }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
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
      .select('id, is_active, code, level_role').eq('id', chosen).single()
    if (binErr || !binRow) throw new EdgeFunctionError('NOT_FOUND', `Bin ${chosen} not found`)
    if (!(binRow as any).is_active) {
      throw new EdgeFunctionError('CONFLICT', 'That bin is no longer active — re-run the recommendation')
    }
    const { data: root, error: rootErr } = await admin.rpc('inv_root_warehouse', { p_location_id: chosen })
    if (rootErr) throw new EdgeFunctionError('INTERNAL', `warehouse resolution failed: ${rootErr.message}`)
    if (root !== warehouseId) {
      throw new EdgeFunctionError('INVALID_INPUT', 'Chosen bin is not inside this warehouse')
    }

    // Rack-level role gate (mig 00072). Checked on BOTH accept and override —
    // a live re-level (mutate-warehouse-location's set_levels, which doesn't
    // require a republish) can change a level's role after a recommendation
    // was computed, so "accept" is not automatically safe either. `null` on
    // the bin (no level_role) or on the SKU's allowed roles (no
    // product_wms_attributes row, or the row sets no restriction) means
    // unconstrained — every legacy bin and every pre-existing SKU keeps
    // working exactly as before this migration.
    const chosenLevelRole = (binRow as any).level_role as string | null
    let roleOverrideApplied = false
    let allowedRolesForSku: string[] | null = null
    let productSku: string | null = null
    if (chosenLevelRole) {
      const productId = (rec as any).product_id as number
      const [{ data: productRow }, { data: attrs }] = await Promise.all([
        admin.from('products').select('sku, name').eq('id', productId).maybeSingle(),
        admin.from('product_wms_attributes').select('allowed_level_roles').eq('product_id', productId).maybeSingle(),
      ])
      productSku = (productRow as any)?.sku ?? null
      const rawRoles = (attrs as any)?.allowed_level_roles
      allowedRolesForSku = Array.isArray(rawRoles) && rawRoles.length > 0 ? rawRoles : null
      const roleAllowed = !allowedRolesForSku || allowedRolesForSku.includes(chosenLevelRole)
      if (!roleAllowed) {
        if (!role_override) {
          throw new EdgeFunctionError(
            'CONFLICT',
            `${(binRow as any).code} is a ${chosenLevelRole} level; ${productSku ?? `product ${productId}`} is only ` +
              `allowed on ${allowedRolesForSku!.join('/')} levels. Choose a different bin, or confirm "Place anyway" to override.`,
          )
        }
        roleOverrideApplied = true
      }
    }

    // Guard against acting on a stale recommendation: the warehouse must still be
    // on the layout this recommendation was computed for (a republish invalidates
    // older suggestions, which could otherwise strand stock in a removed bin).
    const { data: whRow } = await admin.from('locations')
      .select('active_layout_id').eq('id', warehouseId).single()
    if ((whRow as any)?.active_layout_id !== (rec as any).layout_id) {
      throw new EdgeFunctionError('CONFLICT', 'The layout changed since this recommendation — re-run it')
    }

    // Claim + (optional) split, in ONE transaction. The SELECT … FOR UPDATE is
    // what stops two operators acting on the same recommendation, and — on the
    // one-step path — a failed move rolls the decision back with it, so there is
    // nothing to compensate for from out here.
    //
    // assign_only picks wie_assign_putaway_tx, which does everything except the
    // transfer: the stock stays at the warehouse root, where it physically is,
    // until someone carries it and complete-putaway records that.
    const { data: result, error: txErr } = assign_only
      ? await admin.rpc('wie_assign_putaway_tx', {
        p_rec_id: recommendation_id,
        p_chosen: chosen,
        p_qty: quantity ?? null,
        p_actor: auth.userId,
      })
      : await admin.rpc('wie_decide_putaway_tx', {
        p_rec_id: recommendation_id,
        p_decision: decision,
        p_chosen: chosen,
        p_qty: quantity ?? null,
        p_actor: auth.userId,
      })
    if (txErr) throw rpcError(txErr.message)

    const raw = result as Record<string, any>
    const decided = {
      // The two transactions name their surviving row differently; normalise so
      // the audit + response shape below is identical either way.
      decided_id: (raw.decided_id ?? raw.assigned_id) as number,
      remainder_id: (raw.remainder_id ?? null) as number | null,
      remainder_qty: Number(raw.remainder_qty ?? 0),
      moved: raw.moved ?? null,
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
        stage: assign_only ? 'assign' : 'place',
        chosen_location_id: chosen,
        quantity: quantity ?? remaining,
        remainder_qty: decided.remainder_qty,
        source_recommendation_id: recommendation_id,
        moved: decided.moved,
        ...(roleOverrideApplied ? {
          role_override: true,
          sku: productSku,
          chosen_level_role: chosenLevelRole,
          allowed_level_roles: allowedRolesForSku,
        } : {}),
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
