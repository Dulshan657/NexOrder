// release-quarantine Edge Function (mig 00101)
//
// End a hold: move stock out of a quarantine bin and into ordinary storage. The
// moment it leaves, it is sellable again — there is no flag to clear, because the
// hold was never on the stock. It was on the PLACE (zone_profiles.is_hold), which
// is exactly what makes release free.
//
// WHY THIS IS NOT `transfer-stock`, WHICH ALREADY MOVES STOCK. Four reasons, and
// the first is the one that matters:
//
//   1. ROLES. transfer-stock is Admin/Manager. The person who walks the pallet
//      out of quarantine is Warehouse, and always will be.
//   2. The audit trail must record that a HOLD ENDED, not merely that stock
//      moved. "Which of these transfers was a release?" is otherwise
//      unanswerable without reconstructing the zone bindings as they were.
//   3. The SOURCE must be verified as actually held — otherwise this is a
//      Warehouse-role transfer endpoint by another name, and 'transfer-stock is
//      Admin/Manager' stops meaning anything.
//   4. The DESTINATION must be verified as NOT held. Releasing from one
//      quarantine bay into another reports the hold as ended while the stock is
//      still held, which is the worst of both answers.
//
// WHY NOT REUSE TWO-STAGE PUTAWAY, which already does assign → walk → scan.
// Because wie_complete_putaway_tx transfers from `warehouse_id` — the warehouse
// ROOT — not from wherever the stock actually is (mig 00080). Pointing it at a
// quarantine bin would move stock that is at the root and leave the bin full.
// So release is its own guided transfer, and the scan happens client-side
// against the destination code before this is called.

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

const ALLOWED: ReadonlyArray<UserRole> = ['Admin', 'Manager', 'Warehouse']

const lineSchema = z.object({
  product_id: z.number().int().positive(),
  quantity: z.number().positive(),
  /** The plate that physically moves. Omitted = unconstrained, expiry-ordered,
   *  exactly as inv_transfer_stock behaved before mig 00080. */
  handling_unit_id: z.number().int().positive().nullish(),
})

const inputSchema = z.object({
  from_location_id: z.number().int().positive(),
  to_location_id: z.number().int().positive(),
  lines: z.array(lineSchema).min(1).max(100),
  note: z.string().max(500).nullish(),
})

/** Is this location under a zone whose profile is a hold? One definition,
 *  v_held_locations (mig 00101), which is also what allocation reads. */
async function isHeld(admin: any, locationId: number): Promise<boolean> {
  const { data, error } = await admin
    .from('v_held_locations')
    .select('location_id')
    .eq('location_id', locationId)
    .maybeSingle()
  // Fails CLOSED. Treating an unreadable answer as "not held" would release
  // stock this function exists to keep held.
  if (error) throw new EdgeFunctionError('INTERNAL', `could not resolve hold state: ${error.message}`)
  return data != null
}

serve(async (req: Request) => {
  const corsHeaders = corsHeadersFor(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    requireModule('inventory_dispatch')
    const auth = await requireAuth(req, { allowedRoles: ALLOWED })

    const rl = await checkRateLimit(`release-quarantine:${auth.userId}`, { windowMs: 60_000, max: 30 })
    if (!rl.ok) {
      throw new EdgeFunctionError('TOO_MANY_REQUESTS', 'Rate limit exceeded — too many releases in a short period')
    }

    const body = await req.json().catch(() => {
      throw new EdgeFunctionError('INVALID_INPUT', 'Request body must be valid JSON')
    })
    const parsed = inputSchema.safeParse(body)
    if (!parsed.success) {
      throw new EdgeFunctionError('INVALID_INPUT', 'Invalid request body', parsed.error.flatten())
    }
    const { from_location_id, to_location_id, lines, note } = parsed.data

    if (from_location_id === to_location_id) {
      throw new EdgeFunctionError('INVALID_INPUT', 'Source and destination must differ')
    }

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { persistSession: false } },
    )

    if (!(await isHeld(admin, from_location_id))) {
      throw new EdgeFunctionError(
        'INVALID_INPUT',
        'That location is not in quarantine — use Transfer Stock to move ordinary stock',
      )
    }
    if (await isHeld(admin, to_location_id)) {
      throw new EdgeFunctionError(
        'CONFLICT',
        'The destination is also in quarantine — releasing into it would not end the hold',
      )
    }

    // Line by line, so a failure names the line rather than the whole release.
    // Not one transaction: each leg is atomic in inv_transfer_stock, and a
    // partial release is a true statement about the floor — some pallets moved.
    // Reporting which is more useful than pretending none did.
    const moved: unknown[] = []
    const failed: Array<{ product_id: number; error: string }> = []
    for (const line of lines) {
      const { data: result, error: rpcError } = await admin.rpc('inv_transfer_stock', {
        p_product_id: line.product_id,
        p_from_loc: from_location_id,
        p_to_loc: to_location_id,
        p_qty: line.quantity,
        p_actor: auth.userId,
        p_reason: 'quarantine_release',
        p_handling_unit_id: line.handling_unit_id ?? null,
      })
      if (rpcError) {
        failed.push({ product_id: line.product_id, error: rpcError.message ?? 'transfer failed' })
        continue
      }
      moved.push(result)
    }

    if (moved.length === 0) {
      throw new EdgeFunctionError('CONFLICT', `Nothing was released: ${failed.map((f) => f.error).join('; ')}`)
    }

    // ONE event for the release, not one per line — a hold ends once. The
    // resource is deliberately its own, so "when did this stock become
    // sellable" is answerable without reconstructing zone bindings.
    await logAuditEvent(admin, {
      actorId: auth.userId,
      actorRole: auth.role,
      action: 'update',
      resource: 'quarantine_release',
      resourceId: String(from_location_id),
      after: { from_location_id, to_location_id, lines, note: note ?? null },
      metadata: { moved, failed: failed.length > 0 ? failed : undefined },
    })

    return new Response(JSON.stringify({ ok: true, moved, failed }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (e) {
    if (isEdgeFunctionError(e)) return e.toResponse(req)
    return errorResponse('INTERNAL', e instanceof Error ? e.message : 'Unknown error', undefined, undefined, req)
  }
})
