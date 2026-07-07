// mutate-sales-target Edge Function
//
// Admin/Manager-only create / update / delete on `sales_targets`.
// Validates non-negative target value and that the period (start_date..end_date)
// does not overlap any existing target for the same user_id + type.
//
// Schema note: the DB columns are `start_date`, `end_date`, `target_value`,
// and `user_id` (UUID). This deviates from the original Phase 2 spec which
// referred to `period_start`, `period_end`, and `target_amount`; we follow
// `lib/database.types.ts` exactly.

// deno-lint-ignore-file no-explicit-any
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.103.0'
import { z } from 'https://esm.sh/zod@3.23.8'
import { requireAuth, type UserRole } from '../_shared/auth.ts'
import { EdgeFunctionError, errorResponse, isEdgeFunctionError } from '../_shared/errors.ts'
import { checkRateLimit } from '../_shared/rateLimit.ts'
import { logAuditEvent } from '../_shared/audit.ts'
import { corsHeadersFor } from '../_shared/cors.ts'

const ALLOWED: ReadonlyArray<UserRole> = ['Admin', 'Manager']

const TARGET_TYPES = ['revenue', 'orders', 'new_horecas'] as const

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD')

const createSchema = z.object({
  user_id: z.string().uuid(),
  type: z.enum(TARGET_TYPES),
  target_value: z.number().min(0, 'target_value must be >= 0'),
  start_date: isoDate,
  end_date: isoDate,
}).refine((d) => d.start_date <= d.end_date, {
  message: 'start_date must be on or before end_date',
  path: ['end_date'],
})

const updateSchema = z.object({
  user_id: z.string().uuid().optional(),
  type: z.enum(TARGET_TYPES).optional(),
  target_value: z.number().min(0).optional(),
  start_date: isoDate.optional(),
  end_date: isoDate.optional(),
}).refine((d) => Object.keys(d).length > 0, {
  message: 'At least one field must be provided for update',
})

const inputSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('create'), data: createSchema }),
  z.object({
    action: z.literal('update'),
    id: z.union([z.string(), z.number()]),
    data: updateSchema,
  }),
  z.object({
    action: z.literal('delete'),
    id: z.union([z.string(), z.number()]),
  }),
])

interface SalesTargetRow {
  id: string
  user_id: string
  type: typeof TARGET_TYPES[number]
  target_value: number
  start_date: string
  end_date: string
}

async function findOverlaps(
  admin: SupabaseClient,
  userId: string,
  type: SalesTargetRow['type'],
  start: string,
  end: string,
  excludeId?: string,
): Promise<SalesTargetRow[]> {
  // Two intervals [a,b] and [c,d] overlap iff a <= d AND c <= b.
  let query = admin
    .from('sales_targets')
    .select('id, user_id, type, target_value, start_date, end_date')
    .eq('user_id', userId)
    .eq('type', type)
    .lte('start_date', end)
    .gte('end_date', start)
  if (excludeId) {
    query = query.neq('id', excludeId)
  }
  const { data, error } = await query
  if (error) {
    throw new EdgeFunctionError('INTERNAL', `Overlap check failed: ${error.message}`)
  }
  return (data ?? []) as SalesTargetRow[]
}

function targetIdToString(id: string | number): string {
  // sales_targets.id is uuid (string). Coerce numbers (rare) to string.
  return typeof id === 'string' ? id : String(id)
}

serve(async (req: Request) => {
  const corsHeaders = corsHeadersFor(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const auth = await requireAuth(req, { allowedRoles: ALLOWED })

    // Per-user rate limit: 30/min/user. Matches other admin mutate functions.
    const rl = await checkRateLimit(`mutate-sales-target:${auth.userId}`, {
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
      const overlaps = await findOverlaps(
        admin,
        input.data.user_id,
        input.data.type,
        input.data.start_date,
        input.data.end_date,
      )
      if (overlaps.length > 0) {
        throw new EdgeFunctionError(
          'CONFLICT',
          'Sales target period overlaps an existing target for this user and type',
          { overlapsWith: overlaps.map((r) => r.id) },
        )
      }

      const { data: created, error } = await admin
        .from('sales_targets')
        .insert(input.data as any)
        .select()
        .single()
      if (error || !created) {
        throw new EdgeFunctionError('INTERNAL', error?.message ?? 'Failed to create sales target')
      }

      await logAuditEvent(admin, {
        actorId: auth.userId,
        actorRole: auth.role,
        action: 'create',
        resource: 'sales_targets',
        resourceId: String((created as any).id),
        after: created as Record<string, unknown>,
      })

      return new Response(JSON.stringify({ ok: true, salesTarget: created }), {
        status: 201,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (input.action === 'update') {
      const id = targetIdToString(input.id)

      const { data: existingRaw, error: fetchErr } = await admin
        .from('sales_targets')
        .select('*')
        .eq('id', id)
        .single()
      if (fetchErr || !existingRaw) {
        throw new EdgeFunctionError('NOT_FOUND', `Sales target ${id} not found`)
      }
      const existing = existingRaw as SalesTargetRow

      // Resolve effective values for overlap check using the union of existing
      // and proposed updates.
      const effective = {
        user_id: input.data.user_id ?? existing.user_id,
        type: input.data.type ?? existing.type,
        start_date: input.data.start_date ?? existing.start_date,
        end_date: input.data.end_date ?? existing.end_date,
      }
      if (effective.start_date > effective.end_date) {
        throw new EdgeFunctionError('INVALID_INPUT', 'start_date must be on or before end_date')
      }

      // Only re-run overlap check if any field that affects it changed.
      const periodChanged =
        input.data.user_id !== undefined ||
        input.data.type !== undefined ||
        input.data.start_date !== undefined ||
        input.data.end_date !== undefined

      if (periodChanged) {
        const overlaps = await findOverlaps(
          admin,
          effective.user_id,
          effective.type,
          effective.start_date,
          effective.end_date,
          id,
        )
        if (overlaps.length > 0) {
          throw new EdgeFunctionError(
            'CONFLICT',
            'Updated sales target period overlaps an existing target for this user and type',
            { overlapsWith: overlaps.map((r) => r.id) },
          )
        }
      }

      const { data: updated, error: updateErr } = await admin
        .from('sales_targets')
        .update(input.data as any)
        .eq('id', id)
        .select()
        .single()
      if (updateErr || !updated) {
        throw new EdgeFunctionError('INTERNAL', updateErr?.message ?? 'Failed to update sales target')
      }

      await logAuditEvent(admin, {
        actorId: auth.userId,
        actorRole: auth.role,
        action: 'update',
        resource: 'sales_targets',
        resourceId: id,
        before: existing as unknown as Record<string, unknown>,
        after: updated as Record<string, unknown>,
      })

      return new Response(JSON.stringify({ ok: true, salesTarget: updated }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // delete
    const id = targetIdToString(input.id)

    const { data: existing, error: fetchErr } = await admin
      .from('sales_targets')
      .select('*')
      .eq('id', id)
      .single()
    if (fetchErr || !existing) {
      throw new EdgeFunctionError('NOT_FOUND', `Sales target ${id} not found`)
    }

    const { error: deleteErr } = await admin.from('sales_targets').delete().eq('id', id)
    if (deleteErr) {
      throw new EdgeFunctionError('INTERNAL', deleteErr.message)
    }

    await logAuditEvent(admin, {
      actorId: auth.userId,
      actorRole: auth.role,
      action: 'delete',
      resource: 'sales_targets',
      resourceId: id,
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
