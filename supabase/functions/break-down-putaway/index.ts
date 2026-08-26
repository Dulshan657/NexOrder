// break-down-putaway Edge Function
//
// Take part of a pallet off it, at the rack, mid-walk. Each portion becomes a
// NEW labelled handling unit with its own destination and its own walk stop.
//
// WHY THIS IS ITS OWN FUNCTION and not a fourth decide-putaway decision: the
// payload fans out over plates rather than closing out one recommendation, and
// it mints rows in two tables. Same reason count-bin is its own function rather
// than a loop over adjust-stock.
//
// WHAT IT DOES NOT DO: move stock to a bay. The portions are re-plated WHERE
// THEY ALREADY ARE — at the warehouse root — and become 'assigned' tasks.
// complete-putaway still moves each one, per plate, with the plate + bin scan
// that already exists. That keeps 00080's promise ("un-placed goods read as
// sitting at the warehouse root, which is where they actually are"), it makes
// 00123's pending-occupancy view charge the destination bays immediately and
// correctly, and — not least — the child stop's plate scan is what verifies the
// freshly-printed sticker actually went onto the right stack.
//
// TWO PHASES, ONE CODE PATH. `dry_run: true` returns before any write, having
// scored every portion through the putaway engine AS THE CONTAINER IT WILL
// BECOME. That is why the suggestion cannot be lifted off the parent task's own
// `alternatives`: those were scored for a pallet, and a 6-carton portion bound
// for a pick face has a completely different candidate set once
// `rolesForHuType` (mig 00081) is applied to it.

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
import { generatePutawayTasks } from '../_shared/putawayTasks.ts'
import {
  COUNTED_UNITS,
  huTypeForUnit,
  planBreakdown,
  type CountedUnit,
} from '../_shared/palletBreakdown.ts'

const ALLOWED: ReadonlyArray<UserRole> = ['Admin', 'Manager', 'Warehouse']

// A pallet breaks into a handful of portions, not a hundred. The cap is a
// runaway guard, not a policy — a real break-down is two or three rows.
const MAX_PORTIONS = 12

const inputSchema = z.object({
  recommendation_id: z.number().int().positive(),
  portions: z.array(z.object({
    /** Base units. The client converts from whatever was counted in — see
     *  _shared/palletBreakdown.ts for why layers cannot be converted here. */
    base_qty: z.number().positive(),
    counted_unit: z.enum(COUNTED_UNITS as [CountedUnit, ...CountedUnit[]]),
    /** Confirmed destination. Optional on a dry run, which is what ASKS for one. */
    location_id: z.number().int().positive().nullish(),
  })).min(1).max(MAX_PORTIONS),
  /** Cross a rack level's role gate (mig 00072) deliberately; always audited. */
  role_override: z.boolean().optional(),
  /** Score and plan, write nothing. Returns before the audit event too. */
  dry_run: z.boolean().optional(),
})

const PG_ERROR_CODES: ReadonlyArray<['NOT_FOUND' | 'CONFLICT' | 'INVALID_INPUT', string]> = [
  ['NOT_FOUND', 'NOT_FOUND:'],
  ['CONFLICT', 'CONFLICT:'],
  ['INVALID_INPUT', 'INVALID_QTY:'],
  ['INVALID_INPUT', 'INVALID_INPUT:'],
  ['CONFLICT', 'INSUFFICIENT_STOCK:'],
]

function rpcError(message: string): EdgeFunctionError {
  for (const [code, prefix] of PG_ERROR_CODES) {
    if (message.includes(prefix)) {
      return new EdgeFunctionError(code, message.slice(message.indexOf(prefix) + prefix.length).trim())
    }
  }
  return new EdgeFunctionError('INTERNAL', `break-down failed: ${message}`)
}

