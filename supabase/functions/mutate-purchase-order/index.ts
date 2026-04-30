// mutate-purchase-order Edge Function
//
// Admin/Manager-only create / update / status-transition on `purchase_orders`
// (and child rows in `purchase_order_items`). POs are immutable history once
// shipped, so there is no delete action — use the cancelled status instead.
//
// Status state machine (forward-only):
//   Pending --> Submitted --> Completed
//   Pending | Submitted | Completed --> Cancelled
//
// The DB enum is capitalized: 'Pending' | 'Submitted' | 'Completed' | 'Cancelled'.

// deno-lint-ignore-file no-explicit-any
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.103.0'
import { z } from 'https://esm.sh/zod@3.23.8'
import { requireAuth, type UserRole } from '../_shared/auth.ts'
import { EdgeFunctionError, errorResponse, isEdgeFunctionError } from '../_shared/errors.ts'
import { logAuditEvent } from '../_shared/audit.ts'
import { corsHeadersFor } from '../_shared/cors.ts'

const ALLOWED: ReadonlyArray<UserRole> = ['Admin', 'Manager']

const PO_STATUS = ['Pending', 'Submitted', 'Completed', 'Cancelled'] as const
type PoStatus = typeof PO_STATUS[number]

// Allowed forward transitions. Any → Cancelled is also allowed (added in code
// rather than the table to keep the table small).
const ALLOWED_TRANSITIONS: Record<PoStatus, ReadonlyArray<PoStatus>> = {
  Pending: ['Submitted', 'Cancelled'],
  Submitted: ['Completed', 'Cancelled'],
  Completed: ['Cancelled'],
  Cancelled: [],
}

const itemSchema = z.object({
  product_id: z.number().int().positive(),
  product_name: z.string().min(1),
  quantity: z.number().positive(),
  cost: z.number().min(0),
})

const createPoSchema = z.object({
  supplier_id: z.number().int().positive(),
  total: z.number().min(0),
  order_date: z.string().min(1),
  status: z.enum(PO_STATUS).optional(), // defaults to Pending
  items: z.array(itemSchema).min(1, 'Items list must be non-empty'),
})

const updatePoSchema = z.object({
  supplier_id: z.number().int().positive().optional(),
  total: z.number().min(0).optional(),
  order_date: z.string().min(1).optional(),
  items: z.array(itemSchema).min(1, 'Items list must be non-empty').optional(),
}).refine((d) => Object.keys(d).length > 0, {
  message: 'At least one field must be provided for update',
})

const inputSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('create'), data: createPoSchema }),
  z.object({
    action: z.literal('update'),
    id: z.string().min(1),
    data: updatePoSchema,
  }),
  z.object({
    action: z.literal('update-status'),
    id: z.string().min(1),
    status: z.enum(PO_STATUS),
    note: z.string().optional(),
  }),
])

async function loadPo(admin: SupabaseClient, id: string) {
  const { data, error } = await admin
    .from('purchase_orders')
    .select('*, purchase_order_items(*)')
    .eq('id', id)
    .single()
  if (error || !data) return null
  return data as Record<string, unknown> & { status: PoStatus }
}

async function ensureSupplierExists(admin: SupabaseClient, supplierId: number) {
  const { data, error } = await admin
    .from('suppliers')
    .select('id')
    .eq('id', supplierId)
    .single()
  if (error || !data) {
    throw new EdgeFunctionError('NOT_FOUND', `Supplier ${supplierId} not found`)
  }
}

