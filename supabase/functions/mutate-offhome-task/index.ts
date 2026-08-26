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
//
// ── AND THERE IS STILL ONLY ONE OF IT ───────────────────────────────────────
//
// `restore` re-raises a task by running the SAME sweep scoped to one product,
// never by flipping a dismissed row back to 'suggested'. Two consequences, both
// wanted: the task comes back sized from what is in the bin NOW and judged by
// the rule that wins NOW, and nothing is ever written INTO 'suggested' by hand,
// so uq_wie_offhome_open — a partial index — cannot be tripped from here.

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
import { binKey, dismissalHighWater, shouldRaise } from '../_shared/wie/offHomeSuppress.ts'

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
  z.object({
    /** Lift a dismissal and look at that product again. No reason: dismissing
     *  is the judgement, and this undoes it. Who did it lives in audit_events. */
    action: z.literal('restore'),
    task_id: z.number().int().positive(),
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

/** Why a specific bin did or did not raise. Only computed when a caller asks
 *  about one — `restore` does, because the operator pressed a button and is
 *  owed an answer better than an unchanged screen. */
type BinVerdict = 'raised' | 'now_in_block' | 'no_stock' | 'no_rule' | 'still_dismissed'

interface SweepOptions {
  warehouseId: number
  /** Absent = the whole site, capped at MAX_SCANNED_PRODUCTS. */
  productIds?: number[]
  /** Report a verdict for this bin. */
  explainBin?: number
}

interface SweepResult {
  found: Array<Record<string, unknown>>
  /** The products actually looked at. A truncated run must not retire tasks it
   *  never reached — see wie_offhome_replace_tx. */
  examined: number[]
  scanned: number
  truncated: boolean
  /** Set when the sweep could not look at anything at all. */
  bail?: 'no_slotting_rules' | 'no_published_layout'
  explain?: BinVerdict
}

/**
 * The detector. Shared by `detect` (whole site) and `restore` (one product), so
 * a restored task is judged by exactly the code that raised it in the first
 * place. Writes nothing — the caller decides whether to record the result.
 */
async function runSweep(admin: any, opts: SweepOptions): Promise<SweepResult> {
  const empty: SweepResult = { found: [], examined: [], scanned: 0, truncated: false }

  const slotting = await loadWarehouseSlotting(admin, opts.warehouseId)
  if (slotting.empty) return { ...empty, bail: 'no_slotting_rules' }

  const { data: wh } = await admin.from('locations')
    .select('id, active_layout_id, materialized_path')
    .eq('id', opts.warehouseId).maybeSingle()
  if (!wh) throw new EdgeFunctionError('NOT_FOUND', 'That warehouse does not exist.')

  // Placed stock only. A warehouse ROOT holds what has NOT been put away yet,
  // which is un-placed rather than misplaced — raising a tidy-up task for it
  // would fight the putaway queue that already owns it.
  const { data: placed, error: placedErr } = await admin
    .from('layout_placements')
    .select('location_id')
    .eq('layout_id', (wh as any).active_layout_id)
  if (placedErr) throw new EdgeFunctionError('INTERNAL', `placement load failed: ${placedErr.message}`)
  const placedIds = new Set(((placed ?? []) as any[]).map((p) => Number(p.location_id)))
  if (placedIds.size === 0) return { ...empty, bail: 'no_published_layout' }

  let balanceQuery = admin
    .from('inventory_balances')
    .select('product_id, location_id, available, handling_unit_id, products(brand, category)')
    .in('location_id', [...placedIds])
    .gt('available', 0)
  // Scoped runs read one product across ALL its bins — never one bin. That is
  // what lets the caller hand wie_offhome_replace_tx the product id: the sweep
  // has seen everywhere it sits, so the replace is complete rather than
  // retiring bins it never looked at.
  if (opts.productIds) balanceQuery = balanceQuery.in('product_id', opts.productIds)
  const { data: balances, error: balErr } = await balanceQuery
  if (balErr) throw new EdgeFunctionError('INTERNAL', `balance load failed: ${balErr.message}`)

  // Dismissals, and why they need a quantity rather than just existing.
  //
  // 00121's replace deletes only `suggested` rows, so a dismissed one survives —
  // but the insert then adds a FRESH suggested row for the same (product, bin),
  // because the partial unique index covers suggested rows ONLY and the
  // dismissed one is not among them. Dismissal did not stick, and the queue
  // re-raised work somebody had deliberately left alone.
  //
  // Suppressing on the triple unconditionally is the other wrong answer, and it
  // stays wrong now that `restore` exists: it would make lifting a dismissal
  // something an operator has to REMEMBER, and forgetting is silent. The
  // quantity needs nobody to remember anything — more stock is a new situation
  // and re-raises on its own. `restore` is the deliberate act for the dismissal
  // made in error or overtaken by events, not the maintenance this rule avoids.
  // The reasoning lives in _shared/wie/offHomeSuppress.ts with the code.
  const { data: dismissedRows } = await admin
    .from('wie_offhome_tasks')
    .select('product_id, from_location_id, quantity')
    .eq('warehouse_id', opts.warehouseId)
    .eq('status', 'dismissed')
  const dismissedQty = dismissalHighWater((dismissedRows ?? []) as any[])

  const rows = (balances ?? []) as any[]
  const byProduct = new Map<number, any[]>()
  for (const b of rows) {
    const list = byProduct.get(b.product_id)
    if (list) list.push(b)
    else byProduct.set(b.product_id, [b])
  }

  const found: Array<Record<string, unknown>> = []
  const examined: number[] = []
  let scanned = 0
  let truncated = false
  // Nothing at all in that bin is the honest starting point: the product may
  // have no stock there any more, which is itself an answer.
  let explain: BinVerdict = 'no_stock'

  for (const [productId, group] of byProduct) {
    if (scanned >= MAX_SCANNED_PRODUCTS) { truncated = true; break }
    scanned++
    // Recorded BEFORE the unruled skip below: a product that used to be
    // off-home and no longer is must have its stale task retired, and that
    // only happens if the sweep says it looked at it.
    examined.push(productId)

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
    if (!resolution.rule || resolution.homeBlockIds.length === 0) {
      if (opts.explainBin !== undefined) explain = 'no_rule'
      continue
    }

    const homeBins = new Set<number>()
    for (const [locationId, blocks] of slotting.blockIdsByLocation) {
      if (blocks.some((b) => resolution.homeBlockIds.includes(b))) homeBins.add(locationId)
    }

    // AGGREGATE PER BIN BEFORE RAISING ANYTHING. inventory_balances is keyed
    // (product, location, batch, handling_unit), so ONE product in ONE bin
    // is routinely several rows — two batches, or loose stock beside a
    // plate. One task per row would violate uq_wie_offhome_open, which is
    // keyed (warehouse, product, from_location), and the whole sweep would
    // fail with a duplicate key. It is also the wrong unit of work: the task
    // says "move this product out of this bin", and that is one errand
    // however many lots make it up.
    const perBin = new Map<number, { qty: number; huIds: Set<number> }>()
    for (const b of group) {
      const locationId = Number(b.location_id)
      const entry = perBin.get(locationId) ?? { qty: 0, huIds: new Set<number>() }
      entry.qty += Number(b.available)
      if (b.handling_unit_id != null) entry.huIds.add(Number(b.handling_unit_id))
      perBin.set(locationId, entry)
    }

    for (const [locationId, entry] of perBin) {
      const explaining = opts.explainBin === locationId
      if (homeBins.has(locationId)) {
        if (explaining) explain = 'now_in_block'
        continue
      }
      if (!shouldRaise(entry.qty, dismissedQty.get(binKey(productId, locationId)))) {
        if (explaining) explain = 'still_dismissed'
        continue
      }
      if (explaining) explain = 'raised'
      found.push({
        warehouse_id: opts.warehouseId,
        layout_id: (wh as any).active_layout_id,
        product_id: productId,
        from_location_id: locationId,
        // AVAILABLE, never on_hand — inv_transfer_stock moves available
        // stock only, so a task sized otherwise is refused at the rack with
        // the pallet already in the operator's hands.
        quantity: entry.qty,
        // Only when the bin holds exactly ONE plate. Naming one of two
        // would tell inv_transfer_stock to move that plate specifically,
        // which is not what a whole-bin quantity means.
        handling_unit_id: entry.huIds.size === 1 ? [...entry.huIds][0] : null,
        rule_id: resolution.rule.id,
        explanation: {
          ruleName: resolution.rule.name,
          blockNames: resolution.homeBlockIds.map((id) => slotting.blockNames.get(id) ?? `block ${id}`),
        },
      })
    }
  }

  return {
    found,
    examined,
    scanned,
    truncated,
    ...(opts.explainBin !== undefined ? { explain } : {}),
  }
}

serve(async (req: Request) => {
  const corsHeaders = corsHeadersFor(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })

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

      const sweep = await runSweep(admin, { warehouseId: input.warehouse_id })
      if (sweep.bail) return json({ raised: 0, scanned: 0, reason: sweep.bail })

      if (input.dry_run) {
        return json({
          dryRun: true, raised: sweep.found.length, scanned: sweep.scanned, truncated: sweep.truncated,
        })
      }

      // Through an RPC, NOT `.upsert({onConflict})`. uq_wie_offhome_open is a
      // PARTIAL index and supabase-js sends column names only — there is nowhere
      // to put the `WHERE status = 'suggested'` the arbiter has to restate, and
      // Postgres answers "no unique or exclusion constraint matching the ON
      // CONFLICT specification". The same shape as uq_wie_replen_open's
      // documented trap, met from the client side. It is also two statements,
      // and two supabase-js statements are not a transaction.
      const { error: repErr } = await admin.rpc('wie_offhome_replace_tx', {
        p_warehouse_id: input.warehouse_id,
        // The products this sweep ACTUALLY examined — a truncated run must not
        // retire tasks for the ones it never reached.
        p_product_ids: sweep.examined,
        p_rows: sweep.found,
      })
      if (repErr) throw new EdgeFunctionError('INTERNAL', `could not record tasks: ${repErr.message}`)

      await logAuditEvent(admin, {
        actorId: auth.userId, actorRole: auth.role, action: 'create',
        resource: 'wie_offhome_tasks', resourceId: String(input.warehouse_id),
        metadata: { raised: sweep.found.length, scanned: sweep.scanned, truncated: sweep.truncated },
      })

      return json({ raised: sweep.found.length, scanned: sweep.scanned, truncated: sweep.truncated })
    }

    // ── accept / dismiss / restore ───────────────────────────────────────────
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
      return json({ ok: true })
    }

    // ── restore ──────────────────────────────────────────────────────────────
    //
    // Lift the dismissal, then look at that product again. Deliberately NOT a
    // flip back to 'suggested': that would reinstate a quantity measured when
    // the task was raised — hours or weeks ago — and could collide with a
    // suggested row the detector has since raised for the same triple, which is
    // the arbiter trap uq_wie_offhome_open sets and wie_unassign_replen_tx has
    // to fold around. Re-running the sweep has neither problem and gives the
    // walker a figure that matches the rack.
    if (input.action === 'restore') {
      const warehouseId = Number((task as any).warehouse_id)
      const productId = Number((task as any).product_id)
      const fromLocationId = Number((task as any).from_location_id)

      if ((task as any).status !== 'dismissed') {
        throw new EdgeFunctionError('CONFLICT', 'That task is not on the Left alone list any more.')
      }

      // EVERY dismissal for the triple, not just this row. The detector keeps
      // the LARGEST quantity refused for a (product, bin), so leaving a sibling
      // behind would lift one dismissal and have the task suppressed by
      // another — "I pressed Restore and nothing happened".
      //
      // The `.eq('status','dismissed')` is the compare-and-swap that serialises
      // two operators pressing Restore: the loser updates nothing and is told.
      const { data: cleared, error: clearErr } = await admin.from('wie_offhome_tasks')
        .update({ status: 'expired' })
        .eq('warehouse_id', warehouseId)
        .eq('product_id', productId)
        .eq('from_location_id', fromLocationId)
        .eq('status', 'dismissed')
        .select('id')
      if (clearErr) throw new EdgeFunctionError('INTERNAL', clearErr.message)
      const clearedCount = ((cleared ?? []) as any[]).length
      if (clearedCount === 0) {
        throw new EdgeFunctionError('CONFLICT', 'Somebody has already put that one back.')
      }
      // decided_at, actor_id and dismissed_reason are deliberately left alone:
      // they record that a dismissal happened and why, which stays true. Only
      // its force is lifted. Who lifted it is in audit_events.

      const sweep = await runSweep(admin, {
        warehouseId,
        productIds: [productId],
        explainBin: fromLocationId,
      })

      // A sweep that could look at nothing must not be allowed to retire
      // anything. Handing replace_tx an empty `found` for this product would
      // delete its live tasks on the strength of a run that never got as far as
      // reading a balance.
      if (sweep.bail) {
        await logAuditEvent(admin, {
          actorId: auth.userId, actorRole: auth.role, action: 'update',
          resource: 'wie_offhome_tasks', resourceId: String(input.task_id),
          metadata: { decision: 'restored', cleared: clearedCount, reraised: false, reason: sweep.bail },
        })
        return json({ restored: clearedCount, reraised: false, reason: sweep.bail })
      }

      const { error: repErr } = await admin.rpc('wie_offhome_replace_tx', {
        p_warehouse_id: warehouseId,
        // This product, stated rather than derived from `examined`: the sweep
        // looked at it even if it turned out to hold no stock anywhere, and
        // that is exactly when a stale task most needs retiring.
        p_product_ids: [productId],
        p_rows: sweep.found,
      })
      if (repErr) throw new EdgeFunctionError('INTERNAL', `could not record tasks: ${repErr.message}`)

      const raised = sweep.found.find((r) => Number(r.from_location_id) === fromLocationId)
      const reraised = raised !== undefined

      await logAuditEvent(admin, {
        actorId: auth.userId, actorRole: auth.role, action: 'update',
        resource: 'wie_offhome_tasks', resourceId: String(input.task_id),
        metadata: {
          decision: 'restored', cleared: clearedCount, reraised,
          product_id: productId, from_location_id: fromLocationId,
          ...(reraised ? {} : { reason: sweep.explain }),
        },
      })

      return json({
        restored: clearedCount,
        reraised,
        ...(reraised ? { quantity: Number(raised!.quantity) } : { reason: sweep.explain }),
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

    return json(result)
  } catch (e) {
    if (isEdgeFunctionError(e)) return e.toResponse(req)
    return errorResponse('INTERNAL', e instanceof Error ? e.message : 'Unknown error', undefined, undefined, req)
  }
})
