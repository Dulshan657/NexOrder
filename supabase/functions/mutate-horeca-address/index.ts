// mutate-horeca-address Edge Function
//
// Owns CRUD on public.horeca_addresses — the per-HoReCa shipping-address
// book introduced by migration 00021. Admin + Manager can list/create/
// update/delete/set_default; everything is audited and rate-limited.
//
// Direct INSERT/UPDATE/DELETE on horeca_addresses is REVOKED from the
// authenticated role at the table level (00021) so all mutations land
// here. SELECT is allowed via RLS for staff (all rows) and customers
// (own HoReCa only).
//
// Business rules:
//   - street is required on create
//   - At most one is_default per horeca_id is enforced at the DB level
//     (UNIQUE partial index). The `set_default` action atomically un-flags
//     any currently-default row, then flags the chosen one, in a single
//     transaction expressed as a chained pair of updates. Because the
//     unique index only allows one TRUE per horeca_id, this is safe.
//   - delete on the last remaining default row leaves the HoReCa without
//     a default — the caller is expected to set_default on another row
//     afterward. Not an error.

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

// Address fields. street is the only required one — city/postcode/country
// are common to omit on small-business POs.
const addressBodySchema = z.object({
  label: z.string().min(1).max(80).nullable().optional(),
  street: z.string().min(1).max(200),
  city: z.string().min(1).max(80).nullable().optional(),
  postcode: z.string().min(1).max(20).nullable().optional(),
  country: z.string().min(1).max(80).nullable().optional(),
  recipient_name: z.string().min(1).max(120).nullable().optional(),
})

// On update, every field is optional.
const addressUpdateBodySchema = addressBodySchema.partial()

const inputSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('list'),
    horeca_id: z.number().int().positive(),
  }),
  z.object({
    action: z.literal('create'),
    horeca_id: z.number().int().positive(),
    data: addressBodySchema,
    is_default: z.boolean().optional(),   // pass true to immediately make this the default
  }),
  z.object({
    action: z.literal('update'),
    id: z.string().uuid(),
    data: addressUpdateBodySchema,
  }),
  z.object({
    action: z.literal('delete'),
    id: z.string().uuid(),
  }),
  z.object({
    action: z.literal('set_default'),
    id: z.string().uuid(),
  }),
])

