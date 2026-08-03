// mutate-warehouse-setup-ack Edge Function
//
// The only write path for `warehouse_setup_acknowledgements` (mig 00092) — the
// operator half of the warehouse setup checklist that closes gap M2. Direct
// writes are RLS-blocked.
//
// Two invariants live here because no constraint can express them:
//
//   1. Only a SIGN-OFF step may be acknowledged. The derived steps (is a layout
//      published? are labels confirmed? is there stock in a bin?) are read from
//      the database every render, so a row claiming one of them is done would
//      sit there contradicting what the panel actually displays. Refused, not
//      ignored — silently dropping it would read as success.
//   2. The target must be a real, active WAREHOUSE. The FK only proves it is
//      some `locations` row, and locations is one self-referential tree, so
//      without this a bin id would be accepted as a warehouse.
//
// Acknowledging is an UPSERT: re-stating a step re-stamps who and when, which
// is the honest record after a site is re-checked. Revoking deletes the row —
// the row existing IS the acknowledgement, so there is no third state.
//
// Admin AND Manager, unlike most of the WIE surface: a Manager owns products,
// stock import and warehouse locations, so several steps are theirs to perform
// even though Settings itself is Admin-only.

// deno-lint-ignore-file no-explicit-any
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.103.0'
import { z } from 'https://esm.sh/zod@3.23.8'
import { requireAuth, type UserRole } from '../_shared/auth.ts'
import { EdgeFunctionError, errorResponse, isEdgeFunctionError } from '../_shared/errors.ts'
import { logAuditEvent } from '../_shared/audit.ts'
import { corsHeadersFor } from '../_shared/cors.ts'
import { checkRateLimit } from '../_shared/rateLimit.ts'
import { SIGNOFF_STEP_KEYS, isSignoffStepKey } from '../_shared/warehouseSetupSteps.ts'

const ALLOWED: ReadonlyArray<UserRole> = ['Admin', 'Manager']

const stepKey = z.string().min(1).max(64)
const warehouseId = z.number().int().positive()

const inputSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('acknowledge'),
    warehouse_id: warehouseId,
    step_key: stepKey,
    // .nullish(), not .optional(): the client sends `?? null` for every
    // nullable column, and .optional() REJECTS null. With `strict` off nothing
    // catches that until an operator hits Save.
    note: z.string().max(400).nullish(),
  }),
  z.object({
    action: z.literal('revoke'),
    warehouse_id: warehouseId,
    step_key: stepKey,
  }),
])

/**
 * Failure details that NAME THE FIELD, as `{ issues: [{ path, message }] }`.
 * `error.flatten()` collapses a nested path onto its top-level key, which is
 * how an operator ends up being told only "Invalid request body".
 */
function validationIssues(error: z.ZodError): { issues: Array<{ path: string; message: string }> } {
  return {
    issues: error.issues.slice(0, 10).map((i) => ({ path: i.path.join('.'), message: i.message })),
  }
}

async function assertWarehouse(admin: any, id: number): Promise<string> {
  const { data, error } = await admin
    .from('locations')
    .select('id, code, name, kind, is_active')
    .eq('id', id)
    .maybeSingle()
  if (error) throw new EdgeFunctionError('INTERNAL', error.message)
  if (!data) throw new EdgeFunctionError('NOT_FOUND', `Warehouse ${id} not found`)
  if (data.kind !== 'WAREHOUSE') {
    throw new EdgeFunctionError(
      'INVALID_INPUT',
      `Location ${id} is a ${data.kind}, not a warehouse. Setup steps are recorded against the site, not a bin.`,
    )
  }
  if (data.is_active === false) {
    throw new EdgeFunctionError('CONFLICT', `Warehouse "${data.name ?? data.code}" is not active`)
  }
  return String(data.name ?? data.code ?? id)
}

serve(async (req: Request) => {
  const corsHeaders = corsHeadersFor(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const auth = await requireAuth(req, { allowedRoles: ALLOWED })
    const rl = await checkRateLimit(`mutate-warehouse-setup-ack:${auth.userId}`, {
      windowMs: 60_000,
      max: 60,
    })
    if (!rl.ok) throw new EdgeFunctionError('TOO_MANY_REQUESTS', 'Rate limit exceeded')

    const body = await req.json().catch(() => {
      throw new EdgeFunctionError('INVALID_INPUT', 'Request body must be valid JSON')
    })
    const parsed = inputSchema.safeParse(body)
    if (!parsed.success) {
      throw new EdgeFunctionError('INVALID_INPUT', 'Invalid request body', validationIssues(parsed.error))
    }
    const input = parsed.data

    // Invariant 1. Validated against the SHARED vocabulary, so the server can
    // never accept a key no panel will show or clear.
    if (!isSignoffStepKey(input.step_key)) {
      throw new EdgeFunctionError(
        'INVALID_INPUT',
        `"${input.step_key}" is not a step that can be signed off. Only these are: ${SIGNOFF_STEP_KEYS.join(', ')}.`,
      )
    }

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { persistSession: false } },
    )

    // Invariant 2.
    const warehouseName = await assertWarehouse(admin, input.warehouse_id)

    // ── revoke ───────────────────────────────────────────────────────────────
    if (input.action === 'revoke') {
      const { data: removed, error } = await admin
        .from('warehouse_setup_acknowledgements')
        .delete()
        .eq('warehouse_id', input.warehouse_id)
        .eq('step_key', input.step_key)
        .select()
        .maybeSingle()
      if (error) throw new EdgeFunctionError('INTERNAL', error.message)
      if (!removed) {
        throw new EdgeFunctionError(
          'NOT_FOUND',
          `"${input.step_key}" was not signed off for ${warehouseName}`,
        )
      }

      await logAuditEvent(admin, {
        actorId: auth.userId,
        actorRole: auth.role,
        action: 'delete',
        resource: 'warehouse_setup_acknowledgements',
        resourceId: String((removed as any).id),
        before: removed as Record<string, unknown>,
        metadata: { warehouse: warehouseName, step_key: input.step_key },
      })

      return new Response(JSON.stringify({ ok: true, acknowledgement: null }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // ── acknowledge (upsert on the natural key) ──────────────────────────────
    const row = {
      warehouse_id: input.warehouse_id,
      step_key: input.step_key,
      note: input.note ?? null,
      acknowledged_by: auth.userId,
      acknowledged_at: new Date().toISOString(),
    }

    const { data: saved, error } = await admin
      .from('warehouse_setup_acknowledgements')
      .upsert(row as any, { onConflict: 'warehouse_id,step_key' })
      .select()
      .single()
    if (error) throw new EdgeFunctionError('INTERNAL', error.message)

    await logAuditEvent(admin, {
      actorId: auth.userId,
      actorRole: auth.role,
      action: 'create',
      resource: 'warehouse_setup_acknowledgements',
      resourceId: String((saved as any).id),
      after: saved as Record<string, unknown>,
      metadata: { warehouse: warehouseName, step_key: input.step_key },
    })

    return new Response(JSON.stringify({ ok: true, acknowledgement: saved }), {
      status: 201,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (e) {
    if (isEdgeFunctionError(e)) return e.toResponse(req)
    return errorResponse('INTERNAL', e instanceof Error ? e.message : 'Unknown error', undefined, undefined, req)
  }
})
