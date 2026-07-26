// complete-replenishment Edge Function
//
// The floor stage of a replenishment (mig 00082): the walker has pulled the
// stock from a reserve/bulk bin and placed it in the pick slot, and this is
// where it actually moves.
//
// It exists as its own endpoint rather than reusing transfer-stock because
// transfer-stock is Admin/Manager only — the Warehouse role, which is the only
// role that ever does this work, could never call it.
//
// The two bins are treated asymmetrically, and that is the point (see
// _shared/replenScanCheck.ts): a different SOURCE is recorded as an override,
// because the assigned bay is often found empty or blocked; a different
// DESTINATION is refused, because putting the stock elsewhere leaves the very
// slot this task exists to refill exactly as short as it was.
//
// Scanned codes are authoritative. The client may send ids as a hint, but a
// stale client-side location list can never misdirect stock.

// deno-lint-ignore-file no-explicit-any
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.103.0'
import { z } from 'https://esm.sh/zod@3.23.8'
import { requireAuth, type UserRole } from '../_shared/auth.ts'
import { EdgeFunctionError, errorResponse, isEdgeFunctionError } from '../_shared/errors.ts'
import { logAuditEvent } from '../_shared/audit.ts'
import { corsHeadersFor } from '../_shared/cors.ts'
import { checkRateLimit } from '../_shared/rateLimit.ts'
import { normalizeScan } from '../_shared/scanNormalize.ts'
import { checkReplenScan } from '../_shared/replenScanCheck.ts'

const ALLOWED: ReadonlyArray<UserRole> = ['Admin', 'Manager', 'Warehouse']

const inputSchema = z.object({
  task_id: z.number().int().positive(),
  actual_from_location_id: z.number().int().positive().optional(),
  actual_to_location_id: z.number().int().positive().optional(),
  quantity: z.number().positive().optional(),
  scan: z.object({
    fromLocationCode: z.string().max(64).optional(),
    toLocationCode: z.string().max(64).optional(),
    productCode: z.string().max(64).optional(),
    handlingUnitCode: z.string().max(64).optional(),
  }).optional(),
}).refine(
  (d) => d.actual_from_location_id != null || d.scan?.fromLocationCode,
  { message: 'Scan the bin you pulled from, or choose it' },
).refine(
  (d) => d.actual_to_location_id != null || d.scan?.toLocationCode,
  { message: 'Scan the pick slot you placed into, or choose it' },
)

/** Resolve a scanned code to a location id, preferring the SCAN over any id the
 *  client supplied. locations.code is globally unique (mig 00027), so a code
 *  names exactly one bin. */
async function resolveBin(
  admin: any,
  hintedId: number | null | undefined,
  scannedCode: string,
  label: string,
): Promise<number> {
  let id = hintedId ?? null
  if (scannedCode) {
    const { data: byCode } = await admin.from('locations')
      .select('id, code').ilike('code', scannedCode).maybeSingle()
    if (!byCode) throw new EdgeFunctionError('NOT_FOUND', `No location has the code ${scannedCode}`)
    if (id != null && id !== byCode.id) {
      throw new EdgeFunctionError(
        'INVALID_INPUT',
        `The scanned ${label} and the selected ${label} disagree — rescan the bin label`,
      )
    }
    id = byCode.id
  }
  if (id == null) throw new EdgeFunctionError('INVALID_INPUT', `No ${label} given`)
  return id
}

