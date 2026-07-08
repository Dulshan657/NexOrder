// update-order-status Edge Function
//
// Server-side authorisation for order status changes. Direct UPDATE on
// orders.status is denied by RLS to all clients; only the service role
// (this function) can change status.
//
// Multi-warehouse (mig 00036): an order is split across the warehouses that hold
// a reservation, each tracked by an order_fulfillments row with its own
// picked->packed->dispatched->delivered lifecycle. orders.status is the DERIVED
// rollup (least-advanced site). Two modes:
//   * processing -> processed  (order-level): optionally re-route via locationPref,
//     then create one fulfilment per reserved warehouse.
//   * picked/packed/dispatched/delivered (per-warehouse): advance ONE fulfilment
//     (input.locationId); dispatch is gated on that site's portion being fully
//     picked; orders.status is recomputed as the rollup.
// Orders created before this model (no fulfilments) keep the legacy order-level
// flow.

// deno-lint-ignore-file no-explicit-any
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.103.0'
import { corsHeadersFor } from '../_shared/cors.ts'
import { checkRateLimit } from '../_shared/rateLimit.ts'
import { loadOrderForDoc, buildOrderDocPdf, uploadAndRecordDoc } from '../_shared/orderDocuments.ts'
import {
  FULFILLMENT_LADDER,
  fulfillmentLocations,
  ensureFulfillments,
  pruneFulfillments,
  isLocationFullyPicked,
  recomputeOrderStatus,
} from '../_shared/fulfillment.ts'

type OrderStatus = 'processing' | 'processed' | 'picked' | 'packed' | 'dispatched' | 'delivered'

const STATUS_ORDER: OrderStatus[] = [
  'processing',
  'processed',
  'picked',
  'packed',
  'dispatched',
  'delivered',
]

interface UpdateOrderStatusRequest {
  orderId: string
  status: OrderStatus
  note?: string | null
  /** Per-warehouse advance: the fulfilment site this transition applies to. */
  locationId?: number | null
  /** processing->processed override: closest-first warehouse preference to re-route. */
  locationPref?: number[] | null
}

interface StatusHistoryEntry {
  status: OrderStatus
  timestamp: string
  note?: string
  actor?: string
}

async function loadProfile(userClient: SupabaseClient, userId: string) {
  const { data, error } = await userClient
    .from('profiles')
    .select('id, role, home_warehouse_id')
    .eq('id', userId)
    .single()
  if (error || !data) throw new Error('Profile not found')
  return data as { id: string; role: string; home_warehouse_id: number | null }
}

