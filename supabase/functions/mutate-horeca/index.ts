// mutate-horeca Edge Function
//
// Admin and Manager can create, update, or delete HoReCa records.
//
// Business rules:
//   - discount_percent must be in 0–50
//   - credit_limit must be >= 0
//   - tier must be 'Gold' | 'Silver' | 'Bronze' | null
//   - Sensitive fields (credit_limit, tier, discount_percent): if the caller is
//     a Manager (not Admin) and any of these fields differ from the current row,
//     a non-empty `reason` field is required in the request. Missing reason →
//     400 INVALID_INPUT with { missingReason: true, sensitiveFieldsTouched: [...] }
//   - Delete: blocked if the HoReCa has any non-cancelled orders (409 CONFLICT)

// deno-lint-ignore-file no-explicit-any
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.103.0'
import { z } from 'https://esm.sh/zod@3.23.8'
import { requireAuth, type UserRole } from '../_shared/auth.ts'
import { EdgeFunctionError, errorResponse, isEdgeFunctionError } from '../_shared/errors.ts'
import { logAuditEvent } from '../_shared/audit.ts'
import { corsHeaders } from '../_shared/cors.ts'

const ALLOWED: ReadonlyArray<UserRole> = ['Admin', 'Manager']

type HoReCaTier = 'Gold' | 'Silver' | 'Bronze'
const TIER_VALUES: ReadonlyArray<HoReCaTier> = ['Gold', 'Silver', 'Bronze']
const tierEnum = z.enum(['Gold', 'Silver', 'Bronze'])

const SENSITIVE_FIELDS = ['credit_limit', 'tier', 'discount_percent'] as const
type SensitiveField = (typeof SENSITIVE_FIELDS)[number]

// Shared body — all fields optional for partial update
const horecaBodySchema = z.object({
  name: z.string().min(1).optional(),
  address: z.string().min(1).optional(),
  discount_percent: z.number().min(0).max(50).nullable().optional(),
  credit_limit: z.number().min(0).nullable().optional(),
  show_stock_tab: z.boolean().nullable().optional(),
  tier: tierEnum.nullable().optional(),
  lat: z.number().nullable().optional(),
  lng: z.number().nullable().optional(),
  is_temporary: z.boolean().optional(),
  created_by_user_id: z.string().uuid().nullable().optional(),
  reviewed_at: z.string().nullable().optional(),
  reviewed_by: z.string().nullable().optional(),
})

// Required fields for create
const horecaCreateBodySchema = horecaBodySchema.extend({
  name: z.string().min(1),
  address: z.string().min(1),
})

const inputSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('create'),
    data: horecaCreateBodySchema,
    reason: z.string().optional(),
  }),
  z.object({
    action: z.literal('update'),
    id: z.number().int().positive(),
    data: horecaBodySchema,
    reason: z.string().optional(),
  }),
  z.object({
    action: z.literal('delete'),
    id: z.number().int().positive(),
    reason: z.string().optional(),
  }),
])

// Determine which sensitive fields have changed between incoming data and the existing row
function touchedSensitiveFields(
  incoming: Record<string, unknown>,
  existing: Record<string, unknown>,
): SensitiveField[] {
  return SENSITIVE_FIELDS.filter((field) => {
    if (!(field in incoming)) return false
    return incoming[field] !== existing[field]
  })
}

