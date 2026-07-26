// complete-putaway Edge Function
//
// The second half of a two-stage putaway (mig 00080). decide-putaway with
// `assign_only` decides WHERE a line should go and moves nothing; this function
// runs when someone has physically carried it there, and it is the call that
// actually moves the stock — inside wie_complete_putaway_tx, so a failed
// transfer rolls the completion back and a task can never read as placed
// without a matching ledger leg.
//
// Scans are OPTIONAL here and enforced by the UI, exactly as record-pick does:
// this function deploys BEFORE the Walk view that sends scans, and the desk's
// one-step "Place now" path never scans. Evidence that IS supplied and does not
// match is always refused; no evidence is recorded as scan_verified:false so the
// two can be told apart later. Making scans mandatory server-side is then a
// one-line change, taken from real numbers rather than optimism.
//
// The scanned bin is AUTHORITATIVE. If the walker scanned a bay, that is where
// the stock went, whatever the client believed — so the code is resolved here
// and the client's actual_location_id is only cross-checked, never trusted over
// the scan.

// deno-lint-ignore-file no-explicit-any
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.103.0'
import { z } from 'https://esm.sh/zod@3.23.8'
import { requireAuth, type UserRole } from '../_shared/auth.ts'
import { EdgeFunctionError, errorResponse, isEdgeFunctionError } from '../_shared/errors.ts'
import { logAuditEvent } from '../_shared/audit.ts'
import { corsHeadersFor } from '../_shared/cors.ts'
import { checkRateLimit } from '../_shared/rateLimit.ts'
import { checkPutawayScan } from '../_shared/putawayScanCheck.ts'
import { normalizeScan } from '../_shared/scanNormalize.ts'

const ALLOWED: ReadonlyArray<UserRole> = ['Admin', 'Manager', 'Warehouse']

const inputSchema = z.object({
  recommendation_id: z.number().int().positive(),
  /** Where it was actually put. Optional when a bin scan names it. */
  actual_location_id: z.number().int().positive().optional(),
  /** Partial placement. Omitted = the whole assigned quantity. */
  quantity: z.number().positive().optional(),
  /** Cross a rack level's role gate (mig 00072) deliberately; always audited. */
  role_override: z.boolean().optional(),
  scan: z
    .object({
      locationCode: z.string().max(200).optional(),
      productCode: z.string().max(200).optional(),
      handlingUnitCode: z.string().max(200).optional(),
    })
    .optional(),
}).refine((d) => d.actual_location_id !== undefined || Boolean(d.scan?.locationCode), {
  message: 'either actual_location_id or a scanned bin code is required',
})

const PG_ERROR_CODES: ReadonlyArray<['NOT_FOUND' | 'CONFLICT' | 'INVALID_INPUT', string]> = [
  ['NOT_FOUND', 'NOT_FOUND:'],
  ['CONFLICT', 'CONFLICT:'],
  ['INVALID_INPUT', 'INVALID_QTY:'],
  ['INVALID_INPUT', 'INVALID_INPUT:'],
  ['INVALID_INPUT', 'INVALID_TRANSFER:'],
  ['CONFLICT', 'INSUFFICIENT_STOCK:'],
]

function rpcError(message: string): EdgeFunctionError {
  for (const [code, prefix] of PG_ERROR_CODES) {
    if (message.includes(prefix)) {
      return new EdgeFunctionError(code, message.slice(message.indexOf(prefix) + prefix.length).trim())
    }
  }
  return new EdgeFunctionError('INTERNAL', `putaway completion failed: ${message}`)
}

