// update-order-status Edge Function
//
// Server-side authorisation for order status changes. Direct UPDATE on
// orders.status is denied by RLS to all clients; only the service role
// (this function) can change status.

// deno-lint-ignore-file no-explicit-any
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.103.0'
import { corsHeadersFor } from '../_shared/cors.ts'
import { loadOrderForDoc, buildOrderDocPdf, uploadAndRecordDoc } from '../_shared/orderDocuments.ts'

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
}

interface StatusHistoryEntry {
  status: OrderStatus
  timestamp: string
  note?: string
  actor?: string
}

// jsonResponse / errorResponse are defined inside `serve` so they close over
// the per-request CORS headers (echo of the inbound origin if allowlisted).

async function loadProfile(userClient: SupabaseClient, userId: string) {
  const { data, error } = await userClient
    .from('profiles')
    .select('id, role')
    .eq('id', userId)
    .single()
  if (error || !data) throw new Error('Profile not found')
  return data as { id: string; role: string }
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

  let profile: { id: string; role: string }
  try {
    profile = await loadProfile(userClient, authUser.user.id)
  } catch {
    return errorResponse('NO_PROFILE', 'Profile not found for user', 403)
  }

  // Admin/Manager can drive any forward transition. Warehouse staff operate the
  // back half of fulfillment (pick → pack → dispatch → deliver) but cannot
  // process/approve orders.
  const isAdminManager = profile.role === 'Admin' || profile.role === 'Manager'
  const WAREHOUSE_STATUSES: OrderStatus[] = ['picked', 'packed', 'dispatched', 'delivered']
  if (!isAdminManager && profile.role !== 'Warehouse') {
    return errorResponse('FORBIDDEN', 'Not permitted to change order status', 403)
  }
  if (!isAdminManager && !WAREHOUSE_STATUSES.includes(body.status)) {
    return errorResponse('FORBIDDEN', 'Warehouse role can only set picked/packed/dispatched/delivered', 403)
  }

  // Load existing order
  const { data: order, error: orderError } = await serviceClient
    .from('orders')
    .select('id, status, status_history, horeca_id')
    .eq('id', body.orderId)
    .single()
  if (orderError || !order) {
    return errorResponse('ORDER_NOT_FOUND', `Order ${body.orderId} not found`, 404)
  }

  // Gate dispatch on all lines being fully picked — never ship an order whose
  // goods haven't physically left the shelf.
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

  const currentStatus = (order as { status: OrderStatus }).status
  const newStatus = body.status

  // Validate transition: allow forward, allow same (no-op with note); disallow backwards.
  const currentIdx = STATUS_ORDER.indexOf(currentStatus)
  const newIdx = STATUS_ORDER.indexOf(newStatus)
  if (newIdx < currentIdx) {
    return errorResponse(
      'INVALID_TRANSITION',
      `Cannot move order from ${currentStatus} backwards to ${newStatus}`,
      422,
    )
  }

  const previousHistory = Array.isArray((order as any).status_history)
    ? ((order as any).status_history as StatusHistoryEntry[])
    : []

  const newEntry: StatusHistoryEntry = {
    status: newStatus,
    timestamp: new Date().toISOString(),
    actor: profile.id,
    ...(body.note ? { note: body.note } : {}),
  }
  const updatedHistory = [...previousHistory, newEntry]

  const { data: updated, error: updateError } = await serviceClient
    .from('orders')
    .update({
      status: newStatus,
      status_history: updatedHistory as any,
    })
    .eq('id', body.orderId)
    .select()
    .single()
  if (updateError) {
    return errorResponse('DB_UPDATE_FAILED', updateError.message, 500)
  }

  // On dispatch, auto-generate the dispatch advice so one always exists — the
  // operator can dispatch from either the Pick Workspace or the Order Import
  // advance button, and the order leaves the pick queue immediately after, so
  // we can't rely on a manual click. Best-effort: a document failure must never
  // roll back the status change (the Completed-tab fallback button can recover).
  if (newStatus === 'dispatched') {
    try {
      const { data: existingDocs } = await serviceClient
        .from('order_documents')
        .select('id')
        .eq('order_id', body.orderId)
        .eq('doc_type', 'dispatch_advice')
        .limit(1)
      // Dedup: skip if the operator already generated one manually.
      if (!existingDocs || existingDocs.length === 0) {
        const docData = await loadOrderForDoc(serviceClient, body.orderId)
        const bytes = await buildOrderDocPdf('dispatch_advice', docData)
        await uploadAndRecordDoc(
          serviceClient, body.orderId, 'dispatch_advice', bytes, profile.id, Date.now(),
        )
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
