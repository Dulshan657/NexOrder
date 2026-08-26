// mutate-offhome-task Edge Function
//
// The tidy-up half of slotting (mig 00119): a rule written today finds stock
// already scattered, and this turns that into a list somebody can walk.
//
// ── IT OWNS THE TRANSFER, AND THAT IS NOT A PREFERENCE ──────────────────────
//
// transfer-stock is Admin/Manager only and carries no warehouse scoping, so
// delegating to it would 403 for the Warehouse role — the only role that ever
// walks this queue. complete-replenishment's header documents the identical
// trap in prose, having hit it first. Do NOT widen transfer-stock's roles to
// "fix" this: it is the inter-warehouse endpoint and the absence of scoping
// there is deliberate.
//
// ── DETECTION IS IN TYPESCRIPT, DELIBERATELY ────────────────────────────────
//
// Whether a bin is off-home needs the WINNING rule, and the specificity ladder
// has exactly one implementation (_shared/wie/slotting.ts resolveSlotting). A
// SQL detector would be a second one and would disagree with the putaway engine
// the moment a SKU rule and a brand rule both matched a product — which is
// precisely the case a SKU rule exists for. 00118's v_slotting_product_bins is
// a UNION and deliberately cannot answer this question.

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
import { loadWarehouseSlotting, loadSlottingProduct } from '../_shared/slottingLoad.ts'
import { resolveSlotting } from '../_shared/wie/slotting.ts'

const ALLOWED: ReadonlyArray<UserRole> = ['Admin', 'Manager', 'Warehouse']

/** A detection sweep reads every balance in the site. Bounded so one call
 *  cannot walk an unbounded catalogue; the response says when it was hit. */
const MAX_SCANNED_PRODUCTS = 500

const inputSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('detect'),
    warehouse_id: z.number().int().positive(),
    dry_run: z.boolean().optional(),
  }),
  z.object({
    action: z.literal('accept'),
    task_id: z.number().int().positive(),
    /** Omitted = let the engine choose. A scanned bin overrides it. */
    to_location_id: z.number().int().positive().nullish(),
    quantity: z.number().positive().nullish(),
  }),
  z.object({
    action: z.literal('dismiss'),
    task_id: z.number().int().positive(),
    reason: z.string().min(1).max(300),
  }),
])

function validationIssues(error: z.ZodError): { issues: Array<{ path: string; message: string }> } {
  return {
    issues: error.issues.slice(0, 10).map((i) => ({ path: i.path.join('.'), message: i.message })),
  }
}

/** Warehouse staff may only act on their own site. Admin/Manager are unscoped,
 *  matching every other warehouse endpoint. */
function assertSiteAccess(auth: any, warehouseId: number): void {
  if (auth.role === 'Warehouse' && auth.profile?.home_warehouse_id !== warehouseId) {
    throw new EdgeFunctionError('FORBIDDEN', 'That warehouse is not your home site.')
  }
}