serve(async (req: Request) => {
  const corsHeaders = corsHeadersFor(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const auth = await requireAuth(req, { allowedRoles: ALLOWED })

    const body = await req.json().catch(() => {
      throw new EdgeFunctionError('INVALID_INPUT', 'Request body must be valid JSON')
    })

    const parsed = inputSchema.safeParse(body)
    if (!parsed.success) {
      throw new EdgeFunctionError('INVALID_INPUT', 'Invalid request body', parsed.error.flatten())
    }
    const input = parsed.data

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { persistSession: false } },
    )

    if (input.action === 'create') {
      const { items, ...header } = input.data
      await ensureSupplierExists(admin, header.supplier_id)

      const newId = `PO-${Date.now()}`
      const { data: created, error: poErr } = await admin
        .from('purchase_orders')
        .insert({
          id: newId,
          supplier_id: header.supplier_id,
          total: header.total,
          order_date: header.order_date,
          status: header.status ?? 'Pending',
          submitted_by: auth.userId,
        } as any)
        .select()
        .single()
      if (poErr || !created) {
        throw new EdgeFunctionError('INTERNAL', poErr?.message ?? 'Failed to create purchase order')
      }

      const itemRows = items.map((it) => ({
        purchase_order_id: newId,
        product_id: it.product_id,
        product_name: it.product_name,
        quantity: it.quantity,
        cost: it.cost,
      }))

      const { error: itemsErr } = await admin.from('purchase_order_items').insert(itemRows as any)
      if (itemsErr) {
        // Best-effort rollback
        await admin.from('purchase_orders').delete().eq('id', newId)
        throw new EdgeFunctionError('INTERNAL', `Failed to insert items: ${itemsErr.message}`)
      }

      await logAuditEvent(admin, {
        actorId: auth.userId,
        actorRole: auth.role,
        action: 'create',
        resource: 'purchase_orders',
        resourceId: newId,
        after: { ...(created as object), items: itemRows },
      })

      return new Response(JSON.stringify({ ok: true, purchaseOrder: { ...created, items: itemRows } }), {
        status: 201,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (input.action === 'update') {
      const existing = await loadPo(admin, input.id)
      if (!existing) {
        throw new EdgeFunctionError('NOT_FOUND', `Purchase order ${input.id} not found`)
      }

      // Don't allow editing the body of a PO that has already moved past Pending,
      // since the items list is the source of truth for cost.
      if (existing.status !== 'Pending') {
        throw new EdgeFunctionError(
          'CONFLICT',
          `Cannot update purchase order in status "${existing.status}"; only Pending POs are editable`,
          { currentStatus: existing.status },
        )
      }

      const { items, ...rest } = input.data
      if (rest.supplier_id !== undefined) {
        await ensureSupplierExists(admin, rest.supplier_id)
      }

      const headerUpdate: Record<string, unknown> = { ...rest }
      let updated = existing
      if (Object.keys(headerUpdate).length > 0) {
        const { data, error } = await admin
          .from('purchase_orders')
          .update(headerUpdate as any)
          .eq('id', input.id)
          .select()
          .single()
        if (error || !data) {
          throw new EdgeFunctionError('INTERNAL', error?.message ?? 'Failed to update purchase order')
        }
        updated = { ...(data as any), purchase_order_items: (existing as any).purchase_order_items }
      }

      let updatedItems = (existing as any).purchase_order_items
      if (items) {
        // Replace items list atomically: delete existing rows, insert new.
        const { error: delErr } = await admin
          .from('purchase_order_items')
          .delete()
          .eq('purchase_order_id', input.id)
        if (delErr) {
          throw new EdgeFunctionError('INTERNAL', `Failed to clear items: ${delErr.message}`)
        }
        const newRows = items.map((it) => ({
          purchase_order_id: input.id,
          product_id: it.product_id,
          product_name: it.product_name,
          quantity: it.quantity,
          cost: it.cost,
        }))
        const { error: insErr, data: insData } = await admin
          .from('purchase_order_items')
          .insert(newRows as any)
          .select()
        if (insErr) {
          throw new EdgeFunctionError('INTERNAL', `Failed to insert new items: ${insErr.message}`)
        }
        updatedItems = insData ?? newRows
      }

      await logAuditEvent(admin, {
        actorId: auth.userId,
        actorRole: auth.role,
        action: 'update',
        resource: 'purchase_orders',
        resourceId: input.id,
        before: existing,
        after: { ...(updated as object), purchase_order_items: updatedItems },
      })

      return new Response(JSON.stringify({ ok: true, purchaseOrder: { ...updated, items: updatedItems } }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // update-status
    const existing = await loadPo(admin, input.id)
    if (!existing) {
      throw new EdgeFunctionError('NOT_FOUND', `Purchase order ${input.id} not found`)
    }

    const from = existing.status
    const to = input.status
    if (from === to) {
      throw new EdgeFunctionError(
        'CONFLICT',
        `Purchase order is already in status "${from}"`,
        { currentStatus: from },
      )
    }
    if (!ALLOWED_TRANSITIONS[from].includes(to)) {
      throw new EdgeFunctionError(
        'CONFLICT',
        `Forbidden status transition: "${from}" -> "${to}"`,
        { from, to, allowed: ALLOWED_TRANSITIONS[from] },
      )
    }

    const { data: updated, error: upErr } = await admin
      .from('purchase_orders')
      .update({ status: to } as any)
      .eq('id', input.id)
      .select()
      .single()
    if (upErr || !updated) {
      throw new EdgeFunctionError('INTERNAL', upErr?.message ?? 'Failed to update status')
    }

    await logAuditEvent(admin, {
      actorId: auth.userId,
      actorRole: auth.role,
      action: 'update',
      resource: 'purchase_orders',
      resourceId: input.id,
      before: { status: from },
      after: { status: to },
      reason: input.note,
      metadata: { kind: 'status-transition', from, to },
    })

    return new Response(JSON.stringify({ ok: true, purchaseOrder: updated }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (e) {
    if (isEdgeFunctionError(e)) return e.toResponse(req)
    return errorResponse('INTERNAL', e instanceof Error ? e.message : 'Unknown error', undefined, undefined, req)
  }
})
