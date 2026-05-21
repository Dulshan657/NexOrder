// mutate-invoice-status Edge Function
//
// Admin and Manager can flip an order's invoice between pending / paid / overdue.
// Used by the Orders tab "Mark Paid / Mark Overdue / Mark Pending" actions.
//
// Behaviour:
//   - Look up invoice by order_id (maybeSingle).
//   - If invoice exists: update status. paid_date = today when transitioning
//     to 'paid'; cleared when transitioning away from 'paid'.
//   - If no invoice exists and target status is 'paid' or 'overdue':
//     auto-create one. Net-30 default due_date until accounting integration
//     supplies real terms. amount snapshots from orders.total.
//   - If no invoice exists and target status is 'pending': no-op.
//
// Sensitive-field rule mirrors mutate-horeca: when the caller is a Manager
// (not Admin), a 5–500 char `reason` is required. Audit-logged either way.

// deno-lint-ignore-file no-explicit-any
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.103.0'
import { z } from 'https://esm.sh/zod@3.23.8'
import { requireAuth, type UserRole } from '../_shared/auth.ts'
import { EdgeFunctionError, errorResponse, isEdgeFunctionError } from '../_shared/errors.ts'
import { logAuditEvent } from '../_shared/audit.ts'
import { corsHeadersFor } from '../_shared/cors.ts'
import { checkRateLimit } from '../_shared/rateLimit.ts'

const ALLOWED: ReadonlyArray<UserRole> = ['Admin', 'Manager']
const NET_TERM_DAYS = 30

const inputSchema = z.object({
  orderId: z.string().min(1),
  status: z.enum(['pending', 'paid', 'overdue']),
  reason: z.string().min(5).max(500).optional(),
})

interface InvoiceRow {
  id: string
  order_id: string
  horeca_id: number
  horeca_name: string
  amount: number
  due_date: string
  status: 'pending' | 'paid' | 'overdue'
  paid_date: string | null
  created_date: string
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

function addDaysIso(iso: string, days: number): string {
  const d = new Date(iso + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

function newInvoiceId(): string {
  return 'INV-' + crypto.randomUUID().slice(0, 8).toUpperCase()
}

serve(async (req: Request) => {
  const corsHeaders = corsHeadersFor(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const auth = await requireAuth(req, { allowedRoles: ALLOWED })

    // Per-user rate limit: 30/min/user. Matches other admin mutate functions.
    const rl = await checkRateLimit(`mutate-invoice-status:${auth.userId}`, {
      windowMs: 60_000,
      max: 30,
    })
    if (!rl.ok) {
      throw new EdgeFunctionError(
        'TOO_MANY_REQUESTS',
        `Rate limit exceeded; try again in ${Math.ceil(rl.resetMs / 1000)}s`,
      )
    }

    const body = await req.json().catch(() => {
      throw new EdgeFunctionError('INVALID_INPUT', 'Request body must be valid JSON')
    })

    const parsed = inputSchema.safeParse(body)
    if (!parsed.success) {
      throw new EdgeFunctionError('INVALID_INPUT', 'Invalid request body', parsed.error.flatten())
    }
    const { orderId, status, reason } = parsed.data

    // Manager must supply a reason
    if (auth.role === 'Manager' && !reason) {
      throw new EdgeFunctionError(
        'INVALID_INPUT',
        'A reason is required when changing payment status as Manager',
        { missingReason: true },
      )
    }

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { persistSession: false } },
    )

    // Look up existing invoice (if any)
    const { data: existingRow, error: fetchError } = await admin
      .from('invoices')
      .select('*')
      .eq('order_id', orderId)
      .maybeSingle()

    if (fetchError) {
      throw new EdgeFunctionError('INTERNAL', `Failed to query invoices: ${fetchError.message}`)
    }

    const existing = existingRow as InvoiceRow | null

    // ---- UPDATE PATH ----
    if (existing) {
      const updates: Partial<InvoiceRow> = { status }
      if (status === 'paid') {
        updates.paid_date = todayIso()
      } else if (existing.status === 'paid') {
        updates.paid_date = null
      }

      const { data: updatedRow, error: updateError } = await admin
        .from('invoices')
        .update(updates as any)
        .eq('id', existing.id)
        .select()
        .single()

      if (updateError || !updatedRow) {
        throw new EdgeFunctionError(
          'INTERNAL',
          updateError?.message ?? 'Failed to update invoice',
        )
      }

      await logAuditEvent(admin, {
        actorId: auth.userId,
        actorRole: auth.role,
        action: 'update',
        resource: 'invoice',
        resourceId: existing.id,
        before: existing,
        after: updatedRow,
        reason: reason ?? null,
        metadata: { orderId },
      })

      return new Response(
        JSON.stringify({ ok: true, invoice: updatedRow, created: false }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    // ---- NO-OP: pending with no invoice ----
    if (status === 'pending') {
      return new Response(
        JSON.stringify({ ok: true, invoice: null, created: false, noop: true }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    // ---- AUTO-CREATE PATH (paid or overdue) ----
    const { data: orderRow, error: orderError } = await admin
      .from('orders')
      .select('id, horeca_id, total, horecas(name)')
      .eq('id', orderId)
      .single()

    if (orderError || !orderRow) {
      throw new EdgeFunctionError('NOT_FOUND', `Order ${orderId} not found`)
    }

    const horecaName =
      (orderRow as any).horecas?.name ?? `HoReCa #${(orderRow as any).horeca_id}`
    const today = todayIso()
    const newRow: InvoiceRow = {
      id: newInvoiceId(),
      order_id: orderId,
      horeca_id: (orderRow as any).horeca_id,
      horeca_name: horecaName,
      amount: Number((orderRow as any).total),
      due_date: addDaysIso(today, NET_TERM_DAYS),
      status,
      paid_date: status === 'paid' ? today : null,
      created_date: today,
    }

    const { data: createdRow, error: insertError } = await admin
      .from('invoices')
      .insert(newRow as any)
      .select()
      .single()

    if (insertError || !createdRow) {
      throw new EdgeFunctionError(
        'INTERNAL',
        insertError?.message ?? 'Failed to create invoice',
      )
    }

    await logAuditEvent(admin, {
      actorId: auth.userId,
      actorRole: auth.role,
      action: 'create',
      resource: 'invoice',
      resourceId: newRow.id,
      after: createdRow,
      reason: reason ?? null,
      metadata: { orderId, autoCreated: true },
    })

    return new Response(
      JSON.stringify({ ok: true, invoice: createdRow, created: true }),
      { status: 201, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  } catch (e) {
    if (isEdgeFunctionError(e)) return e.toResponse(req)
    return errorResponse(
      'INTERNAL',
      e instanceof Error ? e.message : 'Unknown error',
      undefined,
      undefined,
      req,
    )
  }
})