serve(async (req: Request) => {
  const corsHeaders = corsHeadersFor(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    requireModule('inventory_dispatch')
    const auth = await requireAuth(req, { allowedRoles: ALLOWED })

    const rl = await checkRateLimit(`mutate-offhome-task:${auth.userId}`, { windowMs: 60_000, max: 60 })
    if (!rl.ok) throw new EdgeFunctionError('TOO_MANY_REQUESTS', 'Rate limit exceeded')

    const body = await req.json().catch(() => {
      throw new EdgeFunctionError('INVALID_INPUT', 'Request body must be valid JSON')
    })
    const parsed = inputSchema.safeParse(body)
    if (!parsed.success) {
      throw new EdgeFunctionError('INVALID_INPUT', 'Invalid request body', validationIssues(parsed.error))
    }
    const input = parsed.data

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { persistSession: false } },
    )

    // ── detect ───────────────────────────────────────────────────────────────
    if (input.action === 'detect') {
      assertSiteAccess(auth, input.warehouse_id)
      // Its own bucket: a sweep reads every balance in the site, and it must not
      // spend the budget the walkers need to accept and dismiss.
      const drl = await checkRateLimit(`mutate-offhome-task:detect:${auth.userId}`, { windowMs: 60_000, max: 10 })
      if (!drl.ok) throw new EdgeFunctionError('TOO_MANY_REQUESTS', 'Too many sweeps; wait a minute')

      const slotting = await loadWarehouseSlotting(admin, input.warehouse_id)
      if (slotting.empty) {
        return new Response(JSON.stringify({ raised: 0, scanned: 0, reason: 'no_slotting_rules' }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      const { data: wh } = await admin.from('locations')
        .select('id, active_layout_id, materialized_path')
        .eq('id', input.warehouse_id).maybeSingle()
      if (!wh) throw new EdgeFunctionError('NOT_FOUND', 'That warehouse does not exist.')

      // Placed stock only. A warehouse ROOT holds what has NOT been put away
      // yet, which is un-placed rather than misplaced — raising a tidy-up task
      // for it would fight the putaway queue that already owns it.
      const { data: placed, error: placedErr } = await admin
        .from('layout_placements')
        .select('location_id')
        .eq('layout_id', (wh as any).active_layout_id)
      if (placedErr) throw new EdgeFunctionError('INTERNAL', `placement load failed: ${placedErr.message}`)
      const placedIds = new Set(((placed ?? []) as any[]).map((p) => Number(p.location_id)))
      if (placedIds.size === 0) {
        return new Response(JSON.stringify({ raised: 0, scanned: 0, reason: 'no_published_layout' }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      const { data: balances, error: balErr } = await admin
        .from('inventory_balances')
        .select('product_id, location_id, available, handling_unit_id, products(brand, category)')
        .in('location_id', [...placedIds])
        .gt('available', 0)
      if (balErr) throw new EdgeFunctionError('INTERNAL', `balance load failed: ${balErr.message}`)

      const rows = (balances ?? []) as any[]
      const byProduct = new Map<number, any[]>()
      for (const b of rows) {
        const list = byProduct.get(b.product_id)
        if (list) list.push(b)
        else byProduct.set(b.product_id, [b])
      }

      const found: Array<Record<string, unknown>> = []
      let scanned = 0
      let truncated = false

      for (const [productId, group] of byProduct) {
        if (scanned >= MAX_SCANNED_PRODUCTS) { truncated = true; break }
        scanned++

        const first = group[0]
        const slotProduct = await loadSlottingProduct(admin, {
          id: productId,
          brand: first.products?.brand ?? null,
          category: first.products?.category ?? null,
        })
        const resolution = resolveSlotting(slotting.rules, slotProduct)
        // Unruled products are not misplaced — they have nowhere they are
        // supposed to be, which is the state every product is in before anyone
        // writes a rule.
        if (!resolution.rule || resolution.homeBlockIds.length === 0) continue

        const homeBins = new Set<number>()
        for (const [locationId, blocks] of slotting.blockIdsByLocation) {
          if (blocks.some((b) => resolution.homeBlockIds.includes(b))) homeBins.add(locationId)
        }

        for (const b of group) {
          const locationId = Number(b.location_id)
          if (homeBins.has(locationId)) continue
          found.push({
            warehouse_id: input.warehouse_id,
            layout_id: (wh as any).active_layout_id,
            product_id: productId,
            from_location_id: locationId,
            // AVAILABLE, never on_hand — inv_transfer_stock moves available
            // stock only, so a task sized otherwise is refused at the rack with
            // the pallet already in the operator's hands.
            quantity: Number(b.available),
            handling_unit_id: b.handling_unit_id ?? null,
            rule_id: resolution.rule.id,
            explanation: {
              ruleName: resolution.rule.name,
              blockNames: resolution.homeBlockIds.map((id) => slotting.blockNames.get(id) ?? `block ${id}`),
            },
          })
        }
      }

      if (input.dry_run) {
        return new Response(JSON.stringify({ dryRun: true, raised: found.length, scanned, truncated }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      if (found.length > 0) {
        // The arbiter MUST restate the partial index's predicate — without
        // `status='suggested'` Postgres cannot match it and errors at runtime.
        const { error: upErr } = await admin.from('wie_offhome_tasks')
          .upsert(found as any, {
            onConflict: 'warehouse_id,product_id,from_location_id',
            ignoreDuplicates: false,
          })
        if (upErr) throw new EdgeFunctionError('INTERNAL', `could not record tasks: ${upErr.message}`)
      }

      await logAuditEvent(admin, {
        actorId: auth.userId, actorRole: auth.role, action: 'create',
        resource: 'wie_offhome_tasks', resourceId: String(input.warehouse_id),
        metadata: { raised: found.length, scanned, truncated },
      })

      return new Response(JSON.stringify({ raised: found.length, scanned, truncated }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // ── accept / dismiss ─────────────────────────────────────────────────────
    const { data: task, error: taskErr } = await admin
      .from('wie_offhome_tasks').select('*').eq('id', input.task_id).maybeSingle()
    if (taskErr) throw new EdgeFunctionError('INTERNAL', taskErr.message)
    if (!task) throw new EdgeFunctionError('NOT_FOUND', 'That task no longer exists.')
    assertSiteAccess(auth, Number((task as any).warehouse_id))

    if (input.action === 'dismiss') {
      const { error } = await admin.from('wie_offhome_tasks')
        .update({
          status: 'dismissed', decided_at: new Date().toISOString(),
          dismissed_reason: input.reason, actor_id: auth.userId,
        })
        .eq('id', input.task_id).eq('status', 'suggested')
      if (error) throw new EdgeFunctionError('CONFLICT', error.message)

      await logAuditEvent(admin, {
        actorId: auth.userId, actorRole: auth.role, action: 'update',
        resource: 'wie_offhome_tasks', resourceId: String(input.task_id),
        metadata: { decision: 'dismissed', reason: input.reason },
      })
      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Re-derived at ACCEPT, not trusted from detection: the block may have
    // filled in the hours since, and sending the walker to a full bin is the
    // one failure this queue exists to avoid.
    let destination = input.to_location_id ?? null
    if (destination == null) {
      const slotting = await loadWarehouseSlotting(admin, Number((task as any).warehouse_id))
      const { data: product } = await admin.from('products')
        .select('id, brand, category').eq('id', (task as any).product_id).maybeSingle()
      const slotProduct = await loadSlottingProduct(admin, {
        id: Number((task as any).product_id),
        brand: (product as any)?.brand ?? null,
        category: (product as any)?.category ?? null,
      })
      const resolution = resolveSlotting(slotting.rules, slotProduct)
      const candidates: number[] = []
      for (const [locationId, blocks] of slotting.blockIdsByLocation) {
        if (blocks.some((b) => resolution.homeBlockIds.includes(b))) candidates.push(locationId)
      }
      destination = candidates.length > 0 ? candidates[0] : null
    }
    if (destination == null) {
      throw new EdgeFunctionError('CONFLICT',
        'This product has no assigned block any more — the rule may have changed. Dismiss the task, or scan a bin.')
    }

    const { data: result, error: txErr } = await admin.rpc('wie_accept_offhome_tx', {
      p_task_id: input.task_id,
      p_to_location_id: destination,
      p_qty: input.quantity ?? null,
      p_actor: auth.userId,
    })
    if (txErr) {
      const msg = txErr.message ?? ''
      // The gap between detection and the walk is hours, so an order can reserve
      // this stock in between. Say so plainly, and as a CONFLICT rather than an
      // INTERNAL, because the operator is at the rack and can reduce the
      // quantity or leave it.
      if (msg.includes('INSUFFICIENT_STOCK')) {
        throw new EdgeFunctionError('CONFLICT',
          'Not enough free stock left in that bin — some of it was reserved for an order after this task was raised. '
          + 'Reduce the quantity, or dismiss the task.',
          { reason: 'insufficient_stock' })
      }
      if (/CONFLICT|INVALID_QTY|INVALID_INPUT|INVALID_TRANSFER|NOT_FOUND/.test(msg)) {
        throw new EdgeFunctionError('CONFLICT', msg.replace(/^[A-Z_]+:\s*/, ''))
      }
      throw new EdgeFunctionError('INTERNAL', msg)
    }

    await logAuditEvent(admin, {
      actorId: auth.userId, actorRole: auth.role, action: 'update',
      resource: 'wie_offhome_tasks', resourceId: String(input.task_id),
      metadata: { decision: 'accepted', ...(result as Record<string, unknown>) },
    })

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (e) {
    if (isEdgeFunctionError(e)) return e.toResponse(req)
    return errorResponse('INTERNAL', e instanceof Error ? e.message : 'Unknown error', undefined, undefined, req)
  }
})
