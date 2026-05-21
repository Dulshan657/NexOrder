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
import { findStockShortages, type StockShortage } from '../_shared/poInbox/stockCheck.ts'

type ApproveMode = 'auto' | 'human'

interface ApproveRequest {
  pendingPoId: string
  mode: ApproveMode
  // Human mode may override the AI's matched values.
  overrideHorecaId?: number
  // When present, REPLACES extracted lines entirely. Lines with
  // po_line_index=null are operator-added (no alias write-back). When
  // absent, the function uses pending_pos.matched_items as-is.
  overrideLines?: Array<{
    po_line_index: number | null
    product_id: number
    quantity: number
    pack_size?: number | null
  }>
  overrideNotes?: string | null
  overrideDeliveryDate?: string | null
  overrideDeliveryTimeSlot?: 'Morning (8am-12pm)' | 'Afternoon (12pm-4pm)' | 'Evening (4pm-8pm)' | null
  // Per-PO shipping address snapshot. Resolution priority:
  //   1. source_address_id present  → copy from that horeca_addresses row
  //   2. otherwise                   → use street/city/etc. directly,
  //      and (if save_to_horeca_address_book !== false) insert a new
  //      horeca_addresses row tagged is_default=false.
  // The HoReCa's default address is never modified by this path.
  overrideDeliveryAddress?: {
    street?: string
    city?: string | null
    postcode?: string | null
    country?: string | null
    recipient_name?: string | null
    source_address_id?: string | null
    save_to_horeca_address_book?: boolean
  } | null
}

interface ApproveResult {
  ok: true
  orderId?: string | null
  status?: 'approved' | 'auto_approved'
  aliasesWritten?: number
  alreadyApproved?: boolean
  // Non-fatal: lines whose ordered quantity exceeds current inventory. The
  // order is still created (approve-po does not decrement stock); the
  // operator handles the shortfall via backorder/restock.
  stockWarnings?: StockShortage[]
  // Auto mode only: set when an unattended auto-approval was declined because
  // a line is short on stock. No order is created; the PO stays needs_review.
  autoApprovalDeclined?: boolean
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
        lines: body.overrideLines,
        notes: body.overrideNotes ?? undefined,
        deliveryDate: body.overrideDeliveryDate ?? undefined,
        deliveryTimeSlot: body.overrideDeliveryTimeSlot ?? undefined,
        deliveryAddress: body.overrideDeliveryAddress ?? undefined,
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
    lines?: Array<{
      po_line_index: number | null
      product_id: number
      quantity: number
      pack_size?: number | null
    }>
    notes?: string
    deliveryDate?: string
    deliveryTimeSlot?: string
    deliveryAddress?: {
      street?: string
      city?: string | null
      postcode?: string | null
      country?: string | null
      recipient_name?: string | null
      source_address_id?: string | null
      save_to_horeca_address_book?: boolean
    }
  }
}

interface ResolvedDeliveryAddress {
  street: string
  city: string | null
  postcode: string | null
  country: string | null
  recipient_name: string | null
  source_address_id: string | null
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

  // overrideLines REPLACES the line set (supports add/delete). Operator-
  // added lines carry po_line_index=null and are excluded from alias
  // write-back below.
  type ResolvedLine = {
    po_line_index: number | null
    product_id: number
    quantity: number
    pack_size: number | null
  }
  let resolvedItems: ResolvedLine[]
  if (args.overrides.lines !== undefined) {
    if (args.overrides.lines.length === 0) {
      throw new EdgeFunctionError('INVALID_INPUT', 'Cannot approve an order with zero lines')
    }
    resolvedItems = args.overrides.lines.map(l => ({
      po_line_index: l.po_line_index,
      product_id: l.product_id,
      quantity: l.quantity,
      pack_size: l.pack_size ?? null,
    }))
  } else {
    if (pending.matched_items.some(i => !i.product_id)) {
      throw new EdgeFunctionError(
        'INVALID_INPUT',
        'Cannot approve while some lines are unresolved — supply overrideLines',
      )
    }
    resolvedItems = pending.matched_items.map(item => ({
      po_line_index: item.po_line_index,
      product_id: item.product_id as number,
      quantity: item.quantity,
      pack_size: item.pack_size,
    }))
  }
  if (resolvedItems.some(i => !Number.isFinite(i.product_id) || i.product_id <= 0)) {
    throw new EdgeFunctionError('INVALID_INPUT', 'Every approved line must have a product_id')
  }
  if (resolvedItems.some(i => !Number.isFinite(i.quantity) || i.quantity <= 0)) {
    throw new EdgeFunctionError('INVALID_INPUT', 'Every approved line must have quantity > 0')
  }

  // Resolve the per-order delivery address (per-PO snapshot, never mutates
  // the HoReCa's default). May insert a new horeca_addresses row when the
  // operator typed a fresh address and asked us to remember it.
  const deliveryAddress = await resolveDeliveryAddress(
    args.supa,
    effectiveHorecaId,
    args.overrides.deliveryAddress,
  )

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

  // Read-time stock check — ADVISORY ONLY, never blocks. Inbound POs are
  // customer-originated (the order already exists) and approve-po does not
  // decrement inventory, so a short line must not stop order creation; we
  // surface it as a warning the operator resolves via backorder/restock.
  //
  // Inventory is counted in selling units — the same unit as `quantity`.
  // pack_size is descriptive metadata (carton size) and must NOT scale the
  // requested amount, mirroring place-order which checks/decrements by
  // quantity alone. See _shared/poInbox/stockCheck.ts.
  const stockWarnings = findStockShortages(
    resolvedItems.map(i => ({ product_id: i.product_id, quantity: i.quantity })),
    products,
  )

