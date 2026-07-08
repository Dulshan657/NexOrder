// mutate-storage-type Edge Function
//
// Admin-only create / update / deactivate on `storage_types` — the tenant-global
// catalogue of physical storage-unit types (Pallet Rack, Shelving, Bulk Floor,
// Cold Room, …) operators manage. Types are never hard-deleted (locations FK
// them via storage_type_id); deactivate hides them from the pickers while keeping
// history valid. Direct writes are RLS-blocked; this service-role function is the
// sole write path.

// deno-lint-ignore-file no-explicit-any
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.103.0'
import { z } from 'https://esm.sh/zod@3.23.8'
import { requireAuth, type UserRole } from '../_shared/auth.ts'
import { EdgeFunctionError, errorResponse, isEdgeFunctionError } from '../_shared/errors.ts'
import { logAuditEvent } from '../_shared/audit.ts'
import { corsHeadersFor } from '../_shared/cors.ts'
import { checkRateLimit } from '../_shared/rateLimit.ts'

const ALLOWED: ReadonlyArray<UserRole> = ['Admin']
const SLOT_UNITS = ['pallet', 'carton', 'each', 'uncounted'] as const

// Storage-forms capacity fields (mig 00061): structured capacity, dims, weight,
// palette colour, drawable flag. All nullable/optional and additive.
const formFields = {
  levels: z.number().int().nonnegative().nullable().optional(),
  positions_per_level: z.number().int().nonnegative().nullable().optional(),
  weight_capacity_kg: z.number().nonnegative().nullable().optional(),
  length_cm: z.number().nonnegative().nullable().optional(),
  width_cm: z.number().nonnegative().nullable().optional(),
  height_cm: z.number().nonnegative().nullable().optional(),
  color: z.string().max(32).nullable().optional(),
  is_drawable: z.boolean().optional(),
}

const createSchema = z.object({
  code: z.string().min(1).max(32),
  name: z.string().min(1).max(120),
  default_capacity_slots: z.number().nonnegative().nullable().optional(),
  slot_unit: z.enum(SLOT_UNITS).default('pallet'),
  attributes: z.record(z.unknown()).optional(),
  sort_order: z.number().int().min(0).max(10000).optional(),
  ...formFields,
})

// Update touches everything except the stable `code` key.
const updateSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  default_capacity_slots: z.number().nonnegative().nullable().optional(),
  slot_unit: z.enum(SLOT_UNITS).optional(),
  attributes: z.record(z.unknown()).optional(),
  sort_order: z.number().int().min(0).max(10000).optional(),
  is_active: z.boolean().optional(),
  ...formFields,
}).refine((d) => Object.keys(d).length > 0, { message: 'At least one field must be provided for update' })

const inputSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('create'), data: createSchema }),
  // apply_to_existing: retro-apply the form's capacity/weight to every existing
  // location of this type (the "Apply to all units" choice on the save prompt).
  z.object({
    action: z.literal('update'),
    id: z.number().int().positive(),
    data: updateSchema,
    apply_to_existing: z.boolean().optional(),
  }),
  z.object({ action: z.literal('deactivate'), id: z.number().int().positive() }),
])

/** Normalise a code to SCREAMING_SNAKE so it stays a clean, stable key. */
function normaliseCode(code: string): string {
  return code.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '')
}

