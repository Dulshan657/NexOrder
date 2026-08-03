// count-bin Edge Function
//
// A stocktake counted BY LOCATION. The operator gives one number per SKU for one
// bin, rack level, staging area or bulk warehouse root; this posts every
// resulting variance as `stocktake_variance` movements. Admin, Manager and
// Warehouse may call it; Warehouse staff are confined to their own
// `home_warehouse_id` subtree, exactly as adjust-stock confines them.
//
// WHY THIS EXISTS RATHER THAN A CLIENT LOOP OVER adjust-stock.
//
// 1. `inv_adjust_stock` spreads a shortfall across the PLATES of a slot, but
//    only within ONE batch (mig 00075 §7 — `COALESCE(batch_id,0) =
//    COALESCE(v_batch_id,0)`). Passing batch NULL names the untracked slot; it
//    does not mean "every lot". So a one-number-per-SKU count has to fan out
//    over batches before the RPC can fan out over plates. That fan-out is the
//    pure `_shared/binCount.ts` planner, which the count sheet ALSO runs, so the
//    operator's on-screen prediction and this function's decision are one
//    definition rather than two.
// 2. adjust-stock is rate-limited at 30/min/user. A twelve-line bin would burn
//    twelve of them and a second bin in the same minute would 429 mid-count.
//
// WHAT IT DELIBERATELY WILL NOT DO. A shortfall deeper than the unreserved
// stock is refused for the WHOLE line and nothing is written for it — see the
// planner's comment. Every other line in the same request still posts; a count
// is per-SKU work and one blocked SKU must not discard eleven good counts.

// deno-lint-ignore-file no-explicit-any
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.103.0'
import { z } from 'https://esm.sh/zod@3.23.8'
import { requireAuth, type UserRole } from '../_shared/auth.ts'
import { EdgeFunctionError, errorResponse, isEdgeFunctionError } from '../_shared/errors.ts'
import { logAuditEvent } from '../_shared/audit.ts'
import { corsHeadersFor } from '../_shared/cors.ts'
import { checkRateLimit } from '../_shared/rateLimit.ts'
import { generatePutawayTasks } from '../_shared/putawayTasks.ts'
import { planCountVariance, type CountSlot } from '../_shared/binCount.ts'

const ALLOWED: ReadonlyArray<UserRole> = ['Admin', 'Manager', 'Warehouse']

/** One sheet is one location. 200 distinct SKUs in a single bin is already far
 *  past anything real, and the cap keeps one request bounded. */
const MAX_LINES = 200

const inputSchema = z.object({
  locationId: z.number().int().positive(),
  lines: z
    .array(
      z.object({
        productId: z.number().int().positive(),
        // A count is a tally: whole, and never negative. Zero is meaningful and
        // must be accepted — it is how a bin is emptied.
        countedQty: z.number().int().min(0, 'A counted quantity cannot be negative'),
      }),
    )
    .min(1, 'Send at least one counted line')
    .max(MAX_LINES, `A count may carry at most ${MAX_LINES} lines`),
  note: z.string().trim().max(300).optional(),
})

/**
 * Failure details that NAME THE FIELD, as `{ issues: [{ path, message }] }`.
 * `error.flatten()` collapses a nested path onto its top-level key — which for
 * a payload shaped like this one would tell the operator only "Invalid request
 * body" when the real fault is `lines.7.countedQty`.
 */
function validationIssues(error: z.ZodError): { issues: Array<{ path: string; message: string }> } {
  return {
    issues: error.issues.slice(0, 10).map((i) => ({ path: i.path.join('.'), message: i.message })),
  }
}

interface LineResult {
  productId: number
  /** On-hand before this line was touched. */
  systemQty: number
  countedQty: number
  /** What was ACTUALLY applied — always, on every path. 0 on a refusal, the
   *  planned variance on success, and the part that landed before a race. The
   *  requested variance is `countedQty - systemQty`, derivable by the caller. */
  delta: number
  ok: boolean
  code?: 'BELOW_ALLOCATED' | 'FAILED'
  /** Raw failure text, only on `FAILED`. */
  message?: string
  /** How far the line could legally have been reduced, on a refusal. */
  reducible?: number
  /** On-hand as it stands NOW — only set on the raced partial path, where it
   *  differs from `systemQty`. */
  nowOnHand?: number
  /** The surplus could not be attributed to a lot and was booked untracked. */
  surplusIsUntracked?: boolean
  /** Set only in the rare race below: some batches of this line already posted
   *  before a concurrent reservation blocked the rest. */
  partial?: boolean
}

/** Every balance row for one product at one location, at (batch × plate) grain.
 *  The planner sums them; the RPC decides which plate inside a batch gives up
 *  the units. */
