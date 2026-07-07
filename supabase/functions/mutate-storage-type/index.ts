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

const createSchema = z.object({
  code: z.string().min(1).max(32),
  name: z.string().min(1).max(120),
  default_capacity_slots: z.number().nonnegative().nullable().optional(),
  slot_unit: z.enum(SLOT_UNITS).default('pallet'),
  attributes: z.record(z.unknown()).optional(),
  sort_order: z.number().int().min(0).max(10000).optional(),
})

// Update touches everything except the stable `code` key.
const updateSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  default_capacity_slots: z.number().nonnegative().nullable().optional(),
  slot_unit: z.enum(SLOT_UNITS).optional(),
  attributes: z.record(z.unknown()).optional(),
  sort_order: z.number().int().min(0).max(10000).optional(),
  is_active: z.boolean().optional(),
}).refine((d) => Object.keys(d).length > 0, { message: 'At least one field must be provided for update' })

const inputSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('create'), data: createSchema }),
  z.object({ action: z.literal('update'), id: z.number().int().positive(), data: updateSchema }),
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
    return new Response(JSON.stringify({ ok: true, storage_type: updated }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (e) {
    if (isEdgeFunctionError(e)) return e.toResponse(req)
    return errorResponse('INTERNAL', e instanceof Error ? e.message : 'Unknown error', undefined, undefined, req)
  }
})
