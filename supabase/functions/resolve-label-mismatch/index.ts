// Edge Function: resolve-label-mismatch (NX-0050)
//
// POST { id } -> { ok: true }
//
// An Admin or Manager marks a label mismatch as dealt with (the barcode was
// checked, and fixed in the product form if it was wrong). Only an open row
// moves; a resolved one answers CONFLICT.

// deno-lint-ignore-file no-explicit-any
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.103.0'
import { z } from 'https://esm.sh/zod@3.23.8'
import { requireAuth, type UserRole } from '../_shared/auth.ts'
import { EdgeFunctionError, errorResponse, isEdgeFunctionError } from '../_shared/errors.ts'
import { corsHeadersFor } from '../_shared/cors.ts'
import { checkRateLimit } from '../_shared/rateLimit.ts'
import { requireModule } from '../_shared/modules.ts'
import { logAuditEvent } from '../_shared/audit.ts'

const ALLOWED: ReadonlyArray<UserRole> = ['Admin', 'Manager']

const inputSchema = z.object({ id: z.number().int().positive() })

serve(async (req: Request) => {
  const corsHeaders = corsHeadersFor(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    requireModule('inventory_dispatch')
    const auth = await requireAuth(req, { allowedRoles: ALLOWED })
    const rl = await checkRateLimit(`resolve-label-mismatch:${auth.userId}`, { windowMs: 60_000, max: 60 })
    if (!rl.ok) throw new EdgeFunctionError('TOO_MANY_REQUESTS', 'Rate limit exceeded')

    const body = await req.json().catch(() => {
      throw new EdgeFunctionError('INVALID_INPUT', 'Request body must be valid JSON')
    })
    const parsed = inputSchema.safeParse(body)
    if (!parsed.success) throw new EdgeFunctionError('INVALID_INPUT', 'Invalid request body', parsed.error.flatten())

    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
      auth: { persistSession: false },
    })
    const { data, error } = await admin.from('label_mismatches')
      .update({ status: 'resolved', resolved_by: auth.userId, resolved_at: new Date().toISOString() })
      .eq('id', parsed.data.id).eq('status', 'open')
      .select('id')
    if (error) {
      console.error('[resolve-label-mismatch] update failed', error)
      throw new EdgeFunctionError('INTERNAL', 'Could not mark it resolved, try again.')
    }
    if (!data || (data as any[]).length === 0) {
      throw new EdgeFunctionError('CONFLICT', 'That mismatch is already resolved, or does not exist.')
    }
    await logAuditEvent(admin, {
      actorId: auth.userId,
      actorRole: auth.role,
      action: 'update',
      resource: 'label_mismatch',
      resourceId: String(parsed.data.id),
      before: { status: 'open' },
      after: { status: 'resolved' },
    })
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (e) {
    if (isEdgeFunctionError(e)) return e.toResponse(req)
    console.error('[resolve-label-mismatch] unexpected', e)
    return errorResponse('INTERNAL', 'Could not mark it resolved, try again.', undefined, undefined, req)
  }
})