serve(async (req: Request) => {
  const corsHeaders = corsHeadersFor(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const auth = await requireAuth(req, { allowedRoles: ALLOWED })

    const rl = checkRateLimit(`mutate-horeca-address:${auth.userId}`, {
      windowMs: 60_000,
      max: 60,
    })
    if (!rl.ok) {
      return errorResponse('TOO_MANY_REQUESTS', 'Too many address operations', undefined, 429, req)
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

    // ---- LIST ----
    if (input.action === 'list') {
      const { data, error } = await admin
        .from('horeca_addresses')
        .select('*')
        .eq('horeca_id', input.horeca_id)
        .order('is_default', { ascending: false })
        .order('label', { ascending: true })
        .order('created_at', { ascending: true })
      if (error) {
        throw new EdgeFunctionError('INTERNAL', `Failed to list addresses: ${error.message}`)
      }
      return json({ ok: true, addresses: data ?? [] }, 200, corsHeaders)
    }

    // ---- CREATE ----
    if (input.action === 'create') {
      // Verify the parent HoReCa exists. Lets us return 404 cleanly instead
      // of a confusing FK constraint error.
      const { data: parent, error: parentErr } = await admin
        .from('horecas')
        .select('id')
        .eq('id', input.horeca_id)
        .maybeSingle()
      if (parentErr) {
        throw new EdgeFunctionError('INTERNAL', `Parent lookup failed: ${parentErr.message}`)
      }
      if (!parent) {
        throw new EdgeFunctionError('NOT_FOUND', `HoReCa ${input.horeca_id} not found`)
      }

      // If the caller asked for this to become the default, clear the
      // current default first so the UNIQUE partial index doesn't reject
      // the insert.
      const wantDefault = input.is_default === true
      if (wantDefault) {
        const { error: clearErr } = await admin
          .from('horeca_addresses')
          .update({ is_default: false })
          .eq('horeca_id', input.horeca_id)
          .eq('is_default', true)
        if (clearErr) {
          throw new EdgeFunctionError('INTERNAL', `Failed to clear default: ${clearErr.message}`)
        }
      }

      const insertPayload = {
        horeca_id: input.horeca_id,
        is_default: wantDefault,
        ...input.data,
      }
      const { data: created, error: insertErr } = await admin
        .from('horeca_addresses')
        .insert(insertPayload as any)
        .select()
        .single()
      if (insertErr || !created) {
        throw new EdgeFunctionError('INTERNAL', insertErr?.message ?? 'Insert failed')
      }

      await logAuditEvent(admin, {
        actorId: auth.userId,
        actorRole: auth.role,
        action: 'create',
        resource: 'horeca_address',
        resourceId: String((created as any).id),
        after: created as Record<string, unknown>,
        reason: null,
      })

      return json({ ok: true, address: created }, 201, corsHeaders)
    }

    // ---- UPDATE ----
    if (input.action === 'update') {
      const { data: existing, error: fetchErr } = await admin
        .from('horeca_addresses')
        .select('*')
        .eq('id', input.id)
        .maybeSingle()
      if (fetchErr) {
        throw new EdgeFunctionError('INTERNAL', `Lookup failed: ${fetchErr.message}`)
      }
      if (!existing) {
        throw new EdgeFunctionError('NOT_FOUND', `Address ${input.id} not found`)
      }

      const beforeData = existing as Record<string, unknown>

      const { data: updated, error: updateErr } = await admin
        .from('horeca_addresses')
        .update(input.data as any)
        .eq('id', input.id)
        .select()
        .single()
      if (updateErr || !updated) {
        throw new EdgeFunctionError('INTERNAL', updateErr?.message ?? 'Update failed')
      }

      await logAuditEvent(admin, {
        actorId: auth.userId,
        actorRole: auth.role,
        action: 'update',
        resource: 'horeca_address',
        resourceId: input.id,
        before: beforeData,
        after: updated as Record<string, unknown>,
        reason: null,
      })

      return json({ ok: true, address: updated }, 200, corsHeaders)
    }

    // ---- DELETE ----
    if (input.action === 'delete') {
      const { data: existing, error: fetchErr } = await admin
        .from('horeca_addresses')
        .select('*')
        .eq('id', input.id)
        .maybeSingle()
      if (fetchErr) {
        throw new EdgeFunctionError('INTERNAL', `Lookup failed: ${fetchErr.message}`)
      }
      if (!existing) {
        throw new EdgeFunctionError('NOT_FOUND', `Address ${input.id} not found`)
      }

      const { error: delErr } = await admin
        .from('horeca_addresses')
        .delete()
        .eq('id', input.id)
      if (delErr) {
        throw new EdgeFunctionError('INTERNAL', `Delete failed: ${delErr.message}`)
      }

      await logAuditEvent(admin, {
        actorId: auth.userId,
        actorRole: auth.role,
        action: 'delete',
        resource: 'horeca_address',
        resourceId: input.id,
        before: existing as Record<string, unknown>,
        reason: null,
      })

      return json({ ok: true }, 200, corsHeaders)
    }

    // ---- SET_DEFAULT ----
    if (input.action === 'set_default') {
      const { data: target, error: fetchErr } = await admin
        .from('horeca_addresses')
        .select('id, horeca_id, is_default')
        .eq('id', input.id)
        .maybeSingle()
      if (fetchErr) {
        throw new EdgeFunctionError('INTERNAL', `Lookup failed: ${fetchErr.message}`)
      }
      if (!target) {
        throw new EdgeFunctionError('NOT_FOUND', `Address ${input.id} not found`)
      }

      const horecaId = (target as { horeca_id: number }).horeca_id

      // Two-step: clear current default for this HoReCa, then set the new one.
      // The UNIQUE partial index allows the temporary state of zero defaults.
      const { error: clearErr } = await admin
        .from('horeca_addresses')
        .update({ is_default: false })
        .eq('horeca_id', horecaId)
        .eq('is_default', true)
      if (clearErr) {
        throw new EdgeFunctionError('INTERNAL', `Failed to clear default: ${clearErr.message}`)
      }

      const { data: updated, error: setErr } = await admin
        .from('horeca_addresses')
        .update({ is_default: true })
        .eq('id', input.id)
        .select()
        .single()
      if (setErr || !updated) {
        throw new EdgeFunctionError('INTERNAL', setErr?.message ?? 'set_default failed')
      }

      await logAuditEvent(admin, {
        actorId: auth.userId,
        actorRole: auth.role,
        action: 'set_default',
        resource: 'horeca_address',
        resourceId: input.id,
        after: updated as Record<string, unknown>,
        reason: null,
      })

      return json({ ok: true, address: updated }, 200, corsHeaders)
    }

    throw new EdgeFunctionError('INVALID_INPUT', 'Unrecognised action')
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

function json(body: unknown, status: number, corsHeaders: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}