serve(async (req: Request) => {
  const corsHeaders = corsHeadersFor(req)
  const jsonResponse = (body: unknown, status = 200): Response =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  const errorResponse = (code: string, message: string, status = 400): Response =>
    jsonResponse({ error: { code, message } }, status)

  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })
  if (req.method !== 'POST') return errorResponse('METHOD_NOT_ALLOWED', 'POST only', 405)

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return errorResponse('UNAUTHORIZED', 'Missing Authorization header', 401)

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  })
  const serviceClient = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false },
  })

  let body: UpdateOrderStatusRequest
  try {
    body = await req.json()
  } catch {
    return errorResponse('INVALID_JSON', 'Body must be JSON')
  }

  if (typeof body.orderId !== 'string' || !body.orderId) {
    return errorResponse('INVALID_INPUT', 'orderId required')
  }
  if (!STATUS_ORDER.includes(body.status)) {
    return errorResponse('INVALID_STATUS', `status must be one of: ${STATUS_ORDER.join(', ')}`)
  }

  const { data: authUser } = await userClient.auth.getUser()
  if (!authUser?.user) return errorResponse('UNAUTHORIZED', 'Invalid session', 401)

  // Per-user rate limit: 60/min/user — higher than the mutate functions
  // because bulk status flows advance many orders in quick succession.
  const rl = await checkRateLimit(`update-order-status:${authUser.user.id}`, {
    windowMs: 60_000,
    max: 60,
  })
  if (!rl.ok) {
    return errorResponse(
      'TOO_MANY_REQUESTS',
      `Rate limit exceeded; try again in ${Math.ceil(rl.resetMs / 1000)}s`,
      429,
    )
  }

  let profile: { id: string; role: string; home_warehouse_id: number | null }
  try {
    profile = await loadProfile(userClient, authUser.user.id)
  } catch {
    return errorResponse('NO_PROFILE', 'Profile not found for user', 403)
  }

  const isAdminManager = profile.role === 'Admin' || profile.role === 'Manager'
  const WAREHOUSE_STATUSES: OrderStatus[] = ['picked', 'packed', 'dispatched', 'delivered']
  if (!isAdminManager && profile.role !== 'Warehouse') {
    return errorResponse('FORBIDDEN', 'Not permitted to change order status', 403)
  }
  if (!isAdminManager && !WAREHOUSE_STATUSES.includes(body.status)) {
    return errorResponse('FORBIDDEN', 'Warehouse role can only set picked/packed/dispatched/delivered', 403)
  }

  const { data: order, error: orderError } = await serviceClient
    .from('orders')
    .select('id, status, status_history, horeca_id')
    .eq('id', body.orderId)
    .single()
  if (orderError || !order) {
    return errorResponse('ORDER_NOT_FOUND', `Order ${body.orderId} not found`, 404)
  }
  const currentOrderStatus = (order as { status: OrderStatus }).status

  const nowIso = new Date().toISOString()

  // Does this order use the per-warehouse fulfilment model?
  const { data: existingFulfilments } = await serviceClient
    .from('order_fulfillments')
    .select('id, location_id, status, status_history')
    .eq('order_id', body.orderId)
  const hasFulfilments = !!existingFulfilments && existingFulfilments.length > 0

  // ── Mode A: processing -> processed (order-level; create fulfilments) ──────
  if (body.status === 'processed') {
    if (!isAdminManager) {
      return errorResponse('FORBIDDEN', 'Only Admin/Manager can process orders', 403)
    }
    if (STATUS_ORDER.indexOf(currentOrderStatus) > STATUS_ORDER.indexOf('processed')) {
      return errorResponse('INVALID_TRANSITION', `Order already past processed (${currentOrderStatus})`, 422)
    }

    // Optional operator re-route: release everything and re-reserve closest-first
    // at the chosen warehouses (allow partial so short stock backorders rather
    // than aborting the process step).
    if (Array.isArray(body.locationPref) && body.locationPref.length > 0) {
      const { data: oi } = await serviceClient
        .from('order_items')
        .select('product_id, quantity, pack_size')
        .eq('order_id', body.orderId)
      const items = ((oi ?? []) as any[]).map((r) => ({
        product_id: r.product_id,
        quantity: Number(r.quantity) * Number(r.pack_size ?? 1),
      }))
      await serviceClient.rpc('inv_release_reservation', {
        p_order_id: body.orderId,
        p_location_id: null,
        p_actor: profile.id,
      })
      const { error: reErr } = await serviceClient.rpc('inv_reserve_order', {
        p_order_id: body.orderId,
        p_items: items,
        p_location_pref: body.locationPref,
        p_actor: profile.id,
        p_allow_partial: true,
      })
      if (reErr) return errorResponse('REALLOCATE_FAILED', reErr.message, 409)
    }

    // Fulfilment sites = warehouses holding a NET reservation; fall back to the
    // default warehouse so there is always something to pick.
    const reservedLocs = await fulfillmentLocations(serviceClient, body.orderId)
    let locs = reservedLocs
    if (locs.length === 0) {
      const { data: def } = await serviceClient
        .from('locations')
        .select('id')
        .eq('kind', 'WAREHOUSE')
        .eq('is_active', true)
        .order('id')
        .limit(1)
        .maybeSingle()
      if ((def as any)?.id) locs = [(def as any).id]
    }
    await ensureFulfillments(serviceClient, body.orderId, locs, profile.id, nowIso)

    // On an operator re-route, prune the origin warehouse's now-stockless
    // 'processed' fulfilment so the rollup doesn't freeze the order at
    // 'processed'. Guard on real reservations existing (reservedLocs non-empty)
    // so a total-reservation-failure fallback to the default warehouse never
    // deletes a legitimate row.
    if (Array.isArray(body.locationPref) && body.locationPref.length > 0 && reservedLocs.length > 0) {
      await pruneFulfillments(serviceClient, body.orderId, reservedLocs)
    }

    const history = Array.isArray((order as any).status_history) ? (order as any).status_history : []
    const { data: updated, error: updErr } = await serviceClient
      .from('orders')
      .update({
        status: 'processed',
        status_history: [
          ...history,
          { status: 'processed', timestamp: nowIso, actor: profile.id, ...(body.note ? { note: body.note } : {}) },
        ],
      })
      .eq('id', body.orderId)
      .select()
      .single()
    if (updErr) return errorResponse('DB_UPDATE_FAILED', updErr.message, 500)
    return jsonResponse({ order: updated, fulfilmentLocations: locs })
  }

  // ── Mode B: per-warehouse advance (picked/packed/dispatched/delivered) ─────
  if (hasFulfilments) {
    // Resolve which fulfilment this transition targets. Explicit locationId wins;
    // otherwise default to the only fulfilment (keeps single-warehouse orders and
    // pre-multi-warehouse callers working). Ambiguous only when >1 fulfilment.
    let locationId = body.locationId ?? null
    if (locationId == null) {
      if (existingFulfilments!.length === 1) {
        locationId = (existingFulfilments![0] as any).location_id
      } else {
        return errorResponse('INVALID_INPUT', 'locationId is required to advance one of multiple warehouse fulfilments', 422)
      }
    }
    // Warehouse staff may only act on their own site.
    if (!isAdminManager && profile.home_warehouse_id !== locationId) {
      return errorResponse('FORBIDDEN', 'You can only update fulfilments for your own warehouse', 403)
    }

    const ful = (existingFulfilments as any[]).find((f) => f.location_id === locationId)
    if (!ful) {
      return errorResponse('FULFILMENT_NOT_FOUND', `No fulfilment for order ${body.orderId} at warehouse ${locationId}`, 404)
    }

    const curIdx = FULFILLMENT_LADDER.indexOf(ful.status)
    const newIdx = FULFILLMENT_LADDER.indexOf(body.status as any)
    if (newIdx < 0) return errorResponse('INVALID_STATUS', 'Invalid fulfilment status', 422)
    if (newIdx < curIdx) {
      return errorResponse('INVALID_TRANSITION', `Cannot move fulfilment from ${ful.status} back to ${body.status}`, 422)
    }

    if (body.status === 'dispatched') {
      const done = await isLocationFullyPicked(serviceClient, body.orderId, locationId as number)
      if (!done) {
        return errorResponse('NOT_FULLY_PICKED', 'Cannot dispatch — this warehouse has not fully picked its portion', 422)
      }
    }

    const fHistory = Array.isArray(ful.status_history) ? ful.status_history : []
    const { error: fErr } = await serviceClient
      .from('order_fulfillments')
      .update({
        status: body.status,
        status_history: [
          ...fHistory,
          { status: body.status, timestamp: nowIso, actor: profile.id, ...(body.note ? { note: body.note } : {}) },
        ],
      })
      .eq('id', ful.id)
    if (fErr) return errorResponse('DB_UPDATE_FAILED', fErr.message, 500)

    // Recompute the derived order status from all fulfilments.
    await recomputeOrderStatus(serviceClient, body.orderId, profile.id, nowIso)

    // On dispatch, generate this warehouse's dispatch advice (best-effort, dedup
    // per order+location). A document failure must never roll back the status.
    if (body.status === 'dispatched') {
      try {
        const { data: existingDocs } = await serviceClient
          .from('order_documents')
          .select('id')
          .eq('order_id', body.orderId)
          .eq('doc_type', 'dispatch_advice')
          .eq('location_id', locationId)
          .limit(1)
        if (!existingDocs || existingDocs.length === 0) {
          const docData = await loadOrderForDoc(serviceClient, body.orderId, locationId)
          const bytes = await buildOrderDocPdf('dispatch_advice', docData)
          await uploadAndRecordDoc(serviceClient, body.orderId, 'dispatch_advice', bytes, profile.id, Date.now(), locationId)
        }
      } catch (docError) {
        console.error(
          `[update-order-status] per-warehouse dispatch advice failed for ${body.orderId}@${locationId}:`,
          docError instanceof Error ? docError.message : docError,
        )
      }
    }

    const { data: refreshed } = await serviceClient
      .from('orders')
      .select('*')
      .eq('id', body.orderId)
      .single()
    return jsonResponse({ order: refreshed })
  }

  // ── Legacy path: order without fulfilments (pre-00036) ─────────────────────
  if (body.status === 'dispatched') {
    const { data: lines } = await serviceClient
      .from('order_items')
      .select('id, quantity, pick_progress(picked_qty)')
      .eq('order_id', body.orderId)
    const shortLine = ((lines ?? []) as any[]).find((l) => {
      const picked = (l.pick_progress ?? []).reduce((s: number, p: any) => s + Number(p.picked_qty), 0)
      return picked < Number(l.quantity)
    })
    if (shortLine) {
      return errorResponse('NOT_FULLY_PICKED', 'Cannot dispatch — one or more lines are not fully picked', 422)
    }
  }

  const currentIdx = STATUS_ORDER.indexOf(currentOrderStatus)
  const newIdx = STATUS_ORDER.indexOf(body.status)
  if (newIdx < currentIdx) {
    return errorResponse('INVALID_TRANSITION', `Cannot move order from ${currentOrderStatus} backwards to ${body.status}`, 422)
  }

  const previousHistory = Array.isArray((order as any).status_history)
    ? ((order as any).status_history as StatusHistoryEntry[])
    : []
  const newEntry: StatusHistoryEntry = {
    status: body.status,
    timestamp: nowIso,
    actor: profile.id,
    ...(body.note ? { note: body.note } : {}),
  }

  const { data: updated, error: updateError } = await serviceClient
    .from('orders')
    .update({ status: body.status, status_history: [...previousHistory, newEntry] as any })
    .eq('id', body.orderId)
    .select()
    .single()
  if (updateError) {
    return errorResponse('DB_UPDATE_FAILED', updateError.message, 500)
  }

  if (body.status === 'dispatched') {
    try {
      const { data: existingDocs } = await serviceClient
        .from('order_documents')
        .select('id')
        .eq('order_id', body.orderId)
        .eq('doc_type', 'dispatch_advice')
        .limit(1)
      if (!existingDocs || existingDocs.length === 0) {
        const docData = await loadOrderForDoc(serviceClient, body.orderId)
        const bytes = await buildOrderDocPdf('dispatch_advice', docData)
        await uploadAndRecordDoc(serviceClient, body.orderId, 'dispatch_advice', bytes, profile.id, Date.now())
      }
    } catch (docError) {
      console.error(
        `[update-order-status] dispatch advice auto-generation failed for ${body.orderId}:`,
        docError instanceof Error ? docError.message : docError,
      )
    }
  }

  return jsonResponse({ order: updated })
})
