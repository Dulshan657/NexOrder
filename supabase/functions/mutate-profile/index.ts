// mutate-profile Edge Function
//
// Admin-only update of an existing user's profile, identified by email (the
// frontend's numeric User.id is a lossy projection of the profile UUID, so email
// — which is unique — is the stable key). Supports the fields the Users admin
// form edits: name, avatar, role, horeca_id, home_warehouse_id. Direct UPDATE on
// profiles is RLS-blocked; only the service role (this function) may write.

// deno-lint-ignore-file no-explicit-any
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.103.0'
import { z } from 'https://esm.sh/zod@3.23.8'
import { requireAuth } from '../_shared/auth.ts'
import { EdgeFunctionError, errorResponse, isEdgeFunctionError } from '../_shared/errors.ts'
import { logAuditEvent } from '../_shared/audit.ts'
import { corsHeadersFor } from '../_shared/cors.ts'

const ROLES = [
  'Admin', 'Manager', 'Field Sales Rep', 'Office Sales Rep', 'Restaurant/Hotel Customer', 'Warehouse',
] as const

const inputSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1).max(160).optional(),
  avatarUrl: z.string().url().nullable().optional(),
  role: z.enum(ROLES).optional(),
  hoReCaId: z.number().int().positive().nullable().optional(),
  homeWarehouseId: z.number().int().positive().nullable().optional(),
})

serve(async (req: Request) => {
  const corsHeaders = corsHeadersFor(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const auth = await requireAuth(req, { allowedRoles: ['Admin'] })
    const body = await req.json().catch(() => {
      throw new EdgeFunctionError('INVALID_INPUT', 'Request body must be valid JSON')
    })
    const parsed = inputSchema.safeParse(body)
    if (!parsed.success) throw new EdgeFunctionError('INVALID_INPUT', 'Invalid request body', parsed.error.flatten())
    const input = parsed.data

    const admin: SupabaseClient = createClient(
      Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { persistSession: false } },
    )

    const { data: existing, error: findErr } = await admin
      .from('profiles')
      .select('*')
      .eq('email', input.email.toLowerCase())
      .single()
    if (findErr || !existing) throw new EdgeFunctionError('NOT_FOUND', `No user with email ${input.email}`)

    const effectiveRole = input.role ?? (existing as any).role
    // Role-conditional field rules (mirror invite-user).
    if (input.homeWarehouseId != null && effectiveRole !== 'Warehouse') {
      throw new EdgeFunctionError('INVALID_INPUT', 'Only the Warehouse role may have a home warehouse')
    }
    if (input.hoReCaId != null && effectiveRole !== 'Restaurant/Hotel Customer') {
      throw new EdgeFunctionError('INVALID_INPUT', 'Only the Customer role may have a HoReCa')
    }
    if (input.homeWarehouseId != null) {
      const { data: wh } = await admin.from('locations').select('id').eq('id', input.homeWarehouseId).eq('kind', 'WAREHOUSE').single()
      if (!wh) throw new EdgeFunctionError('NOT_FOUND', `Warehouse ${input.homeWarehouseId} not found`)
    }

    const patch: Record<string, unknown> = {}
    if (input.name !== undefined) patch.name = input.name
    if (input.avatarUrl !== undefined) patch.avatar_url = input.avatarUrl
    if (input.role !== undefined) patch.role = input.role
    // Clear incompatible links when the role changes away from them.
    if (input.hoReCaId !== undefined) patch.horeca_id = input.hoReCaId
    else if (input.role !== undefined && input.role !== 'Restaurant/Hotel Customer') patch.horeca_id = null
    if (input.homeWarehouseId !== undefined) patch.home_warehouse_id = input.homeWarehouseId
    else if (input.role !== undefined && input.role !== 'Warehouse') patch.home_warehouse_id = null

    if (Object.keys(patch).length === 0) {
      throw new EdgeFunctionError('INVALID_INPUT', 'No fields to update')
    }

    const { data: updated, error: updErr } = await admin
      .from('profiles')
      .update(patch)
      .eq('id', (existing as any).id)
      .select()
      .single()
    if (updErr || !updated) throw new EdgeFunctionError('INTERNAL', updErr?.message ?? 'Failed to update profile')

    await logAuditEvent(admin, {
      actorId: auth.userId, actorRole: auth.role, action: 'update', resource: 'profiles',
      resourceId: String((existing as any).id), before: existing as Record<string, unknown>, after: updated as Record<string, unknown>,
    })
    return new Response(JSON.stringify({ ok: true, profile: updated }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  } catch (e) {
    if (isEdgeFunctionError(e)) return e.toResponse(req)
    return errorResponse('INTERNAL', e instanceof Error ? e.message : 'Unknown error', undefined, undefined, req)
  }
})
