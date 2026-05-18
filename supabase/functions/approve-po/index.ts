// approve-po Edge Function
//
// Creates a real Order from a pending_pos row, marks the pending_pos
// approved, and writes back any customer/product aliases that emerged
// from the approval. Two callers:
//
//   * Service-role (mode='auto')  — fired by extract-po when the
//     extraction passed the auto-approval gate. Uses
//     email_accounts.connected_by as the order's submitted_by.
//
//   * Admin/Manager JWT (mode='human') — fired by the PO Inbox UI
//     when an operator presses Approve. Optionally accepts overrides
//     for matched_horeca_id and matched_items (the operator may have
//     corrected the AI). submitted_by = the approver.
//
// MVP scope note: this function bypasses place-order. Inbound POs do
// NOT currently apply horeca_pricing, promotions, or invoice creation;
// they use the products.price for line totals. Operators reviewing
// approved orders in /admin/orders can adjust prices or apply promos
// after the fact. Stream J Phase 2 polish ports the place-order
// pricing logic over.
//
// A read-time stock check refuses lines whose quantity exceeds current
// inventory. The check is not race-free (supabase-js has no
// transactions); a true reservation requires a Postgres RPC and is
// deferred to Phase 2. This caps the worst case to ~tens of units of
// overcommit during sustained dual-channel ordering, not unlimited
// overcommit.

// deno-lint-ignore-file no-explicit-any
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.103.0'
import { corsHeadersFor } from '../_shared/cors.ts'
import { EdgeFunctionError, errorResponse } from '../_shared/errors.ts'
import { requireAuth } from '../_shared/auth.ts'
import { checkRateLimit } from '../_shared/rateLimit.ts'
import { logAuditEvent } from '../_shared/audit.ts'
import { computeAliasDiff } from '../_shared/poInbox/aliasDiff.ts'
import { sanitizeForLog } from '../_shared/poInbox/env.ts'
import { isServiceRoleBearer } from '../_shared/poInbox/dispatch.ts'

type ApproveMode = 'auto' | 'human'

interface ApproveRequest {
  pendingPoId: string
  mode: ApproveMode
  // Human mode may override the AI's matched values. Each override is
  // optional; absent fields fall back to whatever extract-po wrote.
  overrideHorecaId?: number
  overrideItems?: Array<{
    po_line_index: number
    product_id: number
    quantity: number
    pack_size?: number | null
  }>
  overrideNotes?: string | null
  overrideDeliveryDate?: string | null
  overrideDeliveryTimeSlot?: 'Morning (8am-12pm)' | 'Afternoon (12pm-4pm)' | 'Evening (4pm-8pm)' | null
}

interface ApproveResult {
  ok: true
  orderId?: string | null
  status?: 'approved' | 'auto_approved'
  aliasesWritten?: number
  alreadyApproved?: boolean
}

serve(async (req: Request) => {
  const corsHeaders = corsHeadersFor(req)
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })
  if (req.method !== 'POST') {
    return errorResponse('INVALID_INPUT', 'POST only', undefined, 405, req)
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const serviceClient = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false },
  })

  try {
    let body: ApproveRequest
    try {
      body = await req.json()
    } catch {
      throw new EdgeFunctionError('INVALID_INPUT', 'Body must be JSON')
    }
    if (!body.pendingPoId || (body.mode !== 'auto' && body.mode !== 'human')) {
      throw new EdgeFunctionError('INVALID_INPUT', 'pendingPoId and mode (auto|human) required')
    }

    let approverUserId: string
    let approverRole: 'service' | 'Admin' | 'Manager'
    if (body.mode === 'auto') {
      if (!isServiceRoleBearer(req.headers.get('Authorization'), serviceKey)) {
        throw new EdgeFunctionError('UNAUTHORIZED', 'auto mode requires service_role bearer')
      }
      approverUserId = ''
      approverRole = 'service'
    } else {
      const ctx = await requireAuth(req, { allowedRoles: ['Admin', 'Manager'] })
      const rl = checkRateLimit(`approve-po:${ctx.userId}`, { windowMs: 60_000, max: 30 })
      if (!rl.ok) {
        return errorResponse('TOO_MANY_REQUESTS', 'Slow down on approvals', undefined, 429, req)
      }
      approverUserId = ctx.userId
      approverRole = ctx.role as 'Admin' | 'Manager'
    }

    const result = await runApprove({
      supa: serviceClient,
      pendingPoId: body.pendingPoId,
      mode: body.mode,
      approverUserId,
      approverRole,
      overrides: {
        horecaId: body.overrideHorecaId,
        items: body.overrideItems,
        notes: body.overrideNotes ?? undefined,
        deliveryDate: body.overrideDeliveryDate ?? undefined,
        deliveryTimeSlot: body.overrideDeliveryTimeSlot ?? undefined,
      },
    })

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    if (err instanceof EdgeFunctionError) return err.toResponse(req)
    console.warn(
      '[approve-po] unexpected error:',
      sanitizeForLog(err instanceof Error ? err.message : String(err)),
    )
    return errorResponse('INTERNAL', 'Unexpected error', undefined, 500, req)
  }
})