serve(async (req: Request) => {
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

    // ---- CREATE ----
    if (input.action === 'create') {
      const d = input.data as Record<string, unknown>

      // Sensitive fields check on create for Managers
      if (auth.role === 'Manager') {
        const touched = SENSITIVE_FIELDS.filter((f) => f in d && d[f] != null)
        if (touched.length > 0) {
          const reason = input.reason?.trim()
          if (!reason) {
            throw new EdgeFunctionError(
              'INVALID_INPUT',
              'A reason is required when setting sensitive fields as Manager',
              { missingReason: true, sensitiveFieldsTouched: touched },
            )
          }
        }
      }

      const { data: createdRow, error: insertError } = await admin
        .from('horecas')
        .insert(d as any)
        .select()
        .single()

      if (insertError || !createdRow) {
        throw new EdgeFunctionError('INTERNAL', insertError?.message ?? 'Failed to create HoReCa')
      }

      await logAuditEvent(admin, {
        actorId: auth.userId,
        actorRole: auth.role,
        action: 'create',
        resource: 'horeca',
        resourceId: String((createdRow as any).id),
        after: createdRow as Record<string, unknown>,
        reason: input.reason ?? null,
      })

      return new Response(
        JSON.stringify({ ok: true, horeca: createdRow }),
        {
          status: 201,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        },
      )
    }

    // ---- UPDATE ----
    if (input.action === 'update') {
      const { data: existingRow, error: fetchError } = await admin
        .from('horecas')
        .select('*')
        .eq('id', input.id)
        .single()

      if (fetchError || !existingRow) {
        throw new EdgeFunctionError('NOT_FOUND', `HoReCa ${input.id} not found`)
      }

      const beforeData = existingRow as Record<string, unknown>
      const incoming = input.data as Record<string, unknown>

      // Sensitive fields check for Managers
      if (auth.role === 'Manager') {
        const touched = touchedSensitiveFields(incoming, beforeData)
        if (touched.length > 0) {
          const reason = input.reason?.trim()
          if (!reason) {
            throw new EdgeFunctionError(
              'INVALID_INPUT',
              'A reason is required when modifying sensitive fields as Manager',
              { missingReason: true, sensitiveFieldsTouched: touched },
            )
          }
        }
      }

      const { data: updatedRow, error: updateError } = await admin
        .from('horecas')
        .update(incoming as any)
        .eq('id', input.id)
        .select()
        .single()

      if (updateError || !updatedRow) {
        throw new EdgeFunctionError('INTERNAL', updateError?.message ?? 'Failed to update HoReCa')
      }

      await logAuditEvent(admin, {
        actorId: auth.userId,
        actorRole: auth.role,
        action: 'update',
        resource: 'horeca',
        resourceId: String(input.id),
        before: beforeData,
        after: updatedRow as Record<string, unknown>,
        reason: input.reason ?? null,
      })

      return new Response(
        JSON.stringify({ ok: true, horeca: updatedRow }),
        {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        },
      )
    }

    // ---- DELETE ----
    if (input.action === 'delete') {
      const { data: existingRow, error: fetchError } = await admin
        .from('horecas')
        .select('*')
        .eq('id', input.id)
        .single()

      if (fetchError || !existingRow) {
        throw new EdgeFunctionError('NOT_FOUND', `HoReCa ${input.id} not found`)
      }

      const beforeData = existingRow as Record<string, unknown>

      // Block delete if non-cancelled orders exist
      const { count, error: ordersError } = await admin
        .from('orders')
        .select('id', { count: 'exact', head: true })
        .eq('horeca_id', input.id)
        .neq('status', 'cancelled')

      if (ordersError) {
        throw new EdgeFunctionError('INTERNAL', `Failed to query orders: ${ordersError.message}`)
      }

      if ((count ?? 0) > 0) {
        throw new EdgeFunctionError(
          'CONFLICT',
          'Cannot delete a HoReCa that has non-archived orders',
          { hasOpenOrders: true, count: count ?? 0 },
        )
      }

      const { error: deleteError } = await admin
        .from('horecas')
        .delete()
        .eq('id', input.id)

      if (deleteError) {
        throw new EdgeFunctionError('INTERNAL', deleteError.message)
      }

      await logAuditEvent(admin, {
        actorId: auth.userId,
        actorRole: auth.role,
        action: 'delete',
        resource: 'horeca',
        resourceId: String(input.id),
        before: beforeData,
        reason: input.reason ?? null,
      })

      return new Response(
        JSON.stringify({ ok: true }),
        {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        },
      )
    }

    // Unreachable
    throw new EdgeFunctionError('INVALID_INPUT', 'Unrecognised action')
  } catch (e) {
    if (isEdgeFunctionError(e)) return e.toResponse()
    return errorResponse('INTERNAL', e instanceof Error ? e.message : 'Unknown error')
  }
})
