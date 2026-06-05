// receive-stock Edge Function
//
// Goods receipt (stock IN). Admin, Manager, and Warehouse roles record received
// quantities against products — optionally into a tracked batch (lot + expiry +
// barcode). Delegates the atomic balance/ledger/cache write to the
// inv_receive_stock Postgres RPC (service_role-only EXECUTE). Direct writes to
// inventory_balances / inventory_movements / batches are RLS-blocked.

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

// A YYYY-MM-DD date (matches an HTML <input type="date"> value).
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expiry_date must be YYYY-MM-DD')

const receiptLineSchema = z.object({
  product_id: z.number().int().positive(),
  quantity: z.number().positive(),
  lot_code: z.string().min(1).max(120).optional(),
  expiry_date: isoDate.optional(),
  barcode: z.string().min(1).max(120).optional(),
  supplier_id: z.number().int().positive().optional(),
  po_id: z.string().min(1).max(120).optional(),
})

const inputSchema = z.object({
  lines: z.array(receiptLineSchema).min(1).max(200),
})

serve(async (req: Request) => {
  const corsHeaders = corsHeadersFor(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const auth = await requireAuth(req, { allowedRoles: ALLOWED })

    // 30 receipts/min/user — well above interactive pace, throttles scripted abuse.
    const rl = await checkRateLimit(`receive-stock:${auth.userId}`, { windowMs: 60_000, max: 30 })
    if (!rl.ok) {
      throw new EdgeFunctionError('TOO_MANY_REQUESTS', 'Rate limit exceeded — too many receipts in a short period')
    }

    const body = await req.json().catch(() => {
      throw new EdgeFunctionError('INVALID_INPUT', 'Request body must be valid JSON')
    })

    const parsed = inputSchema.safeParse(body)
    if (!parsed.success) {
      throw new EdgeFunctionError('INVALID_INPUT', 'Invalid request body', parsed.error.flatten())
    }
    const { lines } = parsed.data

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { persistSession: false } },
    )

    const { data: result, error: rpcError } = await admin.rpc('inv_receive_stock', {
      p_lines: lines,
      p_actor: auth.userId,
    })
    if (rpcError) {
      // INVALID_QTY / NO_WAREHOUSE bubble up from the RPC as P0001.
      const msg = rpcError.message ?? 'inventory receipt failed'
      throw new EdgeFunctionError('INTERNAL', `receive failed: ${msg}`)
    }

    await logAuditEvent(admin, {
      actorId: auth.userId,
      actorRole: auth.role,
      action: 'create',
      resource: 'inventory_receipt',
      resourceId: null,
      after: { lines },
      metadata: { result },
    })

    return new Response(
      JSON.stringify({ ok: true, result }),
      { status: 201, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  } catch (e) {
    if (isEdgeFunctionError(e)) return e.toResponse(req)
    return errorResponse('INTERNAL', e instanceof Error ? e.message : 'Unknown error', undefined, undefined, req)
  }
})
