// record-pick Edge Function
//
// A warehouse worker (or Admin/Manager) confirms picking a quantity of one
// order line AT A SPECIFIC WAREHOUSE. Delegates the atomic decrement (on_hand--
// and allocated-- across FIFO batches at that location, plus the pick_progress
// row) to the inv_pick_order_line RPC. When the warehouse's portion of the order
// is fully picked, advances that order_fulfillments row to 'picked' and
// recomputes the derived orders.status. Legacy orders (no fulfilments) keep the
// order-level "advance to picked when fully picked" behaviour.

// deno-lint-ignore-file no-explicit-any
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.103.0'
import { z } from 'https://esm.sh/zod@3.23.8'
import { requireAuth, type UserRole } from '../_shared/auth.ts'
import { EdgeFunctionError, errorResponse, isEdgeFunctionError } from '../_shared/errors.ts'
import { logAuditEvent } from '../_shared/audit.ts'
import { corsHeadersFor } from '../_shared/cors.ts'
import { checkRateLimit } from '../_shared/rateLimit.ts'
import { isLocationFullyPicked, recomputeOrderStatus } from '../_shared/fulfillment.ts'
import { checkPickScan } from '../_shared/pickScanCheck.ts'

const ALLOWED: ReadonlyArray<UserRole> = ['Admin', 'Manager', 'Warehouse']

const inputSchema = z.object({
  orderItemId: z.number().int().positive(),
  pickedQty: z.number().positive(),
  locationId: z.number().int().positive().optional(),
  // Scan-confirmed picking (Phase 3). The client checks these too, so the
  // operator gets instant feedback, but that check is a convenience — anything
  // can POST here, so the server re-validates every code it is given.
  //
  // Optional by design: this function deploys BEFORE the UI that sends scans,
  // and the legacy/bulk pick paths never scan. Evidence that IS supplied and
  // does NOT match is always refused; a pick with no evidence is allowed and
  // recorded as unverified, so the two are distinguishable in the audit trail.
  scan: z
    .object({
      locationCode: z.string().max(120).optional(),
      productCode: z.string().max(120).optional(),
      handlingUnitCode: z.string().max(120).optional(),
    })
    .optional(),
})

