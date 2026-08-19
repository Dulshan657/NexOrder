// create-signature-url Edge Function
//
// Returns a short-lived signed URL for one order's verification signature in
// the private `signatures` bucket, and writes an audit event saying who was
// handed it.
//
// Authorization model (mirrors create-order-document-url, which mirrors
// create-po-document-url):
//   1. The caller supplies an ORDER ID, never a storage path. A caller-chosen
//      path is the whole attack surface this shape exists to remove.
//   2. The order is read with the CALLER's JWT, so `orders` RLS is the
//      authority on whether they may see it. An order they cannot see and an
//      order that does not exist both come back empty, and both map to
//      NOT_FOUND — the two must stay indistinguishable.
//   3. Only the signing runs as service_role.
//
// THERE IS NO ROLE ALLOW-LIST, and that is deliberate. `orders` RLS already
// says exactly who may see an order: staff broadly, and a customer their own
// (00001:654 orders_select_customer, narrowed further by 00105). Adding a role
// list here would hide a customer's signature on their OWN order, which is the
// one own-scope case Compliance/_src/18-incident-register.md Record #1 names as
// part of the remediation. The storage path is `orders/<uuid>.png` and carries
// no link back to a row, so a storage RLS predicate could never have expressed
// this — an Edge Function is the only place the question can be asked.
//
// WHY IT AUDITS A READ. Signatures are Confidential personal information under
// Compliance/_src/20-data-classification-standard.md:100, and R-02's committed
// treatment is "audited signed URLs". `read` is a rare action in audit_events
// on purpose — see _shared/audit.ts.
//
// TTL is 5 minutes: long enough to render an <img>, short enough to bound the
// replay window if the URL reaches a proxy log.

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.103.0'
import { z } from 'https://esm.sh/zod@3.23.8'
import { requireAuth } from '../_shared/auth.ts'
import { EdgeFunctionError, errorResponse, isEdgeFunctionError } from '../_shared/errors.ts'
import { corsHeadersFor } from '../_shared/cors.ts'
import { checkRateLimit } from '../_shared/rateLimit.ts'
import { requireModule } from '../_shared/modules.ts'
import { logAuditEvent } from '../_shared/audit.ts'
import { toStorageRef } from '../_shared/storageKey.ts'

const BUCKET = 'signatures'
const SIGNED_URL_TTL_SECONDS = 5 * 60

const inputSchema = z.object({
  orderId: z.string().min(1).max(64),
})

serve(async (req: Request) => {
  const corsHeaders = corsHeadersFor(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') {
    return errorResponse('INVALID_INPUT', 'POST only', undefined, 405, req)
  }

  try {
    requireModule('sales_orders')
    // No allowedRoles — see the header. `orders` RLS is the authority.
    const auth = await requireAuth(req)

    const rl = await checkRateLimit(`create-signature-url:${auth.userId}`, {
      windowMs: 60_000,
      max: 120,
    })
    if (!rl.ok) throw new EdgeFunctionError('TOO_MANY_REQUESTS', 'Too many signed-URL requests')

    const body = await req.json().catch(() => {
      throw new EdgeFunctionError('INVALID_INPUT', 'Request body must be valid JSON')
    })
    const parsed = inputSchema.safeParse(body)
    if (!parsed.success) {
      throw new EdgeFunctionError('INVALID_INPUT', 'orderId required', parsed.error.flatten())
    }
    const { orderId } = parsed.data

    const { data: order, error: lookupError } = await auth.userClient
      .from('orders')
      .select('verification')
      .eq('id', orderId)
      .maybeSingle()
    if (lookupError) {
      throw new EdgeFunctionError('INTERNAL', `order lookup: ${lookupError.message}`)
    }
    if (!order) throw new EdgeFunctionError('NOT_FOUND', 'Order not found or not visible')

    const stored = (order.verification as { signatureDataUrl?: string } | null)?.signatureDataUrl
    const ref = toStorageRef(BUCKET, stored)

    // An inline `data:` row is a pre-storage signature (seedData/orders.ts:99)
    // and there is no object to sign. The client renders those directly and
    // should never reach here, so say what happened rather than 404ing.
    if (ref.kind === 'inline') {
      throw new EdgeFunctionError('INVALID_INPUT', 'This signature is stored inline and needs no signed URL')
    }
    if (ref.kind !== 'key') {
      throw new EdgeFunctionError('NOT_FOUND', 'This order has no stored signature')
    }

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { persistSession: false } },
    )

    const { data: signed, error: signError } = await admin.storage
      .from(BUCKET)
      .createSignedUrl(ref.key, SIGNED_URL_TTL_SECONDS)
    if (signError || !signed?.signedUrl) {
      throw new EdgeFunctionError('NOT_FOUND', `signed URL: ${signError?.message ?? 'no URL returned'}`)
    }

    await logAuditEvent(admin, {
      actorId: auth.userId,
      actorRole: auth.role,
      action: 'read',
      resource: 'signature',
      resourceId: orderId,
      metadata: { bucket: BUCKET, key: ref.key, ttlSeconds: SIGNED_URL_TTL_SECONDS },
    })

    return new Response(
      JSON.stringify({ signedUrl: signed.signedUrl, expiresInSeconds: SIGNED_URL_TTL_SECONDS }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  } catch (e) {
    if (isEdgeFunctionError(e)) return e.toResponse(req)
    console.warn('[create-signature-url] unexpected error:', e)
    return errorResponse('INTERNAL', 'Unexpected error', undefined, 500, req)
  }
})