interface PendingPoRow {
  id: string
  status: 'needs_review' | 'approved' | 'rejected' | 'auto_approved'
  inbound_message_id: string
  matched_horeca_id: number | null
  matched_items: Array<{
    po_line_index: number
    product_id: number | null
    quantity: number
    pack_size: number | null
    confidence: number
  }>
  extracted_po: {
    customer_name_raw?: string | null
    requested_date?: string | null
    lines?: Array<{ item_code_raw?: string | null; description_raw?: string | null }>
  }
  approved_order_id: string | null
}

interface InboundMessageRow {
  id: string
  email_account_id: string
  from_address: string
}

interface EmailAccountRow {
  id: string
  connected_by: string
}

interface RunApproveArgs {
  supa: SupabaseClient
  pendingPoId: string
  mode: ApproveMode
  approverUserId: string
  approverRole: 'service' | 'Admin' | 'Manager'
  overrides: {
    horecaId?: number
    items?: Array<{
      po_line_index: number
      product_id: number
      quantity: number
      pack_size?: number | null
    }>
    notes?: string
    deliveryDate?: string
    deliveryTimeSlot?: string
  }
}

async function runApprove(args: RunApproveArgs): Promise<ApproveResult> {
  const pending = await loadPendingPo(args.supa, args.pendingPoId)

  if (pending.status === 'approved' || pending.status === 'auto_approved') {
    return {
      ok: true,
      alreadyApproved: true,
      orderId: pending.approved_order_id,
    }
  }
  if (pending.status === 'rejected') {
    throw new EdgeFunctionError('CONFLICT', 'PO has already been rejected')
  }

  const inbound = await loadInboundMessage(args.supa, pending.inbound_message_id)
  const emailAccount = await loadEmailAccount(args.supa, inbound.email_account_id)

  // Manager scope: only approve POs from mailboxes they connected.
  if (args.approverRole === 'Manager' && emailAccount.connected_by !== args.approverUserId) {
    throw new EdgeFunctionError(
      'FORBIDDEN',
      'Manager can only approve POs from mailboxes they connected — ask an Admin for others',
    )
  }

  // Resolve effective values: human overrides win, otherwise extract-po's
  // matched values.
  const effectiveHorecaId = args.overrides.horecaId ?? pending.matched_horeca_id
  if (!effectiveHorecaId) {
    throw new EdgeFunctionError('INVALID_INPUT', 'No horeca_id available (matched or override)')
  }
  const overrideItemsByIndex = new Map<number, NonNullable<RunApproveArgs['overrides']['items']>[number]>()
  for (const o of args.overrides.items ?? []) overrideItemsByIndex.set(o.po_line_index, o)

  const effectiveItems = pending.matched_items.map(item => {
    const o = overrideItemsByIndex.get(item.po_line_index)
    return {
      po_line_index: item.po_line_index,
      product_id: o?.product_id ?? item.product_id,
      quantity: o?.quantity ?? item.quantity,
      pack_size: o?.pack_size ?? item.pack_size,
    }
  })
  if (effectiveItems.some(i => !i.product_id)) {
    throw new EdgeFunctionError(
      'INVALID_INPUT',
      'Cannot approve while some lines are unresolved — supply overrideItems',
    )
  }
  const resolvedItems = effectiveItems as Array<{
    po_line_index: number
    product_id: number
    quantity: number
    pack_size: number | null
  }>

  // submittedBy: for human approvals the operator; for auto approvals
  // the admin who connected the mailbox.
  const submittedBy = args.mode === 'human' ? args.approverUserId : emailAccount.connected_by

  // Load product prices + inventory for the lines.
  const productIds = [...new Set(resolvedItems.map(i => i.product_id))]
  const products = await loadProducts(args.supa, productIds)
  for (const id of productIds) {
    if (!products.has(id)) {
      throw new EdgeFunctionError('INVALID_INPUT', `product ${id} not found`)
    }
  }

  // Read-time stock check. Not race-free without an RPC transaction,
  // but catches the obvious "PO for 1000 units of an item we have 5 of"
  // case. A concurrent place-order via another channel could still
  // overcommit by a few units between this read and the orders insert;
  // Phase 2 will wrap both in a Postgres function.
  const totalsByProduct = new Map<number, number>()
  for (const item of resolvedItems) {
    const requested = item.quantity * (item.pack_size ?? 1)
    totalsByProduct.set(item.product_id, (totalsByProduct.get(item.product_id) ?? 0) + requested)
  }
  for (const [pid, qty] of totalsByProduct) {
    const product = products.get(pid)!
    if (product.inventory < qty) {
      throw new EdgeFunctionError(
        'CONFLICT',
        `Insufficient stock for ${product.name}: ${product.inventory} available, ${qty} requested`,
      )
    }
  }

  // Compute totals (no horeca_pricing, no promotions — MVP scope note above).
  let total = 0
  const orderItems = resolvedItems.map(item => {
    const product = products.get(item.product_id)!
    const lineTotal = product.price * item.quantity * (item.pack_size ?? 1)
    total += lineTotal
    return {
      product_id: item.product_id,
      quantity: item.quantity,
      pack_size: item.pack_size,
      unit_price: product.price,
      product_name: product.name,
      product_sku: product.sku,
    }
  })

  const settings = await loadAppSettings(args.supa)
  const orderId = makeOrderId(settings.order_id_prefix)

  // ─── Atomic claim ────────────────────────────────────────────────
  // Before doing the orders insert, claim the pending_pos row by an
  // UPDATE gated on its current status. If a concurrent caller already
  // approved/rejected this PO, the UPDATE matches zero rows and we
  // abort before creating an orphan order.
  const intendedStatus: 'approved' | 'auto_approved' =
    args.mode === 'human' ? 'approved' : 'auto_approved'
  const claimUpdate: Record<string, unknown> = {
    status: intendedStatus,
    approved_order_id: orderId,
    updated_at: new Date().toISOString(),
  }
  if (args.mode === 'human') {
    claimUpdate.reviewed_by = args.approverUserId
    claimUpdate.reviewed_at = new Date().toISOString()
  }
  const { data: claimed, error: claimError } = await args.supa
    .from('pending_pos')
    .update(claimUpdate)
    .eq('id', args.pendingPoId)
    .eq('status', 'needs_review')
    .select('id')
    .maybeSingle()
  if (claimError) {
    throw new EdgeFunctionError('INTERNAL', `pending_pos claim failed: ${claimError.message}`)
  }
  if (!claimed) {
    // Lost the race — another caller approved/rejected this PO between
    // our load and our claim.
    return { ok: true, alreadyApproved: true, orderId: null }
  }

  // ─── Order creation ──────────────────────────────────────────────
  // If anything fails from here on we must roll back the pending_pos
  // claim or we'll have a pending_pos pointing at a missing order.
  const rollbackPendingPo = async (reason: string) => {
    const { error: rbError } = await args.supa
      .from('pending_pos')
      .update({
        status: 'needs_review',
        approved_order_id: null,
        reviewed_by: null,
        reviewed_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', args.pendingPoId)
    if (rbError) {
      console.warn(
        `[approve-po] pending_pos rollback failed (${reason}):`,
        sanitizeForLog(rbError.message),
      )
    }
  }

  const { error: orderInsertError } = await args.supa
    .from('orders')
    .insert({
      id: orderId,
      horeca_id: effectiveHorecaId,
      submitted_by: submittedBy,
      total,
      order_date: new Date().toISOString(),
      notes: args.overrides.notes ?? null,
      status: 'processing',
      status_history: JSON.stringify([
        { status: 'processing', changedAt: new Date().toISOString(), changedBy: submittedBy },
      ]),
      delivery_date: args.overrides.deliveryDate
        ?? pending.extracted_po.requested_date
        ?? null,
      delivery_time_slot: args.overrides.deliveryTimeSlot ?? null,
    })
  if (orderInsertError) {
    await rollbackPendingPo('orders insert')
    throw new EdgeFunctionError('INTERNAL', `orders insert: ${orderInsertError.message}`)
  }

  const itemRowsToInsert = orderItems.map(item => ({ ...item, order_id: orderId }))
  const { error: itemsInsertError } = await args.supa.from('order_items').insert(itemRowsToInsert)
  if (itemsInsertError) {
    // Best-effort cleanup so we don't leave a totals-mismatched order.
    // If THIS delete fails, the orders row is orphaned — surface via
    // audit so operators can clean up. Phase 2's RPC wraps both inserts
    // in a transaction so this branch becomes unreachable.
    const { error: deleteError } = await args.supa.from('orders').delete().eq('id', orderId)
    if (deleteError) {
      console.warn(
        '[approve-po] CRITICAL: orphan order',
        orderId,
        '— items insert failed AND cleanup delete failed:',
        sanitizeForLog(deleteError.message),
      )
      await logAuditEvent(args.supa, {
        actorId: args.approverUserId || submittedBy,
        actorRole: args.approverRole,
        action: 'create',
        resource: 'order',
        resourceId: orderId,
        reason: 'orphan: order_items insert failed and rollback delete failed',
        metadata: {
          items_error: itemsInsertError.message,
          delete_error: deleteError.message,
          pending_po_id: args.pendingPoId,
        },
      })
    }
    await rollbackPendingPo('order_items insert')
    throw new EdgeFunctionError('INTERNAL', `order_items insert: ${itemsInsertError.message}`)
  }

  // Compute + write alias diff. Failures are non-fatal — the order
  // still exists, the alias table just doesn't learn this time.
  const aliasDiff = computeAliasDiff({
    extracted: {
      customer_name_raw: pending.extracted_po.customer_name_raw ?? null,
      lines: (pending.extracted_po.lines ?? []).map(l => ({
        item_code_raw: l.item_code_raw ?? null,
        description_raw: l.description_raw ?? null,
      })),
    },
    originallyMatchedHorecaId: pending.matched_horeca_id,
    originallyMatchedItems: pending.matched_items.map(m => ({
      po_line_index: m.po_line_index,
      product_id: m.product_id,
    })),
    approvedHorecaId: effectiveHorecaId,
    approvedItems: resolvedItems.map(i => ({
      po_line_index: i.po_line_index,
      product_id: i.product_id,
    })),
    fromAddress: inbound.from_address || null,
  })

  await persistAliases(args.supa, aliasDiff, args.mode === 'human' ? args.approverUserId : null)

  if (args.mode === 'human') {
    await logAuditEvent(args.supa, {
      actorId: args.approverUserId,
      actorRole: args.approverRole,
      action: 'create',
      resource: 'order',
      resourceId: orderId,
      after: { source: 'inbound_po', pending_po_id: args.pendingPoId },
      metadata: {
        inbound_message_id: pending.inbound_message_id,
        horeca_id: effectiveHorecaId,
        total,
      },
    })
  }

  return {
    ok: true,
    orderId,
    status: intendedStatus,
    aliasesWritten: aliasDiff.customerAliases.length + aliasDiff.productAliases.length,
  }
}

function makeOrderId(prefix: string): string {
  // Full UUID for collision safety. Format: ORD-IN-{32-hex-chars-no-dashes}
  // makes it visible in /admin/orders as an inbound-PO order while
  // remaining unique even at very high volumes.
  const safePrefix = (prefix || 'ORD').toUpperCase()
  const uuid = crypto.randomUUID().replace(/-/g, '').toUpperCase()
  return `${safePrefix}-IN-${uuid}`
}

async function loadPendingPo(supa: SupabaseClient, id: string): Promise<PendingPoRow> {
  const { data, error } = await supa
    .from('pending_pos')
    .select(
      'id, status, inbound_message_id, matched_horeca_id, matched_items, extracted_po, approved_order_id',
    )
    .eq('id', id)
    .single()
  if (error || !data) throw new EdgeFunctionError('NOT_FOUND', `pending_pos ${id} not found`)
  return data as PendingPoRow
}

async function loadInboundMessage(supa: SupabaseClient, id: string): Promise<InboundMessageRow> {
  const { data, error } = await supa
    .from('inbound_messages')
    .select('id, email_account_id, from_address')
    .eq('id', id)
    .single()
  if (error || !data) throw new EdgeFunctionError('INTERNAL', `inbound_messages ${id} missing`)
  return data as InboundMessageRow
}

async function loadEmailAccount(supa: SupabaseClient, id: string): Promise<EmailAccountRow> {
  const { data, error } = await supa
    .from('email_accounts')
    .select('id, connected_by')
    .eq('id', id)
    .single()
  if (error || !data) throw new EdgeFunctionError('INTERNAL', `email_accounts ${id} missing`)
  return data as EmailAccountRow
}

async function loadAppSettings(supa: SupabaseClient): Promise<{ order_id_prefix: string }> {
  const { data, error } = await supa
    .from('app_settings')
    .select('order_id_prefix')
    .eq('id', 1)
    .single()
  if (error || !data) return { order_id_prefix: 'ORD' }
  return data as { order_id_prefix: string }
}

async function loadProducts(
  supa: SupabaseClient,
  productIds: number[],
): Promise<Map<number, { id: number; name: string; sku: string; price: number; inventory: number }>> {
  const { data, error } = await supa
    .from('products')
    .select('id, name, sku, price, inventory')
    .in('id', productIds)
  if (error) throw new EdgeFunctionError('INTERNAL', `products lookup: ${error.message}`)
  const map = new Map<number, { id: number; name: string; sku: string; price: number; inventory: number }>()
  for (const row of (data ?? []) as Array<{ id: number; name: string; sku: string; price: number; inventory: number }>) {
    map.set(row.id, {
      ...row,
      price: Number(row.price),
      inventory: Number(row.inventory),
    })
  }
  return map
}

async function persistAliases(
  supa: SupabaseClient,
  diff: ReturnType<typeof computeAliasDiff>,
  createdByUserId: string | null,
): Promise<void> {
  // Bulk insert in two batches (one per table). ON CONFLICT DO NOTHING
  // via PostgREST's ignoreDuplicates option keeps the call idempotent
  // when an alias already exists from a prior approval.
  if (diff.customerAliases.length > 0) {
    const rows = diff.customerAliases.map(row => ({
      source_type: row.source_type,
      source_value: row.source_value,
      horeca_id: row.horeca_id,
      created_by: createdByUserId,
      confidence_at_creation: 1.0,
    }))
    const { error } = await supa
      .from('po_customer_aliases')
      .upsert(rows, { onConflict: 'source_type,source_value', ignoreDuplicates: true })
    if (error) {
      console.warn(
        '[approve-po] customer alias bulk insert failed:',
        sanitizeForLog(error.message),
      )
    }
  }
  if (diff.productAliases.length > 0) {
    const rows = diff.productAliases.map(row => ({
      horeca_id: row.horeca_id,
      source_code: row.source_code,
      source_description: row.source_description,
      product_id: row.product_id,
      created_by: createdByUserId,
      confidence_at_creation: 1.0,
    }))
    // The product-alias table's unique constraints are partial
    // (separate indexes on (horeca_id, source_code) and on
    // (horeca_id, lower(source_description))), so PostgREST cannot
    // express the conflict target. Fall back to per-row inserts with
    // unique-violation suppression.
    for (const row of rows) {
      const { error } = await supa.from('po_product_aliases').insert(row)
      if (error && !isUniqueViolation(error)) {
        console.warn(
          '[approve-po] product alias insert skipped:',
          sanitizeForLog(error.message),
        )
      }
    }
  }
}

function isUniqueViolation(error: { code?: string | null }): boolean {
  return error?.code === '23505'
}
