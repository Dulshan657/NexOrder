// generate-pick-slip Edge Function
//
// Renders a PICK SLIP PDF for an order (lists each line, the FIFO pick-from
// location/batch, and quantity), stores it in the private order-documents
// bucket, records it in order_documents, and returns a short-lived signed URL.
// Triggered when an order reaches 'processed' (from the Order Import Process
// action) and re-runnable on demand. Admin / Manager / Warehouse.

// deno-lint-ignore-file no-explicit-any
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.103.0'
import { z } from 'https://esm.sh/zod@3.23.8'
import { requireAuth, type UserRole } from '../_shared/auth.ts'
import { EdgeFunctionError, errorResponse, isEdgeFunctionError } from '../_shared/errors.ts'
import { checkRateLimit } from '../_shared/rateLimit.ts'
import { logAuditEvent } from '../_shared/audit.ts'
import { corsHeadersFor } from '../_shared/cors.ts'
import { loadOrderForDoc, buildOrderDocPdf, uploadAndRecordDoc } from '../_shared/orderDocuments.ts'

const ALLOWED: ReadonlyArray<UserRole> = ['Admin', 'Manager', 'Warehouse']
const inputSchema = z.object({ orderId: z.string().min(1) })

serve(async (req: Request) => {
  const corsHeaders = corsHeadersFor(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const auth = await requireAuth(req, { allowedRoles: ALLOWED })

    // Per-user rate limit: 20/min/user. Document generation is heavier than a plain mutate.
    const rl = await checkRateLimit(`generate-pick-slip:${auth.userId}`, {
      windowMs: 60_000,
      max: 20,
    })
    if (!rl.ok) {
      throw new EdgeFunctionError(
        'TOO_MANY_REQUESTS',
        `Rate limit exceeded; try again in ${Math.ceil(rl.resetMs / 1000)}s`,
      )
    }

    const body = await req.json().catch(() => {
      throw new EdgeFunctionError('INVALID_INPUT', 'Request body must be valid JSON')
    })
    const parsed = inputSchema.safeParse(body)
    if (!parsed.success) {
      throw new EdgeFunctionError('INVALID_INPUT', 'orderId required', parsed.error.flatten())
    }

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { persistSession: false } },
    )

    const data = await loadOrderForDoc(admin, parsed.data.orderId)
    const bytes = await buildOrderDocPdf('pick_slip', data)
    const { storagePath, signedUrl } = await uploadAndRecordDoc(
      admin, parsed.data.orderId, 'pick_slip', bytes, auth.userId, Date.now(),
    )

    await logAuditEvent(admin, {
      actorId: auth.userId,
      actorRole: auth.role,
      action: 'create',
      resource: 'order_document',
      resourceId: parsed.data.orderId,
      after: { doc_type: 'pick_slip', storage_path: storagePath },
    })

    return new Response(
      JSON.stringify({ ok: true, storagePath, signedUrl }),
      { status: 201, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  } catch (e) {
    if (isEdgeFunctionError(e)) return e.toResponse(req)
    return errorResponse('INTERNAL', e instanceof Error ? e.message : 'Unknown error', undefined, undefined, req)
  }
})