async function readSlots(admin: any, productId: number, locationId: number): Promise<CountSlot[]> {
  const { data, error } = await admin
    .from('inventory_balances')
    .select('batch_id, on_hand, allocated, batches(expiry_date)')
    .eq('product_id', productId)
    .eq('location_id', locationId)
  if (error) throw new EdgeFunctionError('INTERNAL', `balance lookup failed: ${error.message}`)
  return ((data ?? []) as any[]).map((r) => ({
    batchId: r.batch_id != null ? Number(r.batch_id) : null,
    expiryDate: r.batches?.expiry_date ?? null,
    onHand: Number(r.on_hand),
    allocated: Number(r.allocated),
  }))
}

const sumOnHand = (slots: CountSlot[]): number => slots.reduce((s, r) => s + r.onHand, 0)
const sumReducible = (slots: CountSlot[]): number =>
  slots.reduce((s, r) => s + Math.max(0, r.onHand - r.allocated), 0)

serve(async (req: Request) => {
  const corsHeaders = corsHeadersFor(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const auth = await requireAuth(req, { allowedRoles: ALLOWED })

    // 20 locations/min/user. Nobody counts a bin every three seconds, and one
    // call now covers a whole bin rather than one line of it.
    const rl = await checkRateLimit(`count-bin:${auth.userId}`, { windowMs: 60_000, max: 20 })
    if (!rl.ok) {
      throw new EdgeFunctionError('TOO_MANY_REQUESTS', 'Rate limit exceeded — too many counts in a short period')
    }

    const body = await req.json().catch(() => {
      throw new EdgeFunctionError('INVALID_INPUT', 'Request body must be valid JSON')
    })
    const parsed = inputSchema.safeParse(body)
    if (!parsed.success) {
      throw new EdgeFunctionError('INVALID_INPUT', 'Invalid request body', validationIssues(parsed.error))
    }
    const { locationId, lines, note } = parsed.data

    // One product may not appear twice — two counted totals for the same SKU in
    // the same bin contradict each other, and applying both in sequence would
    // silently let the later one win over stock the earlier one just moved.
    const seen = new Set<number>()
    for (const l of lines) {
      if (seen.has(l.productId)) {
        throw new EdgeFunctionError('INVALID_INPUT', `Product ${l.productId} is counted twice in this request`)
      }
      seen.add(l.productId)
    }

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { persistSession: false } },
    )

    const { data: locationRow, error: locErr } = await admin
      .from('locations')
      .select('id, code, name, kind, is_active')
      .eq('id', locationId)
      .maybeSingle()
    if (locErr) throw new EdgeFunctionError('INTERNAL', `location lookup failed: ${locErr.message}`)
    if (!locationRow) throw new EdgeFunctionError('NOT_FOUND', `Location ${locationId} not found`)
    if ((locationRow as any).is_active === false) {
      throw new EdgeFunctionError('CONFLICT', 'That location is not active')
    }
    const locationCode = String((locationRow as any).code ?? (locationRow as any).name ?? locationId)

    // Warehouse-role staff may only count within their own site — the same rule
    // adjust-stock enforces, resolved the same way.
    if (auth.role === 'Warehouse') {
      const { data: rootWarehouseId, error: rootErr } = await admin.rpc('inv_root_warehouse', {
        p_location_id: locationId,
      })
      if (rootErr) throw new EdgeFunctionError('INTERNAL', `location lookup failed: ${rootErr.message}`)
      if (!rootWarehouseId || rootWarehouseId !== auth.profile.home_warehouse_id) {
        throw new EdgeFunctionError('FORBIDDEN', 'You can only count stock within your own warehouse')
      }
    }

    // The reason recorded on every leg. Auto-composed, not typed per line: the
    // operator is standing in an aisle holding a phone, and "which count was
    // this" is the only question the ledger has to be able to answer later.
    const stamp = new Date().toISOString().slice(0, 10)
    const reason = note
      ? `Stock count ${locationCode} · ${stamp} — ${note}`
      : `Stock count ${locationCode} · ${stamp}`

    const results: LineResult[] = []
    const auditLines: Array<Record<string, unknown>> = []
    const positiveLines: Array<{ product_id: number; quantity: number }> = []

    for (const line of lines) {
      const slots = await readSlots(admin, line.productId, locationId)
      const plan = planCountVariance(slots, line.countedQty)

      if (plan.ok === false) {
        results.push({
          productId: line.productId,
          systemQty: plan.systemQty,
          countedQty: plan.countedQty,
          delta: 0,
          ok: false,
          code: plan.code,
          reducible: plan.reducible,
        })
        continue
      }

      if (plan.delta === 0) {
        // The sheet filters these out, but a stale tab could still send one.
        results.push({
          productId: line.productId,
          systemQty: plan.systemQty,
          countedQty: plan.countedQty,
          delta: 0,
          ok: true,
        })
        continue
      }

      let applied = 0
      let raced = false
      let failure: string | null = null
      for (const take of plan.takes) {
        const { error: rpcError } = await admin.rpc('inv_adjust_stock', {
          p_product_id: line.productId,
          p_location_id: locationId,
          p_qty_delta: take.qtyDelta,
          p_reason: reason,
          p_actor: auth.userId,
          p_batch_id: take.batchId,
          p_movement_type: 'stocktake_variance',
          // Never plate-targeted: within a batch the RPC's own spread (loose
          // first, then oldest plate) is exactly the rule we want, and naming a
          // plate here would defeat it.
          p_handling_unit_id: null,
        })
        if (rpcError) {
          const message = rpcError.message ?? 'inventory adjustment failed'
          // The planner already proved there was headroom, so reaching this
          // means a reservation landed between the plan and the write. Report
          // it precisely — including that part of the line may already have
          // posted — rather than pretending the whole line failed cleanly.
          if (/ADJUSTMENT_BELOW_ALLOCATED/.test(message)) raced = true
          else failure = message
          break
        }
        applied += take.qtyDelta
      }

      // A line that failed for ANY reason is reported as a failed line, never
      // thrown. Throwing here would abandon the response for lines 1–4 that
      // already posted, leaving the operator with an error and no idea which
      // half of their count landed — the one outcome a stocktake screen must
      // never produce.
      if (failure) {
        const after = await readSlots(admin, line.productId, locationId)
        results.push({
          productId: line.productId,
          systemQty: plan.systemQty,
          countedQty: plan.countedQty,
          delta: applied,
          ok: false,
          code: 'FAILED',
          message: failure,
          nowOnHand: sumOnHand(after),
          partial: applied !== 0,
        })
        auditLines.push({
          productId: line.productId,
          systemQty: plan.systemQty,
          countedQty: plan.countedQty,
          appliedDelta: applied,
          failed: failure,
        })
        continue
      }

      if (raced) {
        // Re-read rather than arithmetic: after a partial application the
        // honest figures are whatever the database now holds, and the message
        // the operator gets ("N of M are reserved") is only useful if M is the
        // quantity actually sitting there right now.
        const after = await readSlots(admin, line.productId, locationId)
        results.push({
          productId: line.productId,
          systemQty: plan.systemQty,
          countedQty: plan.countedQty,
          delta: applied,
          ok: false,
          code: 'BELOW_ALLOCATED',
          nowOnHand: sumOnHand(after),
          reducible: sumReducible(after),
          partial: applied !== 0,
        })
        auditLines.push({
          productId: line.productId,
          systemQty: plan.systemQty,
          countedQty: plan.countedQty,
          appliedDelta: applied,
          refused: 'BELOW_ALLOCATED',
        })
        continue
      }

      results.push({
        productId: line.productId,
        systemQty: plan.systemQty,
        countedQty: plan.countedQty,
        delta: plan.delta,
        ok: true,
        surplusIsUntracked: plan.surplusIsUntracked,
      })
      auditLines.push({
        productId: line.productId,
        systemQty: plan.systemQty,
        countedQty: plan.countedQty,
        appliedDelta: plan.delta,
        surplusIsUntracked: plan.surplusIsUntracked,
      })
      if (plan.delta > 0) {
        positiveLines.push({ product_id: line.productId, quantity: plan.delta })
      }
    }

    const posted = results.filter((r) => r.ok && r.delta !== 0).length
    const refused = results.filter((r) => !r.ok).length

    // ONE audit event for the whole location. A forty-line bin is one count, not
    // forty decisions, and an event per line would bury the Audit Log under a
    // single afternoon of stocktaking.
    if (auditLines.length > 0) {
      await logAuditEvent(admin, {
        actorId: auth.userId,
        actorRole: auth.role,
        action: 'update',
        resource: 'inventory_count',
        resourceId: String(locationId),
        reason,
        metadata: {
          locationId,
          locationCode,
          note: note ?? null,
          posted,
          refused,
          lines: auditLines,
        },
      })
    }

    // Found stock that landed on a racked warehouse ROOT needs putting away,
    // same as a receipt. generatePutawayTasks self-skips for a specific bin and
    // for non-racked sites (mode 'legacy'), so counting a BIN upward raises
    // nothing while counting a bulk/staging root upward raises real tasks.
    // Advisory: a putaway failure must never fail a count that already posted.
    if (positiveLines.length > 0) {
      try {
        await generatePutawayTasks(admin, {
          warehouseId: locationId,
          lines: positiveLines,
          actorId: auth.userId,
        })
      } catch (_e) {
        // Advisory — swallow.
      }
    }

    return new Response(
      JSON.stringify({ ok: true, locationId, locationCode, posted, refused, results }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  } catch (e) {
    if (isEdgeFunctionError(e)) return e.toResponse(req)
    return errorResponse('INTERNAL', e instanceof Error ? e.message : 'Unknown error', undefined, undefined, req)
  }
})
