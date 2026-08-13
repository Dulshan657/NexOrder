// unassign-replenishment Edge Function
//
// For a run someone starts and abandons: the task returns to the queue. No stock
// has moved at this point, so it is a pure state reversal.
//
// `cancel` is the other half — a human declining the work outright, which is a
// different fact from the system withdrawing it (mig 00082 keeps 'cancelled' and
// 'expired' distinct so "how often does the detector raise work nobody wants?"
// stays answerable).

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

const ALLOWED: ReadonlyArray<UserRole> = ['Admin', 'Manager', 'Warehouse']

const inputSchema = z.object({
  task_id: z.number().int().positive(),
  action: z.enum(['unassign', 'cancel']).default('unassign'),
  reason: z.string().max(400).optional(),
})

serve(async (req: Request) => {
  const corsHeaders = corsHeadersFor(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    requireModule('inventory_dispatch')
    const auth = await requireAuth(req, { allowedRoles: ALLOWED })
    const rl = await checkRateLimit(`unassign-replenishment:${auth.userId}`, { windowMs: 60_000, max: 120 })
    if (!rl.ok) throw new EdgeFunctionError('TOO_MANY_REQUESTS', 'Rate limit exceeded')

    const body = await req.json().catch(() => {
      throw new EdgeFunctionError('INVALID_INPUT', 'Request body must be valid JSON')
    })
    const parsed = inputSchema.safeParse(body)
    if (!parsed.success) throw new EdgeFunctionError('INVALID_INPUT', 'Invalid request body', parsed.error.flatten())
    const { task_id, action, reason } = parsed.data

    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
      auth: { persistSession: false },
    })

    const { data: task } = await admin.from('wie_replen_tasks')
      .select('id, warehouse_id, status').eq('id', task_id).maybeSingle()
    if (!task) throw new EdgeFunctionError('NOT_FOUND', `Replenishment task ${task_id} not found`)
    if (auth.role === 'Warehouse' && auth.profile.home_warehouse_id !== (task as any).warehouse_id) {
      throw new EdgeFunctionError('FORBIDDEN', 'You can only replenish at your own warehouse')
    }

    const { data: result, error: rpcErr } = action === 'cancel'
      ? await admin.rpc('wie_cancel_replen_tx', {
          p_task_id: task_id, p_reason: reason ?? null, p_actor: auth.userId,
        })
      : await admin.rpc('wie_unassign_replen_tx', { p_task_id: task_id, p_actor: auth.userId })

    if (rpcErr) {
      const msg = rpcErr.message ?? ''
      if (/CONFLICT|NOT_FOUND/.test(msg)) {
        throw new EdgeFunctionError('CONFLICT', msg.replace(/^[A-Z_]+:\s*/, ''))
      }
      throw new EdgeFunctionError('INTERNAL', msg)
    }

    await logAuditEvent(admin, {
      actorId: auth.userId, actorRole: auth.role, action: 'update', resource: 'wie_replen_tasks',
      resourceId: String(task_id),
      metadata: { stage: action, ...(reason ? { reason } : {}), ...(result as Record<string, unknown>) },
    })

    return new Response(JSON.stringify({ ok: true, result }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (e) {
    if (isEdgeFunctionError(e)) return e.toResponse(req)
    return errorResponse('INTERNAL', e instanceof Error ? e.message : 'Unknown error', undefined, undefined, req)
  }
})