serve(async (req: Request) => {
  const corsHeaders = corsHeadersFor(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const auth = await requireAuth(req, { allowedRoles: ALLOWED })
    const rl = await checkRateLimit(`mutate-storage-type:${auth.userId}`, { windowMs: 60_000, max: 60 })
    if (!rl.ok) throw new EdgeFunctionError('TOO_MANY_REQUESTS', 'Rate limit exceeded')

    const body = await req.json().catch(() => {
      throw new EdgeFunctionError('INVALID_INPUT', 'Request body must be valid JSON')
    })
    const parsed = inputSchema.safeParse(body)
    if (!parsed.success) throw new EdgeFunctionError('INVALID_INPUT', 'Invalid request body', parsed.error.flatten())
    const input = parsed.data

    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
      auth: { persistSession: false },
    })

    if (input.action === 'create') {
      const row = {
        code: normaliseCode(input.data.code),
        name: input.data.name,
        default_capacity_slots: input.data.default_capacity_slots ?? null,
        slot_unit: input.data.slot_unit,
        attributes: input.data.attributes ?? {},
        sort_order: input.data.sort_order ?? 100,
        levels: input.data.levels ?? null,
        positions_per_level: input.data.positions_per_level ?? null,
        weight_capacity_kg: input.data.weight_capacity_kg ?? null,
        length_cm: input.data.length_cm ?? null,
        width_cm: input.data.width_cm ?? null,
        height_cm: input.data.height_cm ?? null,
        color: input.data.color ?? null,
        is_drawable: input.data.is_drawable ?? true,
      }
      if (!row.code) throw new EdgeFunctionError('INVALID_INPUT', 'Code must contain a letter or digit')

      const { data: created, error } = await admin.from('storage_types').insert(row as any).select().single()
      if (error) {
        if ((error as any).code === '23505') {
          throw new EdgeFunctionError('CONFLICT', `A storage type with code "${row.code}" already exists`)
        }
        throw new EdgeFunctionError('INTERNAL', error.message)
      }
      await logAuditEvent(admin, {
        actorId: auth.userId, actorRole: auth.role, action: 'create', resource: 'storage_types',
        resourceId: String((created as any).id), after: created as Record<string, unknown>,
      })
      return new Response(JSON.stringify({ ok: true, storage_type: created }), {
        status: 201, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // update / deactivate both need the existing row for the audit before-image.
    const { data: existing, error: fetchErr } = await admin
      .from('storage_types').select('*').eq('id', input.id).single()
    if (fetchErr || !existing) throw new EdgeFunctionError('NOT_FOUND', `Storage type ${input.id} not found`)

    const patch = input.action === 'deactivate' ? { is_active: false } : input.data
    const { data: updated, error: updErr } = await admin
      .from('storage_types').update(patch as any).eq('id', input.id).select().single()
    if (updErr || !updated) throw new EdgeFunctionError('INTERNAL', updErr?.message ?? 'Failed to update storage type')

    await logAuditEvent(admin, {
      actorId: auth.userId, actorRole: auth.role,
      action: input.action === 'deactivate' ? 'delete' : 'update', resource: 'storage_types',
      resourceId: String(input.id), before: existing as Record<string, unknown>, after: updated as Record<string, unknown>,
      metadata: input.action === 'deactivate' ? { deactivated: true } : undefined,
    })

    // Retro-apply: push this form's capacity/weight onto every existing unit of
    // the type (the operator chose "Apply to all units" on the save prompt).
    let appliedCount = 0
    if (input.action === 'update' && input.apply_to_existing) {
      const u = updated as Record<string, unknown>
      const { data: affected, error: applyErr } = await admin
        .from('locations')
        .update({ capacity_slots: u.default_capacity_slots ?? null, weight_capacity_kg: u.weight_capacity_kg ?? null })
        .eq('storage_type_id', input.id)
        .select('id')
      if (applyErr) throw new EdgeFunctionError('INTERNAL', `Applied the type but failed to update its units: ${applyErr.message}`)
      appliedCount = (affected ?? []).length
      if (appliedCount > 0) {
        await logAuditEvent(admin, {
          actorId: auth.userId, actorRole: auth.role, action: 'update', resource: 'locations',
          resourceId: String(input.id),
          after: { capacity_slots: u.default_capacity_slots ?? null, weight_capacity_kg: u.weight_capacity_kg ?? null } as Record<string, unknown>,
          metadata: { source: 'storage_type_retro_apply', storage_type_id: input.id, units_updated: appliedCount },
        })
      }
    }

    return new Response(JSON.stringify({ ok: true, storage_type: updated, applied_to_units: appliedCount }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (e) {
    if (isEdgeFunctionError(e)) return e.toResponse(req)
    return errorResponse('INTERNAL', e instanceof Error ? e.message : 'Unknown error', undefined, undefined, req)
  }
})