  // Auto-approval guard: unattended approval must NOT create an order that
  // can't be fulfilled. If any line is short, decline and leave the PO in
  // needs_review so a human reviews it (human approval still proceeds with an
  // advisory warning). No claim and no order have been written yet — auto
  // mode has no deliveryAddress override, so resolveDeliveryAddress was a
  // no-op above.
  if (args.mode === 'auto' && stockWarnings.length > 0) {
    console.warn(
      `[approve-po] auto-approval declined for ${args.pendingPoId}: ${stockWarnings.length} line(s) short on stock — left for human review`,
    )
    return { ok: true, autoApprovalDeclined: true, stockWarnings }
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
      delivery_address: deliveryAddress,
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
    // Operator-added lines (po_line_index === null) carry no raw extracted
    // text, so there's nothing to learn from. Skip them in the alias diff.
    approvedItems: resolvedItems
      .filter((i): i is ResolvedLine & { po_line_index: number } => i.po_line_index !== null)
      .map(i => ({
        po_line_index: i.po_line_index,
        product_id: i.product_id,
      })),
    fromAddress: inbound.from_address || null,
  })

  await persistAliases(
    args.supa,
    aliasDiff,
    args.mode === 'human' ? args.approverUserId : null,
    args.pendingPoId,
  )

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
        ...(stockWarnings.length > 0 ? { stock_shortfall: stockWarnings } : {}),
      },
    })
  }

  return {
    ok: true,
    orderId,
    status: intendedStatus,
    aliasesWritten: aliasDiff.customerAliases.length + aliasDiff.productAliases.length,
    ...(stockWarnings.length > 0 ? { stockWarnings } : {}),
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
  pendingPoId: string,
): Promise<void> {
  // Bulk insert in two batches (one per table). ON CONFLICT DO NOTHING
  // via PostgREST's ignoreDuplicates option keeps the call idempotent
  // when an alias already exists from a prior approval. pending_po_id
  // stamps the originating PO so the Aliases tab can show provenance.
  if (diff.customerAliases.length > 0) {
    const rows = diff.customerAliases.map(row => ({
      source_type: row.source_type,
      source_value: row.source_value,
      horeca_id: row.horeca_id,
      created_by: createdByUserId,
      confidence_at_creation: 1.0,
      pending_po_id: pendingPoId,
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
      pending_po_id: pendingPoId,
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

/**
 * Resolve the per-order shipping address snapshot.
 *
 * Order of preference (mirrors the request shape semantics):
 *   1. `source_address_id` — copy fields from that horeca_addresses row
 *      (guards against the operator picking a stale row that's since been
 *      edited; we snapshot what's CURRENT at approval time).
 *   2. Free-form fields supplied directly; on these, when
 *      `save_to_horeca_address_book !== false` we also insert a new
 *      horeca_addresses row tagged is_default=false so the operator can
 *      pick it again next time. The new row's id is back-filled into
 *      `source_address_id` for cross-reference.
 *   3. No override at all → null (orders.delivery_address NULL means
 *      "fall back to horecas.address" for display, matching legacy rows).
 *
 * The HoReCa's existing default is never touched by this path.
 */
async function resolveDeliveryAddress(
  supa: SupabaseClient,
  horecaId: number,
  override: RunApproveArgs['overrides']['deliveryAddress'],
): Promise<ResolvedDeliveryAddress | null> {
  if (!override) return null

  // 1. Picked an existing address from the HoReCa's book.
  if (override.source_address_id) {
    const { data, error } = await supa
      .from('horeca_addresses')
      .select('id, horeca_id, street, city, postcode, country, recipient_name')
      .eq('id', override.source_address_id)
      .maybeSingle()
    if (error || !data) {
      throw new EdgeFunctionError(
        'INVALID_INPUT',
        `Selected address ${override.source_address_id} not found`,
      )
    }
    const row = data as {
      id: string
      horeca_id: number
      street: string
      city: string | null
      postcode: string | null
      country: string | null
      recipient_name: string | null
    }
    if (row.horeca_id !== horecaId) {
      throw new EdgeFunctionError(
        'INVALID_INPUT',
        'Selected address belongs to a different HoReCa',
      )
    }
    return {
      street: row.street,
      city: row.city,
      postcode: row.postcode,
      country: row.country,
      recipient_name: row.recipient_name,
      source_address_id: row.id,
    }
  }

  // 2. Free-form fields. street is the minimum required surface.
  const street = (override.street ?? '').trim()
  if (!street) {
    throw new EdgeFunctionError(
      'INVALID_INPUT',
      'overrideDeliveryAddress requires either source_address_id or a non-empty street',
    )
  }

  const fields = {
    street,
    city: override.city ?? null,
    postcode: override.postcode ?? null,
    country: override.country ?? null,
    recipient_name: override.recipient_name ?? null,
  }

  let savedAddressId: string | null = null
  if (override.save_to_horeca_address_book !== false) {
    const { data: inserted, error: insertErr } = await supa
      .from('horeca_addresses')
      .insert({
        horeca_id: horecaId,
        is_default: false,           // never replaces the default
        label: null,
        ...fields,
      })
      .select('id')
      .single()
    if (insertErr) {
      // Non-fatal: failing to save the address book entry should not
      // abort the order. Log + continue without source_address_id.
      console.warn(
        '[approve-po] horeca_addresses save skipped:',
        sanitizeForLog(insertErr.message),
      )
    } else if (inserted) {
      savedAddressId = (inserted as { id: string }).id
    }
  }

  return { ...fields, source_address_id: savedAddressId }
}
