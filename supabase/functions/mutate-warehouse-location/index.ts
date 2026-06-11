// mutate-warehouse-location Edge Function
//
// Admin/Manager CRUD for the storage TREE inside a racked warehouse — the
// ZONE / BIN / SHELF locations under a WAREHOUSE row (mig 00036/00039). Admins
// build whatever depth they want. materialized_path is computed server-side from
// the parent so it always stays consistent. A node holding stock cannot be
// deactivated. Direct writes to `locations` are RLS-blocked.

// deno-lint-ignore-file no-explicit-any
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.103.0'
import { z } from 'https://esm.sh/zod@3.23.8'
import { requireAuth, type UserRole } from '../_shared/auth.ts'
import { EdgeFunctionError, errorResponse, isEdgeFunctionError } from '../_shared/errors.ts'
import { logAuditEvent } from '../_shared/audit.ts'
import { corsHeadersFor } from '../_shared/cors.ts'

const ALLOWED: ReadonlyArray<UserRole> = ['Admin', 'Manager']
const NODE_KINDS = ['ZONE', 'BIN', 'SHELF'] as const

const createSchema = z.object({
  parent_id: z.number().int().positive(),
  kind: z.enum(NODE_KINDS),
  code: z.string().min(1).max(48),
  name: z.string().min(1).max(120),
  capacity_slots: z.number().nonnegative().optional(),
  slot_kind: z.enum(['pallet', 'carton']).optional(),
})

const updateSchema = z
  .object({
    name: z.string().min(1).max(120).optional(),
    capacity_slots: z.number().nonnegative().nullable().optional(),
    slot_kind: z.enum(['pallet', 'carton']).nullable().optional(),
    is_active: z.boolean().optional(),
  })
  .refine((d) => Object.keys(d).length > 0, { message: 'At least one field required' })

const inputSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('create'), data: createSchema }),
  z.object({ action: z.literal('update'), id: z.number().int().positive(), data: updateSchema }),
  z.object({ action: z.literal('deactivate'), id: z.number().int().positive() }),
])

/** The WAREHOUSE root id for a node (walks up the tree). */
async function rootWarehouse(admin: any, locationId: number): Promise<{ id: number; location_type: string | null } | null> {
  let cur = locationId
  for (let i = 0; i < 12; i++) {
    const { data } = await admin.from('locations').select('id, parent_id, kind, location_type').eq('id', cur).single()
    if (!data) return null
    if ((data as any).kind === 'WAREHOUSE') return { id: (data as any).id, location_type: (data as any).location_type }
    if ((data as any).parent_id == null) return null
    cur = (data as any).parent_id
  }
  return null
}

async function nodeHasStock(admin: any, locationId: number): Promise<boolean> {
  const { data } = await admin.from('inventory_balances').select('id').gt('on_hand', 0).eq('location_id', locationId).limit(1)
  return !!(data && data.length > 0)
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
    if (!parsed.success) throw new EdgeFunctionError('INVALID_INPUT', 'Invalid request body', parsed.error.flatten())
    const input = parsed.data

    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
      auth: { persistSession: false },
    })

    if (input.action === 'create') {
      const { data: parent, error: pErr } = await admin
        .from('locations')
        .select('id, materialized_path, is_active')
        .eq('id', input.data.parent_id)
        .single()
      if (pErr || !parent) throw new EdgeFunctionError('NOT_FOUND', 'Parent location not found')

      const root = await rootWarehouse(admin, input.data.parent_id)
      if (!root) throw new EdgeFunctionError('INVALID_INPUT', 'Parent is not inside a warehouse')
      if (root.location_type !== 'racked') {
        throw new EdgeFunctionError('CONFLICT', 'Storage bins can only be added to a racked warehouse')
      }

      const row = {
        parent_id: input.data.parent_id,
        kind: input.data.kind,
        code: input.data.code,
        name: input.data.name,
        materialized_path: `${(parent as any).materialized_path}/${input.data.code}`,
        capacity_slots: input.data.capacity_slots ?? null,
        slot_kind: input.data.slot_kind ?? null,
        is_active: true,
      }
      const { data: created, error } = await admin.from('locations').insert(row as any).select().single()
      if (error || !created) {
        if (error?.code === '23505') throw new EdgeFunctionError('CONFLICT', `Code "${input.data.code}" already exists`)
        throw new EdgeFunctionError('INTERNAL', error?.message ?? 'Failed to create location')
      }
      await logAuditEvent(admin, {
        actorId: auth.userId, actorRole: auth.role, action: 'create', resource: 'locations',
        resourceId: String((created as any).id), after: created as Record<string, unknown>,
      })
      return new Response(JSON.stringify({ ok: true, location: created }), {
        status: 201, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const { data: existing, error: fErr } = await admin.from('locations').select('*').eq('id', input.id).single()
    if (fErr || !existing) throw new EdgeFunctionError('NOT_FOUND', `Location ${input.id} not found`)
    if ((existing as any).kind === 'WAREHOUSE') {
      throw new EdgeFunctionError('INVALID_INPUT', 'Use mutate-warehouse for WAREHOUSE rows')
    }

    if (input.action === 'update') {
      const { data: updated, error } = await admin.from('locations').update(input.data as any).eq('id', input.id).select().single()
      if (error || !updated) throw new EdgeFunctionError('INTERNAL', error?.message ?? 'Failed to update location')
      await logAuditEvent(admin, {
        actorId: auth.userId, actorRole: auth.role, action: 'update', resource: 'locations',
        resourceId: String(input.id), before: existing as Record<string, unknown>, after: updated as Record<string, unknown>,
      })
      return new Response(JSON.stringify({ ok: true, location: updated }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // deactivate
    if (await nodeHasStock(admin, input.id)) {
      throw new EdgeFunctionError('CONFLICT', 'Cannot deactivate a bin that still holds stock — move it out first')
    }
    const { data: deactivated, error } = await admin.from('locations').update({ is_active: false }).eq('id', input.id).select().single()
    if (error || !deactivated) throw new EdgeFunctionError('INTERNAL', error?.message ?? 'Failed to deactivate location')
    await logAuditEvent(admin, {
      actorId: auth.userId, actorRole: auth.role, action: 'update', resource: 'locations',
      resourceId: String(input.id), before: existing as Record<string, unknown>, after: deactivated as Record<string, unknown>,
      metadata: { deactivated: true },
    })
    return new Response(JSON.stringify({ ok: true, location: deactivated }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (e) {
    if (isEdgeFunctionError(e)) return e.toResponse(req)
    return errorResponse('INTERNAL', e instanceof Error ? e.message : 'Unknown error', undefined, undefined, req)
  }
})