serve(async (req: Request) => {
  const corsHeaders = corsHeadersFor(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const auth = await requireAuth(req, { allowedRoles: ALLOWED })
    const rl = await checkRateLimit(`complete-replenishment:${auth.userId}`, { windowMs: 60_000, max: 120 })
    if (!rl.ok) throw new EdgeFunctionError('TOO_MANY_REQUESTS', 'Rate limit exceeded')

    const body = await req.json().catch(() => {
      throw new EdgeFunctionError('INVALID_INPUT', 'Request body must be valid JSON')
    })
    const parsed = inputSchema.safeParse(body)
    if (!parsed.success) throw new EdgeFunctionError('INVALID_INPUT', 'Invalid request body', parsed.error.flatten())
    const { task_id, actual_from_location_id, actual_to_location_id, quantity, scan } = parsed.data

    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
      auth: { persistSession: false },
    })

    const { data: task, error: tErr } = await admin
      .from('wie_replen_tasks')
      .select('id, warehouse_id, product_id, to_location_id, assigned_from_location_id, status, quantity, handling_unit_id')
      .eq('id', task_id).maybeSingle()
    if (tErr) throw new EdgeFunctionError('INTERNAL', tErr.message)
    if (!task) throw new EdgeFunctionError('NOT_FOUND', `Replenishment task ${task_id} not found`)
    if ((task as any).status !== 'assigned') {
      throw new EdgeFunctionError(
        'CONFLICT',
        (task as any).status === 'suggested'
          ? 'That task has not been assigned a source bin yet'
          : `This task was already ${(task as any).status} — someone else may have moved it`,
      )
    }

    const warehouseId = (task as any).warehouse_id as number
    if (auth.role === 'Warehouse' && auth.profile.home_warehouse_id !== warehouseId) {
      throw new EdgeFunctionError('FORBIDDEN', 'You can only replenish at your own warehouse')
    }

    const scannedFrom = normalizeScan(scan?.fromLocationCode ?? '')
    const scannedTo = normalizeScan(scan?.toLocationCode ?? '')
    const fromId = await resolveBin(admin, actual_from_location_id, scannedFrom, 'source bin')
    const toId = await resolveBin(admin, actual_to_location_id, scannedTo, 'pick slot')

    if (fromId === toId) {
      throw new EdgeFunctionError('INVALID_INPUT', 'The source and the pick slot are the same bin')
    }

    // Both bins must be active and inside THIS warehouse. Resolve each bin's
    // ROOT rather than comparing raw ids — a levelled bin's id is nothing like
    // its warehouse's.
    for (const [id, label] of [[fromId, 'source bin'], [toId, 'pick slot']] as const) {
      const { data: loc } = await admin.from('locations')
        .select('id, code, is_active').eq('id', id).maybeSingle()
      if (!loc) throw new EdgeFunctionError('NOT_FOUND', `Location ${id} not found`)
      if (!(loc as any).is_active) {
        throw new EdgeFunctionError('CONFLICT', `${(loc as any).code} is no longer active`)
      }
      const { data: root, error: rootErr } = await admin.rpc('inv_root_warehouse', { p_location_id: id })
      if (rootErr) throw new EdgeFunctionError('INTERNAL', `warehouse resolution failed: ${rootErr.message}`)
      if (root !== warehouseId) {
        throw new EdgeFunctionError('INVALID_INPUT', `That ${label} is not inside this warehouse`)
      }
    }

    // ── Validate the scan evidence ───────────────────────────────────────────
    const productId = (task as any).product_id as number
    const [{ data: productRow }, { data: huRow }, { data: assignedRow }, { data: toRow }] = await Promise.all([
      admin.from('products').select('id, sku, name, barcode').eq('id', productId).maybeSingle(),
      (task as any).handling_unit_id
        ? admin.from('handling_units').select('code').eq('id', (task as any).handling_unit_id).maybeSingle()
        : Promise.resolve({ data: null }),
      admin.from('locations').select('code').eq('id', (task as any).assigned_from_location_id).maybeSingle(),
      admin.from('locations').select('code').eq('id', (task as any).to_location_id).maybeSingle(),
    ])
    if (!productRow) throw new EdgeFunctionError('NOT_FOUND', `Product ${productId} not found`)

    const remaining = Number((task as any).quantity)
    const movedQty = quantity ?? remaining

    const verdict = checkReplenScan(
      {
        assignedFromCode: (assignedRow as any)?.code ?? '',
        toCode: (toRow as any)?.code ?? '',
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
      movedQty,
    )
    if (verdict.ok === false) {
      // CONFLICT, not INVALID_INPUT: the request is well-formed, it just
      // disagrees with the world. Read by someone standing at a rack.
      throw new EdgeFunctionError(
        verdict.code === 'INVALID_QTY' ? 'INVALID_INPUT' : 'CONFLICT',
        verdict.message,
        verdict.code === 'WRONG_DESTINATION'
          ? { reason: 'wrong_destination', expected: (toRow as any)?.code ?? null }
          : undefined,
      )
    }

    // The plate that MOVES is the one the walker scanned, not the one the
    // detector expected — a source override invalidates the detector's guess.
    let movedHuId: number | null = null
    const scannedPlate = normalizeScan(scan?.handlingUnitCode ?? '')
    if (scannedPlate) {
      const { data: hu } = await admin.from('handling_units')
        .select('id').ilike('code', scannedPlate).maybeSingle()
      movedHuId = (hu as any)?.id ?? null
    } else if (!verdict.pulledElsewhere) {
      movedHuId = (task as any).handling_unit_id ?? null
    }

    // ── Move it ──────────────────────────────────────────────────────────────
    const { data: result, error: txErr } = await admin.rpc('wie_complete_replen_tx', {
      p_task_id: task_id,
      p_actual_from: fromId,
      p_actual_to: toId,
      p_qty: quantity ?? null,
      p_handling_unit_id: movedHuId,
      p_actor: auth.userId,
    })
    if (txErr) {
      const msg = txErr.message ?? ''
      // The assign→move gap is minutes or hours, so an order can reserve this
      // stock while the walker is en route. inv_transfer_stock moves AVAILABLE
      // stock only — say that plainly, and as a CONFLICT rather than an
      // INTERNAL, because the walker is at the rack and can reduce the quantity
      // or pull from another bay.
      if (msg.includes('INSUFFICIENT_STOCK')) {
        throw new EdgeFunctionError(
          'CONFLICT',
          'Not enough free stock left in that bin — some of it was reserved for an order after this task ' +
            'was assigned. Reduce the quantity, or pull from another bay.',
          { reason: 'insufficient_stock' },
        )
      }
      if (msg.includes('INVALID_DESTINATION')) {
        throw new EdgeFunctionError(
          'CONFLICT',
          'That bin is not a pick zone, so replenishing into it would leave the slot this task exists to refill ' +
            'still short.',
          { reason: 'invalid_destination' },
        )
      }
      if (/CONFLICT|INVALID_QTY|INVALID_INPUT|INVALID_TRANSFER|NOT_FOUND/.test(msg)) {
        throw new EdgeFunctionError('CONFLICT', msg.replace(/^[A-Z_]+:\s*/, ''))
      }
      throw new EdgeFunctionError('INTERNAL', msg)
    }

    const done = result as {
      completed_id: number
      status: string
      source_warning: boolean
      remainder_id: number | null
      remainder_qty: number
      moved: unknown
    }

    // Evidence rides on the audit event rather than widening the task row —
    // the same choice record-pick and complete-putaway make, so a new kind of
    // evidence never means a new column or a changed RPC signature.
    await logAuditEvent(admin, {
      actorId: auth.userId, actorRole: auth.role, action: 'update', resource: 'wie_replen_tasks',
      resourceId: String(task_id),
      metadata: {
        stage: 'complete',
        status: done.status,
        from_location_id: fromId,
        to_location_id: toId,
        quantity: movedQty,
        scan_verified: verdict.verified,
        pulled_elsewhere: verdict.pulledElsewhere,
        scanned_from: verdict.scannedFromCode,
        scanned_to: verdict.scannedToCode,
        source_outside_replen_roles: done.source_warning,
        handling_unit_id: movedHuId,
      },
    })

    // A completed replenishment changes what the slot holds, which can clear the
    // shortfall or reveal that it is still short. Advisory: never fail the move
    // the walker already made.
    try {
      await admin.rpc('wie_replen_detect', {
        p_warehouse_id: warehouseId, p_product_id: productId,
        p_actor: auth.userId, p_dry_run: false,
      })
    } catch { /* advisory */ }

    return new Response(JSON.stringify({ ok: true, result: done, verified: verdict.verified,
      pulledElsewhere: verdict.pulledElsewhere }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (e) {
    if (isEdgeFunctionError(e)) return e.toResponse(req)
    return errorResponse('INTERNAL', e instanceof Error ? e.message : 'Unknown error', undefined, undefined, req)
  }
})
