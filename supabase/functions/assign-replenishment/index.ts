// assign-replenishment Edge Function
//
// The desk stage of a replenishment (mig 00082): pick which reserve/bulk bin the
// stock will come from, and claim the task for a walker. Moves NO stock — that
// is complete-replenishment's job, once someone has actually carried it.
//
// A partial assignment splits the task, leaving the original row 'suggested'
// with the remainder so the queue keeps showing what is still undecided.

// deno-lint-ignore-file no-explicit-any
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.103.0'
import { z } from 'https://esm.sh/zod@3.23.8'
import { requireAuth, type UserRole } from '../_shared/auth.ts'
import { EdgeFunctionError, errorResponse, isEdgeFunctionError } from '../_shared/errors.ts'
import { logAuditEvent } from '../_shared/audit.ts'
import { corsHeadersFor } from '../_shared/cors.ts'
import { checkRateLimit } from '../_shared/rateLimit.ts'

const ALLOWED: ReadonlyArray<UserRole> = ['Admin', 'Manager', 'Warehouse']

const inputSchema = z.object({
  task_id: z.number().int().positive(),
  from_location_id: z.number().int().positive(),
  quantity: z.number().positive().optional(),
})

serve(async (req: Request) => {
  const corsHeaders = corsHeadersFor(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const auth = await requireAuth(req, { allowedRoles: ALLOWED })
    const rl = await checkRateLimit(`assign-replenishment:${auth.userId}`, { windowMs: 60_000, max: 120 })
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

    const { data: task, error: tErr } = await admin
      .from('wie_replen_tasks')
      .select('id, warehouse_id, product_id, to_location_id, status, quantity')
      .eq('id', input.task_id).maybeSingle()
    if (tErr) throw new EdgeFunctionError('INTERNAL', tErr.message)
    if (!task) throw new EdgeFunctionError('NOT_FOUND', `Replenishment task ${input.task_id} not found`)

    if (auth.role === 'Warehouse' && auth.profile.home_warehouse_id !== (task as any).warehouse_id) {
      throw new EdgeFunctionError('FORBIDDEN', 'You can only replenish at your own warehouse')
    }

    // The source must sit in THIS warehouse. Resolve the bin's ROOT rather than
    // comparing the raw id — a levelled bin's id is nothing like its warehouse's
    // (the same fix record-pick needed).
    const { data: rootRow, error: rootErr } = await admin
      .rpc('inv_root_warehouse', { p_location_id: input.from_location_id })
    if (rootErr) throw new EdgeFunctionError('INTERNAL', rootErr.message)
    if (rootRow !== (task as any).warehouse_id) {
      throw new EdgeFunctionError('CONFLICT', 'That source bin is in a different warehouse')
    }

    const { data: fromLoc } = await admin
      .from('locations').select('id, code, is_active').eq('id', input.from_location_id).maybeSingle()
    if (!fromLoc) throw new EdgeFunctionError('NOT_FOUND', 'That source bin does not exist')
    if (!(fromLoc as any).is_active) {
      throw new EdgeFunctionError('CONFLICT', `${(fromLoc as any).code} is no longer active`)
    }

    const { data: result, error: rpcErr } = await admin.rpc('wie_assign_replen_tx', {
      p_task_id: input.task_id,
      p_from_location: input.from_location_id,
      p_qty: input.quantity ?? null,
      p_actor: auth.userId,
    })
    if (rpcErr) {
      const msg = rpcErr.message ?? ''
      if (/CONFLICT|INVALID_QTY|INVALID_INPUT|NOT_FOUND/.test(msg)) {
        throw new EdgeFunctionError('CONFLICT', msg.replace(/^[A-Z_]+:\s*/, ''))
      }
      throw new EdgeFunctionError('INTERNAL', msg)
    }

    await logAuditEvent(admin, {
      actorId: auth.userId, actorRole: auth.role, action: 'update', resource: 'wie_replen_tasks',
      resourceId: String(input.task_id),
      metadata: {
        stage: 'assign',
        from_location_id: input.from_location_id,
        to_location_id: (task as any).to_location_id,
        quantity: input.quantity ?? (task as any).quantity,
        ...(result as Record<string, unknown>),
      },
    })

    return new Response(JSON.stringify({ ok: true, result }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (e) {
    if (isEdgeFunctionError(e)) return e.toResponse(req)
    return errorResponse('INTERNAL', e instanceof Error ? e.message : 'Unknown error', undefined, undefined, req)
  }
})
