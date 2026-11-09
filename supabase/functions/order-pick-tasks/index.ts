// order-pick-tasks Edge Function
//
// Directed picking (P2 fix): returns the ACTIONABLE per-bin pick tasks for one
// order — the same allocation netting the route (recommend-pick-route) and the
// pick slip (generate-pick-slip) now read, so all three name the same bins.
// Read-only: it loads wie_order_pick_tasks (raw per-bin allocation) plus this
// order's lines and recorded picks, and runs them through the pure
// buildPickTasks helper (_shared/wie/pickTasks.ts) to split allocation-per-bin
// into pick-per-order-line-per-bin tasks with a `remaining` qty.
//
// For an order imported from an invoice (qb_invoice_number set, NX-0029) it also
// offers the part no reservation covers at bins with free stock, and reports the
// lines closed short and the found quantity of each line. The work lives in
// _shared/orderPickTasks.ts so it can be tested with a fake database; the response
// of every other order is unchanged apart from `imported: false` and an empty list.
//
// Any warehouse's tasks are returned — the caller (PickWorkspaceModal) disables
// buttons for bins outside a Warehouse-role user's home site, mirroring the
// server-side guard record-pick enforces on the actual write.

// deno-lint-ignore-file no-explicit-any
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.103.0'
import { z } from 'https://esm.sh/zod@3.23.8'
import { requireAuth, type UserRole } from '../_shared/auth.ts'
import { EdgeFunctionError, errorResponse, isEdgeFunctionError } from '../_shared/errors.ts'
import { corsHeadersFor } from '../_shared/cors.ts'
import { checkRateLimit } from '../_shared/rateLimit.ts'
import { loadOrderPickTasks } from '../_shared/orderPickTasks.ts'
import { requireModule } from '../_shared/modules.ts'

const ALLOWED: ReadonlyArray<UserRole> = ['Admin', 'Manager', 'Warehouse']

const inputSchema = z.object({
  orderId: z.string().min(1).max(120),
})

serve(async (req: Request) => {
  const corsHeaders = corsHeadersFor(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    requireModule('inventory_dispatch')
    const auth = await requireAuth(req, { allowedRoles: ALLOWED })
    const rl = await checkRateLimit(`order-pick-tasks:${auth.userId}`, { windowMs: 60_000, max: 120 })
    if (!rl.ok) throw new EdgeFunctionError('TOO_MANY_REQUESTS', 'Rate limit exceeded')

    const body = await req.json().catch(() => {
      throw new EdgeFunctionError('INVALID_INPUT', 'Request body must be valid JSON')
    })
    const parsed = inputSchema.safeParse(body)
    if (!parsed.success) throw new EdgeFunctionError('INVALID_INPUT', 'Invalid request body', parsed.error.flatten())
    const { orderId } = parsed.data

    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
      auth: { persistSession: false },
    })

    const answer = await loadOrderPickTasks(admin, orderId)

    return new Response(JSON.stringify({ ok: true, ...answer }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (e) {
    if (isEdgeFunctionError(e)) return e.toResponse(req)
    return errorResponse('INTERNAL', e instanceof Error ? e.message : 'Unknown error', undefined, undefined, req)
  }
})