serve(async (req: Request) => {
  const corsHeaders = corsHeadersFor(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    requireModule('inventory_dispatch')
    const auth = await requireAuth(req, { allowedRoles: ALLOWED })
    // Its own bucket at 10/min. This mints plates and task rows, so a burst is a
    // double-tap or a mistake — and it must not share a budget with the
    // ordinary 120/min putaway traffic the same operator is generating on the
    // same walk.
    const rl = await checkRateLimit(`break-down-putaway:${auth.userId}`, { windowMs: 60_000, max: 10 })
    if (!rl.ok) throw new EdgeFunctionError('TOO_MANY_REQUESTS', 'Rate limit exceeded')

    const body = await req.json().catch(() => {
      throw new EdgeFunctionError('INVALID_INPUT', 'Request body must be valid JSON')
    })
    const parsed = inputSchema.safeParse(body)
    if (!parsed.success) {
      throw new EdgeFunctionError('INVALID_INPUT', 'Invalid request body', parsed.error.flatten())
    }
    const { recommendation_id, portions, role_override, dry_run } = parsed.data

    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
      auth: { persistSession: false },
    })

    const { data: rec, error: rErr } = await admin.from('wie_putaway_recommendations')
      .select('*').eq('id', recommendation_id).single()
    if (rErr || !rec) {
      throw new EdgeFunctionError('NOT_FOUND', `Putaway task ${recommendation_id} not found`)
    }
    if ((rec as any).status !== 'assigned') {
      throw new EdgeFunctionError(
        'CONFLICT',
        (rec as any).status === 'suggested'
          ? 'That line has not been assigned to a bin yet'
          : `This task was already ${(rec as any).status} — someone else may have moved it`,
      )
    }
    if ((rec as any).handling_unit_id == null) {
      throw new EdgeFunctionError(
        'INVALID_INPUT',
        'This line is not on a plate, so there is nothing to break down — place part of it instead',
      )
    }

    const warehouseId = (rec as any).warehouse_id as number
    const productId = (rec as any).product_id as number
    if (auth.role === 'Warehouse' && auth.profile.home_warehouse_id !== warehouseId) {
      throw new EdgeFunctionError('FORBIDDEN', 'You can only put away stock at your own warehouse')
    }

    // ── The same plan the sheet drew ─────────────────────────────────────────
    // Re-made here rather than trusted: the client's arithmetic is a preview,
    // and the row lock inside the RPC re-checks the total a third time against
    // a quantity that cannot change underneath it.
    const plan = planBreakdown({
      parentQty: Number((rec as any).quantity),
      portions: portions.map((p) => ({
        baseQty: p.base_qty,
        countedUnit: p.counted_unit,
        // A dry run is allowed to have no destination yet — asking for one is
        // the entire point of it — so only the commit path demands it.
        locationId: dry_run ? (p.location_id ?? 0) : (p.location_id ?? null),
      })),
    })
    if (!plan.ok) {
      throw new EdgeFunctionError('INVALID_INPUT', plan.message ?? 'That break-down does not add up', {
        reason: plan.reason,
        allocated: plan.allocated,
        remainder: plan.remainder,
      })
    }

    // ── Score every portion as the container it will become ──────────────────
    // ONE call, not one per portion: `generatePutawayTasks` folds each
    // allocation into a greedy `overlay` so a later portion sees a bay the
    // earlier one just filled. Two carton portions would otherwise both be
    // offered the same pick bay, which is the same double-booking bug 00123
    // fixed across receipts.
    const suggestions = new Map<string, { locationId: number | null; alternatives: unknown; explanation: unknown }>()
    const engine = await generatePutawayTasks(admin, {
      warehouseId,
      actorId: auth.userId,
      goodsReceiptId: (rec as any).goods_receipt_id ?? undefined,
      dryRun: true,
      lines: portions.map((p, i) => ({
        product_id: productId,
        quantity: p.base_qty,
        hu_type: huTypeForUnit(p.counted_unit),
        ref: String(i),
      })),
    })
    for (const r of engine.recommendations) {
      // First allocation wins: the engine may split one line across bins, but a
      // break-down portion is one physical plate and goes in one place. The
      // rest are visible to the operator as alternatives, not as extra plates.
      if (r.ref != null && !suggestions.has(r.ref)) {
        suggestions.set(r.ref, {
          locationId: r.recommendedLocationId,
          alternatives: r.alternatives,
          explanation: r.explanation,
        })
      }
    }

    const planned = portions.map((p, i) => {
      const suggestion = suggestions.get(String(i)) ?? null
      return {
        index: i,
        baseQty: p.base_qty,
        countedUnit: p.counted_unit,
        huType: huTypeForUnit(p.counted_unit),
        recommendedLocationId: suggestion?.locationId ?? null,
        alternatives: suggestion?.alternatives ?? [],
        explanation: suggestion?.explanation ?? {},
        // On a commit the operator has confirmed a bin; on a dry run this is
        // whatever they have chosen so far, which may be nothing.
        locationId: p.location_id ?? null,
      }
    })

    if (dry_run) {
      return new Response(JSON.stringify({
        ok: true,
        dryRun: true,
        mode: engine.mode,
        parentRemaining: plan.remainder,
        parentClosed: plan.parentEmptied,
        portions: planned,
      }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    // ── Validate the destinations ────────────────────────────────────────────
    const locationIds = [...new Set(planned.map((p) => p.locationId as number))]
    const { data: binRows, error: binErr } = await admin.from('locations')
      .select('id, code, is_active, level_role').in('id', locationIds)
    if (binErr) throw new EdgeFunctionError('INTERNAL', `bin lookup failed: ${binErr.message}`)
    const binById = new Map(((binRows ?? []) as any[]).map((b) => [b.id, b]))

    for (const id of locationIds) {
      const bin = binById.get(id)
      if (!bin) throw new EdgeFunctionError('NOT_FOUND', `Bin ${id} not found`)
      if (!bin.is_active) {
        throw new EdgeFunctionError('CONFLICT', `${bin.code} is no longer active — choose another bin`)
      }
      const { data: root, error: rootErr } = await admin.rpc('inv_root_warehouse', { p_location_id: id })
      if (rootErr) throw new EdgeFunctionError('INTERNAL', `warehouse resolution failed: ${rootErr.message}`)
      if (root !== warehouseId) {
        throw new EdgeFunctionError('INVALID_INPUT', `${bin.code} is not inside this warehouse`)
      }
    }

    // ── Rack-level role gate (mig 00072) ─────────────────────────────────────
    // EVERY offending destination is named, not just the first: one press of
    // "Place anyway" has to clear the whole sheet, or the operator overrides
    // three times for one break-down.
    const { data: attrs } = await admin.from('product_wms_attributes')
      .select('allowed_level_roles').eq('product_id', productId).maybeSingle()
    const rawRoles = (attrs as any)?.allowed_level_roles
    const allowedRolesForSku: string[] | null =
      Array.isArray(rawRoles) && rawRoles.length > 0 ? rawRoles : null

    const roleMismatches = allowedRolesForSku
      ? locationIds
        .map((id) => binById.get(id))
        .filter((bin) => bin?.level_role && !allowedRolesForSku.includes(bin.level_role))
        .map((bin) => ({ binCode: bin.code as string, levelRole: bin.level_role as string }))
      : []

    if (roleMismatches.length > 0 && !role_override) {
      const { data: productRow } = await admin.from('products')
        .select('sku').eq('id', productId).maybeSingle()
      const sku = (productRow as any)?.sku ?? `product ${productId}`
      throw new EdgeFunctionError(
        'CONFLICT',
        `${roleMismatches.map((m) => `${m.binCode} is a ${m.levelRole} level`).join(', ')}; ` +
          `${sku} is only allowed on ${allowedRolesForSku!.join('/')} levels. ` +
          'Choose different bins, or confirm "Place anyway".',
        // A stable marker, not prose: the sheet keys its override affordance off
        // this rather than sniffing the message, so rewording the sentence can
        // never silently remove the operator's only way past a wedged level.
        { reason: 'level_role_mismatch', mismatches: roleMismatches },
      )
    }

    // ── Break it down ────────────────────────────────────────────────────────
    const { data: result, error: txErr } = await admin.rpc('wie_break_down_putaway_tx', {
      p_rec_id: recommendation_id,
      p_portions: planned.map((p) => ({
        qty: p.baseQty,
        hu_type: p.huType,
        location_id: p.locationId,
        recommended_location_id: p.recommendedLocationId,
        alternatives: p.alternatives,
        explanation: p.explanation,
      })),
      p_actor: auth.userId,
    })
    if (txErr) {
      if (txErr.message.includes('INSUFFICIENT_STOCK:')) {
        throw new EdgeFunctionError(
          'CONFLICT',
          'Not enough free stock left on that plate — some of it was reserved for an order ' +
            'after the task was assigned. Re-check the line and break down what is there.',
        )
      }
      throw rpcError(txErr.message)
    }

    const broken = result as {
      parent_id: number
      parent_remaining: number
      parent_closed: boolean
      plates: Array<{
        recommendation_id: number
        handling_unit_id: number
        code: string
        hu_type: string
        quantity: number
        location_id: number
      }>
    }

    // ONE audit event for the whole break-down, like count-bin — not one per
    // plate. The act is "this pallet was broken into these plates"; N events
    // would make that a query rather than a record.
    await logAuditEvent(admin, {
      actorId: auth.userId, actorRole: auth.role, action: 'update',
      resource: 'wie_putaway_recommendations', resourceId: String(recommendation_id),
      after: (broken ?? {}) as unknown as Record<string, unknown>,
      metadata: {
        stage: 'break_down',
        product_id: productId,
        parent_handling_unit_id: (rec as any).handling_unit_id,
        parent_remaining: broken.parent_remaining,
        parent_closed: broken.parent_closed,
        portions: planned.map((p) => ({
          quantity: p.baseQty,
          counted_unit: p.countedUnit,
          hu_type: p.huType,
          location_id: p.locationId,
          recommended_location_id: p.recommendedLocationId,
          followed_engine: p.locationId === p.recommendedLocationId,
        })),
        plates: broken.plates.map((pl) => ({ code: pl.code, id: pl.handling_unit_id })),
        ...(roleMismatches.length > 0 ? {
          role_override: true,
          allowed_level_roles: allowedRolesForSku,
          mismatches: roleMismatches,
        } : {}),
      },
    })

    // wie_replen_detect is deliberately NOT called: no stock has arrived
    // anywhere. It fires when a plate actually reaches a bay, in
    // complete-putaway, once per child stop.

    return new Response(JSON.stringify({
      ok: true,
      parentId: broken.parent_id,
      parentRemaining: broken.parent_remaining,
      parentClosed: broken.parent_closed,
      plates: broken.plates.map((pl) => ({
        recommendationId: pl.recommendation_id,
        handlingUnitId: pl.handling_unit_id,
        code: pl.code,
        huType: pl.hu_type,
        quantity: Number(pl.quantity),
        locationId: pl.location_id,
        locationCode: binById.get(pl.location_id)?.code ?? null,
      })),
    }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  } catch (e) {
    if (isEdgeFunctionError(e)) return e.toResponse(req)
    return errorResponse('INTERNAL', e instanceof Error ? e.message : 'Unknown error', undefined, undefined, req)
  }
})
