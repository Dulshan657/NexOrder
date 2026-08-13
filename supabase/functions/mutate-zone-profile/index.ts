// mutate-zone-profile Edge Function
//
// Admin-only create / update / deactivate on `zone_profiles`. Profiles drive the
// putaway optimizer (priority weight + allowed-category gate + utilization
// target). Deactivate (never delete — locations FK them) is blocked while any
// location still references the profile. Direct writes are RLS-blocked; this
// service-role function is the sole write path.

// deno-lint-ignore-file no-explicit-any
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.103.0'
import { z } from 'https://esm.sh/zod@3.23.8'
import { requireAuth, type UserRole } from '../_shared/auth.ts'
import { EdgeFunctionError, errorResponse, isEdgeFunctionError } from '../_shared/errors.ts'
import { logAuditEvent } from '../_shared/audit.ts'
import { corsHeadersFor } from '../_shared/cors.ts'
import { checkRateLimit } from '../_shared/rateLimit.ts'
import { requireModule } from '../_shared/modules.ts'

const ALLOWED: ReadonlyArray<UserRole> = ['Admin']

const createSchema = z.object({
  name: z.string().min(1).max(120),
  zone_type: z.string().min(1).max(48),
  priority_weight: z.number().min(0).max(1),
  allowed_categories: z.array(z.string().min(1).max(120)).nullable().optional(),
  max_utilization_pct: z.number().min(0).max(1).nullable().optional(),
  // mig 00101 — stock in this zone is held: on hand, not allocatable, and not a
  // putaway target for ordinary receipts.
  is_hold: z.boolean().optional(),
})

const updateSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  zone_type: z.string().min(1).max(48).optional(),
  priority_weight: z.number().min(0).max(1).optional(),
  allowed_categories: z.array(z.string().min(1).max(120)).nullable().optional(),
  max_utilization_pct: z.number().min(0).max(1).nullable().optional(),
  is_hold: z.boolean().optional(),
  is_active: z.boolean().optional(),
}).refine((d) => Object.keys(d).length > 0, { message: 'At least one field must be provided for update' })

const inputSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('create'), data: createSchema }),
  z.object({ action: z.literal('update'), id: z.number().int().positive(), data: updateSchema }),
  z.object({ action: z.literal('deactivate'), id: z.number().int().positive() }),
])

serve(async (req: Request) => {
  const corsHeaders = corsHeadersFor(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    requireModule('inventory_dispatch')
    const auth = await requireAuth(req, { allowedRoles: ALLOWED })
    const rl = await checkRateLimit(`mutate-zone-profile:${auth.userId}`, { windowMs: 60_000, max: 60 })
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
        name: input.data.name,
        zone_type: input.data.zone_type.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, ''),
        priority_weight: input.data.priority_weight,
        allowed_categories: input.data.allowed_categories ?? null,
        max_utilization_pct: input.data.max_utilization_pct ?? null,
        is_hold: input.data.is_hold ?? false,
      }
      if (!row.zone_type) throw new EdgeFunctionError('INVALID_INPUT', 'Zone type must contain a letter or digit')

      const { data: created, error } = await admin.from('zone_profiles').insert(row as any).select().single()
      if (error) {
        if ((error as any).code === '23505') {
          throw new EdgeFunctionError('CONFLICT', `A profile named "${row.name}" with type "${row.zone_type}" already exists`)
        }
        throw new EdgeFunctionError('INTERNAL', error.message)
      }
      await logAuditEvent(admin, {
        actorId: auth.userId, actorRole: auth.role, action: 'create', resource: 'zone_profiles',
        resourceId: String((created as any).id), after: created as Record<string, unknown>,
      })
      return new Response(JSON.stringify({ ok: true, zone_profile: created }), {
        status: 201, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const { data: existing, error: fetchErr } = await admin
      .from('zone_profiles').select('*').eq('id', input.id).single()
    if (fetchErr || !existing) throw new EdgeFunctionError('NOT_FOUND', `Zone profile ${input.id} not found`)

    if (input.action === 'deactivate') {
      // Block while any location still points at this profile — deactivating it
      // would silently strip those zones' semantics from the optimizer.
      const { data: refs } = await admin.from('locations').select('id').eq('zone_profile_id', input.id).limit(1)
      if (refs && refs.length > 0) {
        throw new EdgeFunctionError('CONFLICT', 'This profile is still assigned to zones. Reassign them before deactivating it.')
      }
    }

    const patch = input.action === 'deactivate' ? { is_active: false } : input.data
    const { data: updated, error: updErr } = await admin
      .from('zone_profiles').update(patch as any).eq('id', input.id).select().single()
    if (updErr || !updated) throw new EdgeFunctionError('INTERNAL', updErr?.message ?? 'Failed to update zone profile')

    await logAuditEvent(admin, {
      actorId: auth.userId, actorRole: auth.role,
      action: input.action === 'deactivate' ? 'delete' : 'update', resource: 'zone_profiles',
      resourceId: String(input.id), before: existing as Record<string, unknown>, after: updated as Record<string, unknown>,
      metadata: input.action === 'deactivate' ? { deactivated: true } : undefined,
    })
    return new Response(JSON.stringify({ ok: true, zone_profile: updated }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (e) {
    if (isEdgeFunctionError(e)) return e.toResponse(req)
    return errorResponse('INTERNAL', e instanceof Error ? e.message : 'Unknown error', undefined, undefined, req)
  }
})
