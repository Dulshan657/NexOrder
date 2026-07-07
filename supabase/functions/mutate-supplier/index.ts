// mutate-supplier Edge Function
//
// Admin/Manager-only create / update / delete on `suppliers`.
// Validates email + phone format and refuses to delete a supplier that is
// referenced by an open purchase order (status Pending or Submitted).

// deno-lint-ignore-file no-explicit-any
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.103.0'
import { z } from 'https://esm.sh/zod@3.23.8'
import { requireAuth, type UserRole } from '../_shared/auth.ts'
import { EdgeFunctionError, errorResponse, isEdgeFunctionError } from '../_shared/errors.ts'
import { checkRateLimit } from '../_shared/rateLimit.ts'
import { logAuditEvent } from '../_shared/audit.ts'
import { corsHeadersFor } from '../_shared/cors.ts'

const ALLOWED: ReadonlyArray<UserRole> = ['Admin', 'Manager']

// At least 6 characters and at least one digit. Allows formatting characters
// like spaces, parentheses, dashes, and a leading '+'.
const phoneSchema = z
  .string()
  .min(6, 'Phone must be at least 6 characters')
  .regex(/\d/, 'Phone must contain at least one digit')

const supplierCreateSchema = z.object({
  name: z.string().min(1),
  contact_person: z.string().min(1),
  email: z.string().email(),
  phone: phoneSchema,
})

const supplierUpdateSchema = z.object({
  name: z.string().min(1).optional(),
  contact_person: z.string().min(1).optional(),
  email: z.string().email().optional(),
  phone: phoneSchema.optional(),
}).refine((d) => Object.keys(d).length > 0, {
  message: 'At least one field must be provided for update',
})

const inputSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('create'), data: supplierCreateSchema }),
  z.object({
    action: z.literal('update'),
    id: z.union([z.string(), z.number()]),
    data: supplierUpdateSchema,
  }),
  z.object({
    action: z.literal('delete'),
    id: z.union([z.string(), z.number()]),
  }),
])

function toNumericId(id: string | number): number {
  const n = typeof id === 'number' ? id : Number(id)
  if (!Number.isFinite(n) || !Number.isInteger(n)) {
    throw new EdgeFunctionError('INVALID_INPUT', 'Supplier id must be an integer')
  }
  return n
}

serve(async (req: Request) => {
  const corsHeaders = corsHeadersFor(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const auth = await requireAuth(req, { allowedRoles: ALLOWED })

    // Per-user rate limit: 30/min/user. Matches other admin mutate functions.
    const rl = await checkRateLimit(`mutate-supplier:${auth.userId}`, {
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
    const input = parsed.data

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { persistSession: false } },
    )

    if (input.action === 'create') {
      const { data: created, error } = await admin
        .from('suppliers')
        .insert(input.data as any)
        .select()
        .single()
      if (error || !created) {
        throw new EdgeFunctionError('INTERNAL', error?.message ?? 'Failed to create supplier')
      }

      await logAuditEvent(admin, {
        actorId: auth.userId,
        actorRole: auth.role,
        action: 'create',
        resource: 'suppliers',
        resourceId: String((created as any).id),
        after: created as Record<string, unknown>,
      })

      return new Response(JSON.stringify({ ok: true, supplier: created }), {
        status: 201,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (input.action === 'update') {
      const id = toNumericId(input.id)

      const { data: existing, error: fetchErr } = await admin
        .from('suppliers')
        .select('*')
        .eq('id', id)
        .single()
      if (fetchErr || !existing) {
        throw new EdgeFunctionError('NOT_FOUND', `Supplier ${id} not found`)
      }

      const { data: updated, error: updateErr } = await admin
        .from('suppliers')
        .update(input.data as any)
        .eq('id', id)
        .select()
        .single()
      if (updateErr || !updated) {
        throw new EdgeFunctionError('INTERNAL', updateErr?.message ?? 'Failed to update supplier')
      }

      await logAuditEvent(admin, {
        actorId: auth.userId,
        actorRole: auth.role,
        action: 'update',
        resource: 'suppliers',
        resourceId: String(id),
        before: existing as Record<string, unknown>,
        after: updated as Record<string, unknown>,
      })

      return new Response(JSON.stringify({ ok: true, supplier: updated }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // delete
    const id = toNumericId(input.id)

    const { data: existing, error: fetchErr } = await admin
      .from('suppliers')
      .select('*')
      .eq('id', id)
      .single()
    if (fetchErr || !existing) {
      throw new EdgeFunctionError('NOT_FOUND', `Supplier ${id} not found`)
    }

    // Block delete if any open POs reference this supplier (Pending or Submitted)
    const { data: openPOs, error: poErr } = await admin
      .from('purchase_orders')
      .select('id, status')
      .eq('supplier_id', id)
      .in('status', ['Pending', 'Submitted'])
    if (poErr) {
      throw new EdgeFunctionError('INTERNAL', poErr.message)
    }
    if (openPOs && openPOs.length > 0) {
      throw new EdgeFunctionError(
        'CONFLICT',
        `Supplier ${id} cannot be deleted while open purchase orders reference it`,
        { hasOpenPOs: true, count: openPOs.length, openPoIds: openPOs.map((p: any) => p.id) },
      )
    }

    const { error: deleteErr } = await admin.from('suppliers').delete().eq('id', id)
    if (deleteErr) {
      throw new EdgeFunctionError('INTERNAL', deleteErr.message)
    }

    await logAuditEvent(admin, {
      actorId: auth.userId,
      actorRole: auth.role,
      action: 'delete',
      resource: 'suppliers',
      resourceId: String(id),
      before: existing as Record<string, unknown>,
    })

    return new Response(JSON.stringify({ ok: true, deletedId: id }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (e) {
    if (isEdgeFunctionError(e)) return e.toResponse(req)
    return errorResponse('INTERNAL', e instanceof Error ? e.message : 'Unknown error', undefined, undefined, req)
  }
})
