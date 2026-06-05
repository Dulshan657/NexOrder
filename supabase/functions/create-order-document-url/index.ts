// create-order-document-url Edge Function
//
// Returns a short-lived signed URL for a stored pick slip / dispatch advice
// PDF in the private `order-documents` Storage bucket. Used by the Documents
// view and Order Import so an operator can re-open a document after the
// generation-time signed URL (also 5 min) has expired, without exposing the
// bucket to anonymous reads.
//
// Authorization model (mirrors create-po-document-url):
//   1. requireAuth restricts callers to Admin/Manager/Warehouse.
//   2. The caller specifies an order_documents.id, NOT a raw storage path.
//      The function resolves storage_path via the CALLER's JWT, so the
//      ops-only SELECT RLS on order_documents is the authority on which rows
//      they can see. This binds the signed URL to a row the caller can already
//      read and eliminates the "supply an arbitrary path" attack surface.
//   3. Signing requires service_role (storage policies permit signing only via
//      service_role in our setup).
//
// TTL is short (5 minutes) — long enough to open/download the PDF, short
// enough to bound the replay window if the URL leaks into a proxy log.

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.103.0'
import { z } from 'https://esm.sh/zod@3.23.8'
import { corsHeadersFor } from '../_shared/cors.ts'
import { EdgeFunctionError, errorResponse } from '../_shared/errors.ts'
import { requireAuth, type UserRole } from '../_shared/auth.ts'
import { checkRateLimit } from '../_shared/rateLimit.ts'

const ALLOWED: ReadonlyArray<UserRole> = ['Admin', 'Manager', 'Warehouse']
const BUCKET = 'order-documents'
const SIGNED_URL_TTL_SECONDS = 5 * 60

const inputSchema = z.object({
  orderDocumentId: z.number().int().positive(),
})

serve(async (req: Request) => {
  const corsHeaders = corsHeadersFor(req)
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })
  if (req.method !== 'POST') {
    return errorResponse('INVALID_INPUT', 'POST only', undefined, 405, req)
  }

  try {
    const ctx = await requireAuth(req, { allowedRoles: ALLOWED })

    const rl = await checkRateLimit(`create-order-document-url:${ctx.userId}`, {
      windowMs: 60_000,
      max: 120,
    })
    if (!rl.ok) {
      return errorResponse('TOO_MANY_REQUESTS', 'Too many signed-URL requests', undefined, 429, req)
    }

    const body = await req.json().catch(() => {
      throw new EdgeFunctionError('INVALID_INPUT', 'Body must be JSON')
    })
    const parsed = inputSchema.safeParse(body)
    if (!parsed.success) {
      throw new EdgeFunctionError('INVALID_INPUT', 'orderDocumentId (positive integer) required', parsed.error.flatten())
    }
    const { orderDocumentId } = parsed.data

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!

    // Resolve storage_path via the CALLER's JWT — ops-only RLS on
    // order_documents is the authority. A row the caller can't see comes back
    // empty (indistinguishable from missing), so both map to NOT_FOUND.
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: req.headers.get('Authorization')! } },
      auth: { persistSession: false },
    })
    const { data: doc, error: lookupError } = await userClient
      .from('order_documents')
      .select('storage_path')
      .eq('id', orderDocumentId)
      .maybeSingle()
    if (lookupError) {
      throw new EdgeFunctionError('INTERNAL', `order_documents lookup: ${lookupError.message}`)
    }
    if (!doc?.storage_path) {
      throw new EdgeFunctionError('NOT_FOUND', 'document not found or not visible')
    }

    // Sign with service_role.
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const serviceClient = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } })
    const { data, error } = await serviceClient.storage
      .from(BUCKET)
      .createSignedUrl(doc.storage_path as string, SIGNED_URL_TTL_SECONDS)
    if (error || !data?.signedUrl) {
      throw new EdgeFunctionError('NOT_FOUND', `signed URL: ${error?.message ?? 'no URL returned'}`)
    }

    return new Response(
      JSON.stringify({ signedUrl: data.signedUrl, expiresInSeconds: SIGNED_URL_TTL_SECONDS }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  } catch (err) {
    if (err instanceof EdgeFunctionError) return err.toResponse(req)
    console.warn('[create-order-document-url] unexpected error:', err)
    return errorResponse('INTERNAL', 'Unexpected error', undefined, 500, req)
  }
})