serve(async (req: Request) => {
  const corsHeaders = corsHeadersFor(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const auth = await requireAuth(req, { allowedRoles: ALLOWED })

    const rl = await checkRateLimit(`record-pick:${auth.userId}`, { windowMs: 60_000, max: 120 })
    if (!rl.ok) {
      throw new EdgeFunctionError('TOO_MANY_REQUESTS', 'Rate limit exceeded — too many picks in a short period')
    }

    const body = await req.json().catch(() => {
      throw new EdgeFunctionError('INVALID_INPUT', 'Request body must be valid JSON')
    })
    const parsed = inputSchema.safeParse(body)
    if (!parsed.success) {
      throw new EdgeFunctionError('INVALID_INPUT', 'Invalid request body', parsed.error.flatten())
    }
    const { orderItemId, pickedQty } = parsed.data

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { persistSession: false } },
    )

    // Resolve the warehouse this pick happens at: explicit > the picker's home
    // warehouse > the default warehouse. Warehouse staff may only pick at their
    // own site — but a directed pick's locationId is a BIN (racked warehouses),
    // never equal to the warehouse id itself, so the guard must resolve the
    // bin's ROOT warehouse (mig 00040) before comparing to home_warehouse_id.
    // Comparing the raw bin id directly (as before) 403'd every racked pick.
    let locationId = parsed.data.locationId ?? auth.profile.home_warehouse_id ?? null
    if (auth.role === 'Warehouse' && parsed.data.locationId) {
      const { data: rootData } = await admin.rpc('inv_root_warehouse', {
        p_location_id: parsed.data.locationId,
      })
      const pickWarehouseId = typeof rootData === 'number' ? rootData : parsed.data.locationId
      if (pickWarehouseId !== auth.profile.home_warehouse_id) {
        throw new EdgeFunctionError('FORBIDDEN', 'You can only pick at your own warehouse')
      }
    }
    if (locationId == null) {
      const { data: def } = await admin
        .from('locations')
        .select('id')
        .eq('kind', 'WAREHOUSE')
        .eq('is_active', true)
        .order('id')
        .limit(1)
        .maybeSingle()
      locationId = (def as any)?.id ?? null
    }

    // ── Scan re-validation ────────────────────────────────────────────────
    // Runs BEFORE the RPC: a mismatch must not decrement anything.
    let scanVerified = false
    if (parsed.data.scan && locationId != null) {
      const [{ data: locRow }, { data: itemForScan }] = await Promise.all([
        admin.from('locations').select('code').eq('id', locationId).maybeSingle(),
        admin
          .from('order_items')
          .select('product_id, quantity, products(sku, name, barcode)')
          .eq('id', orderItemId)
          .maybeSingle(),
      ])
      if (!locRow) throw new EdgeFunctionError('NOT_FOUND', `Location ${locationId} not found`)
      if (!itemForScan) throw new EdgeFunctionError('NOT_FOUND', `Order line ${orderItemId} not found`)

      const product = (itemForScan as any).products
      if (!product) {
        throw new EdgeFunctionError('INTERNAL', 'Order line has no product to verify against')
      }

      // Remaining is expressed in ORDER units, matching pickedQty (the RPC
      // scales by pack_size internally).
      const { data: progressRows } = await admin
        .from('pick_progress')
        .select('picked_qty')
        .eq('order_item_id', orderItemId)
      const already = ((progressRows ?? []) as Array<{ picked_qty: number }>)
        .reduce((sum, r) => sum + Number(r.picked_qty || 0), 0)
      const remaining = Number((itemForScan as any).quantity) - already

      const verdict = checkPickScan(
        {
          taskLocationCode: (locRow as any).code,
          product: {
            id: (itemForScan as any).product_id,
            sku: product.sku,
            name: product.name,
            barcode: product.barcode ?? null,
          },
          remainingQty: remaining,
        },
        parsed.data.scan,
        pickedQty,
      )
      if (!verdict.ok) {
        // CONFLICT, not INVALID_INPUT: the request was well-formed, it just
        // does not describe the world. The UI shows `message` verbatim to an
        // operator standing at the rack, so it names what they scanned and
        // what was expected.
        throw new EdgeFunctionError('CONFLICT', verdict.message, { reason: verdict.code })
      }
      scanVerified = verdict.verified

      // A scanned plate must actually hold this product at this bin — otherwise
      // the operator is looking at a different pallet than the one they think.
      const huCode = parsed.data.scan.handlingUnitCode?.trim()
      if (huCode) {
        const { data: huRow } = await admin
          .from('handling_units')
          .select('id, code')
          .ilike('code', huCode)
          .maybeSingle()
        if (!huRow) {
          throw new EdgeFunctionError('CONFLICT', `No pallet or carton with code ${huCode}.`, {
            reason: 'UNKNOWN_PLATE',
          })
        }
        const { count } = await admin
          .from('inventory_balances')
          .select('id', { count: 'exact', head: true })
          .eq('handling_unit_id', (huRow as any).id)
          .eq('product_id', (itemForScan as any).product_id)
          .eq('location_id', locationId)
          .gt('on_hand', 0)
        if (!count) {
          throw new EdgeFunctionError(
            'CONFLICT',
            `${(huRow as any).code} does not hold any ${product.sku} at this bin.`,
            { reason: 'PLATE_MISMATCH' },
          )
        }
      }
    }

    const { data: pickResult, error: rpcError } = await admin.rpc('inv_pick_order_line', {
      p_order_item_id: orderItemId,
      p_picked_qty: pickedQty,
      p_location_id: locationId,
      p_actor: auth.userId,
    })
    if (rpcError) {
      const msg = rpcError.message ?? 'pick failed'
      const conflict = /OVER_PICK|INSUFFICIENT_STOCK/.test(msg)
      throw new EdgeFunctionError(conflict ? 'CONFLICT' : 'INTERNAL', `pick failed: ${msg}`)
    }

    const result = pickResult as { line_fully_picked: boolean; order_fully_picked: boolean }

    const { data: itemRow } = await admin
      .from('order_items')
      .select('order_id, product_id')
      .eq('id', orderItemId)
      .single()
    const orderId = (itemRow as { order_id: string } | null)?.order_id ?? null
    const pickedProductId = (itemRow as { product_id: number } | null)?.product_id ?? null

    // The bin's ROOT warehouse — a racked pick lands on a level whose id is
    // nothing like its warehouse's. Hoisted out of the fulfilment block below so
    // the replenishment hook can use it too.
    const { data: rootWh } = await admin.rpc('inv_root_warehouse', { p_location_id: locationId })
    const pickWarehouseId = (typeof rootWh === 'number' ? rootWh : null) ?? locationId!

    if (orderId) {
      const nowIso = new Date().toISOString()
      // A pick may land on a bin (racked); the fulfilment is keyed by the bin's
      // root warehouse (mig 00040). Resolved once above, so the replenishment
      // hook at the end of this handler can reuse it.
      const warehouseId = pickWarehouseId

      // Fulfilment model: advance this warehouse's fulfilment to 'picked' once its
      // portion is fully picked, then recompute the derived order status.
      const { data: ful } = await admin
        .from('order_fulfillments')
        .select('id, status, status_history')
        .eq('order_id', orderId)
        .eq('location_id', warehouseId)
        .maybeSingle()

      if (ful) {
        if ((ful as any).status === 'processed' && (await isLocationFullyPicked(admin, orderId, warehouseId))) {
          const hist = Array.isArray((ful as any).status_history) ? (ful as any).status_history : []
          await admin
            .from('order_fulfillments')
            .update({
              status: 'picked',
              status_history: [...hist, { status: 'picked', timestamp: nowIso, actor: auth.userId, note: 'All lines picked at this warehouse' }],
            })
            .eq('id', (ful as any).id)
        }
        await recomputeOrderStatus(admin, orderId, auth.userId, nowIso)
      } else if (result.order_fully_picked) {
        // Legacy order (no fulfilments): advance the order to 'picked'.
        const { data: order } = await admin
          .from('orders')
          .select('status, status_history')
          .eq('id', orderId)
          .single()
        if ((order as any)?.status === 'processed') {
          const history = Array.isArray((order as any)?.status_history) ? (order as any).status_history : []
          await admin
            .from('orders')
            .update({
              status: 'picked',
              status_history: [...history, { status: 'picked', timestamp: nowIso, actor: auth.userId, note: 'All lines picked' }],
            })
            .eq('id', orderId)
        }
      }
    }

    await logAuditEvent(admin, {
      actorId: auth.userId,
      actorRole: auth.role,
      action: 'update',
      resource: 'pick_progress',
      resourceId: orderId,
      // scan_verified is recorded here rather than on pick_progress on purpose:
      // audit_events (mig 00012) is already the "who did what, and how it was
      // confirmed" record, and using it avoids a third change to
      // inv_pick_order_line's signature — every one of which risks the
      // ambiguous-overload trap that bit 00037 and again in 00075.
      after: {
        orderItemId,
        pickedQty,
        locationId,
        scan_verified: scanVerified,
        scanned_location: parsed.data.scan?.locationCode ?? null,
        scanned_product: parsed.data.scan?.productCode ?? null,
        scanned_plate: parsed.data.scan?.handlingUnitCode ?? null,
        ...result,
      },
    })

    // A pick is the moment a pick zone drains, so this is where a shortfall
    // becomes true. Advisory and hard-wrapped: replenishment is a suggestion,
    // and a picker must never be told their pick failed because a downstream
    // detector had a bad day. Same rule generatePutawayTasks is called under.
    //
    // wie_replen_detect (mig 00082) opens with a cheap EXISTS bail when no home
    // bin in this warehouse has replenishment enabled, so on a site that does
    // not use it this costs a couple of index hits on the hottest warehouse
    // endpoint there is.
    try {
      await admin.rpc('wie_replen_detect', {
        p_warehouse_id: pickWarehouseId,
        p_product_id: pickedProductId,
        p_actor: auth.userId,
        p_dry_run: false,
      })
    } catch { /* advisory */ }

    return new Response(JSON.stringify({ ok: true, locationId, scanVerified, ...result }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (e) {
    if (isEdgeFunctionError(e)) return e.toResponse(req)
    return errorResponse('INTERNAL', e instanceof Error ? e.message : 'Unknown error', undefined, undefined, req)
  }
})