serve(async (req: Request) => {
  const corsHeaders = corsHeadersFor(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const auth = await requireAuth(req, { allowedRoles: ALLOWED })
    const rl = await checkRateLimit(`complete-putaway:${auth.userId}`, { windowMs: 60_000, max: 120 })
    if (!rl.ok) throw new EdgeFunctionError('TOO_MANY_REQUESTS', 'Rate limit exceeded')

    const body = await req.json().catch(() => {
      throw new EdgeFunctionError('INVALID_INPUT', 'Request body must be valid JSON')
    })
    const parsed = inputSchema.safeParse(body)
    if (!parsed.success) throw new EdgeFunctionError('INVALID_INPUT', 'Invalid request body', parsed.error.flatten())
    const { recommendation_id, actual_location_id, quantity, role_override, scan } = parsed.data

    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
      auth: { persistSession: false },
    })

    const { data: rec, error: rErr } = await admin.from('wie_putaway_recommendations')
      .select('*').eq('id', recommendation_id).single()
    if (rErr || !rec) throw new EdgeFunctionError('NOT_FOUND', `Putaway task ${recommendation_id} not found`)
    if ((rec as any).status !== 'assigned') {
      throw new EdgeFunctionError(
        'CONFLICT',
        (rec as any).status === 'suggested'
          ? 'That line has not been assigned to a bin yet'
          : `This task was already ${(rec as any).status} — someone else may have placed it`,
      )
    }

    const warehouseId = (rec as any).warehouse_id as number
    if (auth.role === 'Warehouse' && auth.profile.home_warehouse_id !== warehouseId) {
      throw new EdgeFunctionError('FORBIDDEN', 'You can only put away stock at your own warehouse')
    }

    // ── Resolve where it actually went ───────────────────────────────────────
    // locations.code is globally unique (mig 00027), so a scanned code names
    // exactly one bin and no warehouse scoping is needed to resolve it — only
    // to validate it, below.
    let actualId = actual_location_id ?? null
    const scannedBin = normalizeScan(scan?.locationCode ?? '')
    if (scannedBin) {
      const { data: byCode } = await admin.from('locations')
        .select('id, code').ilike('code', scannedBin).maybeSingle()
      if (!byCode) {
        throw new EdgeFunctionError('NOT_FOUND', `No location has the code ${scannedBin}`)
      }
      if (actualId != null && actualId !== (byCode as any).id) {
        throw new EdgeFunctionError(
          'INVALID_INPUT',
          'The scanned bin and the selected bin disagree — rescan the bin label',
        )
      }
      actualId = (byCode as any).id
    }
    if (actualId == null) throw new EdgeFunctionError('INVALID_INPUT', 'No bin given')

    const { data: binRow, error: binErr } = await admin.from('locations')
      .select('id, is_active, code, level_role').eq('id', actualId).single()
    if (binErr || !binRow) throw new EdgeFunctionError('NOT_FOUND', `Bin ${actualId} not found`)
    if (!(binRow as any).is_active) {
      throw new EdgeFunctionError('CONFLICT', 'That bin is no longer active — choose another')
    }
    const { data: root, error: rootErr } = await admin.rpc('inv_root_warehouse', { p_location_id: actualId })
    if (rootErr) throw new EdgeFunctionError('INTERNAL', `warehouse resolution failed: ${rootErr.message}`)
    if (root !== warehouseId) {
      throw new EdgeFunctionError('INVALID_INPUT', 'That bin is not inside this warehouse')
    }

    // ── Validate the scan evidence ───────────────────────────────────────────
    const productId = (rec as any).product_id as number
    const [{ data: productRow }, { data: huRow }, { data: assignedRow }] = await Promise.all([
      admin.from('products').select('id, sku, name, barcode').eq('id', productId).maybeSingle(),
      (rec as any).handling_unit_id
        ? admin.from('handling_units').select('code').eq('id', (rec as any).handling_unit_id).maybeSingle()
        : Promise.resolve({ data: null }),
      admin.from('locations').select('code').eq('id', (rec as any).assigned_location_id).maybeSingle(),
    ])
    if (!productRow) throw new EdgeFunctionError('NOT_FOUND', `Product ${productId} not found`)

    const remaining = Number((rec as any).quantity)
    const placedQty = quantity ?? remaining

    const verdict = checkPutawayScan(
      {
        assignedLocationCode: (assignedRow as any)?.code ?? '',
        product: {
          id: (productRow as any).id,
          sku: (productRow as any).sku,
          name: (productRow as any).name,
          barcode: (productRow as any).barcode,
        },
        huCode: (huRow as any)?.code ?? null,
        remainingQty: remaining,
      },
      scan ?? {},
      placedQty,
    )
    if (verdict.ok === false) {
      // CONFLICT, not INVALID_INPUT: the request is well-formed, it just
      // disagrees with the world. The message names what was scanned versus
      // what was expected, because it is read by someone standing at a rack.
      throw new EdgeFunctionError(
        verdict.code === 'INVALID_QTY' ? 'INVALID_INPUT' : 'CONFLICT',
        verdict.message,
      )
    }

    // ── Rack-level role gate (mig 00072) ─────────────────────────────────────
    // Re-checked here and not merely at assign time: a live re-level
    // (mutate-warehouse-location's set_levels) can change a level's role after
    // the desk assigned the task, and the walker may be placing in a bay nobody
    // assigned at all.
    const chosenLevelRole = (binRow as any).level_role as string | null
    let roleOverrideApplied = false
    let allowedRolesForSku: string[] | null = null
    if (chosenLevelRole) {
      const { data: attrs } = await admin.from('product_wms_attributes')
        .select('allowed_level_roles').eq('product_id', productId).maybeSingle()
      const rawRoles = (attrs as any)?.allowed_level_roles
      allowedRolesForSku = Array.isArray(rawRoles) && rawRoles.length > 0 ? rawRoles : null
      const roleAllowed = !allowedRolesForSku || allowedRolesForSku.includes(chosenLevelRole)
      if (!roleAllowed) {
        if (!role_override) {
          // `reason` is a stable marker, not prose: the Walk card keys its
          // "Place anyway" affordance off it rather than sniffing the message,
          // so rewording this sentence can never silently remove the operator's
          // only way past a wedged level.
          throw new EdgeFunctionError(
            'CONFLICT',
            `${(binRow as any).code} is a ${chosenLevelRole} level; ${(productRow as any).sku} is only ` +
              `allowed on ${allowedRolesForSku!.join('/')} levels. Place it elsewhere, or confirm "Place anyway".`,
            { reason: 'level_role_mismatch', binCode: (binRow as any).code, levelRole: chosenLevelRole },
          )
        }
        roleOverrideApplied = true
      }
    }

    // ── Move it ──────────────────────────────────────────────────────────────
    const { data: result, error: txErr } = await admin.rpc('wie_complete_putaway_tx', {
      p_rec_id: recommendation_id,
      p_actual: actualId,
      p_qty: quantity ?? null,
      p_actor: auth.userId,
    })
    if (txErr) {
      // The assign→place gap is now minutes or hours rather than milliseconds,
      // so an order can reserve this stock while the pallet is in transit.
      // inv_transfer_stock moves AVAILABLE stock only, so say that plainly
      // instead of leaking a raw RPC string at someone holding a pallet.
      if (txErr.message.includes('INSUFFICIENT_STOCK:')) {
        throw new EdgeFunctionError(
          'CONFLICT',
          `Not enough free stock left at the dock for this task — some of it was reserved ` +
            `for an order after the task was assigned. Re-check the line and place what is there.`,
        )
      }
      throw rpcError(txErr.message)
    }

    const placed = result as {
      placed_id: number
      status: string
      remainder_id: number | null
      remainder_qty: number
      moved: unknown
    }

    const { data: updated } = await admin.from('wie_putaway_recommendations')
      .select('*').eq('id', placed.placed_id).single()

    await logAuditEvent(admin, {
      actorId: auth.userId, actorRole: auth.role, action: 'update', resource: 'wie_putaway_recommendations',
      resourceId: String(placed.placed_id), after: (updated ?? {}) as Record<string, unknown>,
      metadata: {
        stage: 'complete',
        status: placed.status,
        assigned_location_id: (rec as any).assigned_location_id,
        actual_location_id: actualId,
        placed_elsewhere: verdict.placedElsewhere,
        quantity: placedQty,
        remainder_qty: placed.remainder_qty,
        source_recommendation_id: recommendation_id,
        moved: placed.moved,
        // Recorded on the audit event rather than the task row, for the same
        // reason record-pick does it: it avoids widening a signature every time
        // a new kind of evidence is captured (the mig 00037 overload trap).
        scan_verified: verdict.verified,
        scanned_location: scan?.locationCode ?? null,
        scanned_product: scan?.productCode ?? null,
        scanned_plate: scan?.handlingUnitCode ?? null,
        ...(roleOverrideApplied ? {
          role_override: true,
          sku: (productRow as any).sku,
          chosen_level_role: chosenLevelRole,
          allowed_level_roles: allowedRolesForSku,
        } : {}),
      },
    })

    // Stock has just ARRIVED somewhere in this warehouse, which is the other way
    // a replenishment becomes possible — and the only way the "slot is short but
    // there was nothing to pull" case ever resolves. A pick-only detector can
    // never see it: that state is entered by a putaway, not a pick, so without
    // this hook it stays stuck until a human presses a button.
    //
    // Advisory and hard-wrapped, like the receiving-side putaway trigger: the
    // pallet is already in the bay, and nothing downstream may undo that.
    try {
      await admin.rpc('wie_replen_detect', {
        p_warehouse_id: warehouseId,
        p_product_id: productId,
        p_actor: auth.userId,
        p_dry_run: false,
      })
    } catch { /* advisory */ }

    return new Response(JSON.stringify({
      ok: true,
      status: placed.status,
      placedElsewhere: verdict.placedElsewhere,
      scanVerified: verdict.verified,
      actualLocationId: actualId,
      actualLocationCode: (binRow as any).code,
      moved: placed.moved,
      remainder_id: placed.remainder_id,
      remainder_qty: placed.remainder_qty,
      recommendation: updated,
    }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (e) {
    if (isEdgeFunctionError(e)) return e.toResponse(req)
    return errorResponse('INTERNAL', e instanceof Error ? e.message : 'Unknown error', undefined, undefined, req)
  }
})
