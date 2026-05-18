// create-po-document-url Edge Function
//
// Returns a short-lived signed URL for an object in the private
// po-archive Storage bucket. Used by the PO Inbox UI's document viewer
// so an Admin/Manager can preview the original PDF/image without
// exposing the bucket to anonymous reads.
//
// Authorization model:
//   1. requireAuth restricts callers to Admin/Manager roles.
//   2. The caller must specify a pendingPoId, not a raw storage path.
//      The function loads pending_pos via the caller's JWT (respects
//      RLS — Admin/Manager only) and derives the legal storage prefix
//      from inbound_messages.storage_path_prefix. This binds the
//      signed URL to a row the caller can already see, eliminating
//      the "supply an arbitrary path" attack surface.
//   3. The caller may request either:
//        kind='original'             → /original.json
//        kind='attachment', index=N → /{N}-{filename-from-extracted_po}
//
// The TTL is short (5 minutes) — long enough for the operator to scroll
// through a PDF, short enough to bound the replay window if the URL is
// ever captured in a proxy log or browser history.

// deno-lint-ignore-file no-explicit-any
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.103.0'
import { corsHeadersFor } from '../_shared/cors.ts'
import { EdgeFunctionError, errorResponse } from '../_shared/errors.ts'
import { requireAuth } from '../_shared/auth.ts'
import { checkRateLimit } from '../_shared/rateLimit.ts'

interface SignUrlRequest {
  pendingPoId: string
  kind: 'original' | 'attachment'
  /** Required when kind='attachment'. */
  attachmentIndex?: number
}

const ARCHIVE_BUCKET = 'po-archive'
const SIGNED_URL_TTL_SECONDS = 5 * 60

serve(async (req: Request) => {
  const corsHeaders = corsHeadersFor(req)
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })
  if (req.method !== 'POST') {
    return errorResponse('INVALID_INPUT', 'POST only', undefined, 405, req)
  }

  try {
    const ctx = await requireAuth(req, { allowedRoles: ['Admin', 'Manager'] })
    const rl = checkRateLimit(`create-po-document-url:${ctx.userId}`, {
      windowMs: 60_000,
      max: 120,
    })
    if (!rl.ok) {
      return errorResponse('TOO_MANY_REQUESTS', 'Too many signed-URL requests', undefined, 429, req)
    }

    let body: SignUrlRequest
    try {
      body = await req.json()
    } catch {
      throw new EdgeFunctionError('INVALID_INPUT', 'Body must be JSON')
    }
    if (!body.pendingPoId || typeof body.pendingPoId !== 'string') {
      throw new EdgeFunctionError('INVALID_INPUT', 'pendingPoId required')
    }
    if (body.kind !== 'original' && body.kind !== 'attachment') {
      throw new EdgeFunctionError('INVALID_INPUT', "kind must be 'original' or 'attachment'")
    }
    if (body.kind === 'attachment') {
      if (!Number.isInteger(body.attachmentIndex) || (body.attachmentIndex as number) < 0) {
        throw new EdgeFunctionError('INVALID_INPUT', 'attachmentIndex (non-negative integer) required')
      }
    }

    // Use the CALLER's JWT (not service role) for the load so RLS is the
    // authority on which rows they can see. Admin/Manager SELECT is the
    // policy on pending_pos + inbound_messages.
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: req.headers.get('Authorization')! } },
      auth: { persistSession: false },
    })

    const path = await resolvePath(userClient, body)

    // Storage signed-URL creation requires service-role (storage policies
    // permit signed-URL issuance only via service_role in our setup).
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const serviceClient = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false },
    })
    const { data, error } = await serviceClient.storage
      .from(ARCHIVE_BUCKET)
      .createSignedUrl(path, SIGNED_URL_TTL_SECONDS)
    if (error || !data?.signedUrl) {
      throw new EdgeFunctionError('NOT_FOUND', `signed URL: ${error?.message ?? 'no URL returned'}`)
    }

    return new Response(
      JSON.stringify({
        signedUrl: data.signedUrl,
        expiresInSeconds: SIGNED_URL_TTL_SECONDS,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  } catch (err) {
    if (err instanceof EdgeFunctionError) return err.toResponse(req)
    console.warn('[create-po-document-url] unexpected error:', err)
    return errorResponse('INTERNAL', 'Unexpected error', undefined, 500, req)
  }
})

async function resolvePath(
  userClient: SupabaseClient,
  body: SignUrlRequest,
): Promise<string> {
  const { data, error } = await userClient
    .from('pending_pos')
    .select('id, inbound_messages:inbound_message_id(storage_path_prefix), extracted_po')
    .eq('id', body.pendingPoId)
    .maybeSingle()
  if (error) {
    throw new EdgeFunctionError('INTERNAL', `pending_pos lookup: ${error.message}`)
  }
  if (!data) {
    // RLS will return zero rows if the caller can't see this pending_po,
    // so a missing row is indistinguishable from a forbidden one.
    throw new EdgeFunctionError('NOT_FOUND', 'pending_pos not found or not visible')
  }
  // Cast: the joined inbound_messages comes back as an object in newer
  // PostgREST shapes and an array of one in older ones.
  const row = data as {
    inbound_messages: { storage_path_prefix: string } | Array<{ storage_path_prefix: string }>
    extracted_po: { source?: { original_filename?: string | null } } | null
  }
  const joined = Array.isArray(row.inbound_messages)
    ? row.inbound_messages[0]
    : row.inbound_messages
  const storagePathPrefix = joined?.storage_path_prefix
  if (!storagePathPrefix) {
    throw new EdgeFunctionError('NOT_FOUND', 'inbound message has no storage prefix')
  }
  // storage_path_prefix is stored as "po-archive/{accountId}/{messageId}";
  // strip the bucket name so we have an in-bucket path.
  const inBucketPrefix = storagePathPrefix.replace(/^po-archive\//, '')

  if (body.kind === 'original') {
    return `${inBucketPrefix}/original.json`
  }

  const filename = sanitizeFilename(
    row.extracted_po?.source?.original_filename ?? `attachment-${body.attachmentIndex}`,
  )
  return `${inBucketPrefix}/${body.attachmentIndex}-${filename}`
}

function sanitizeFilename(filename: string): string {
  // Mirror poll-inbox's attachmentPath helper so the resolved storage
  // key matches the one used at write time. Strip control chars,
  // path separators, and parent-dir traversals.
  return filename
    .replace(/\\/g, '/')
    .replace(/\.\.+/g, '_')
    .replace(new RegExp('[/\\u0000-\\u001F\\u007F]', 'g'), '_')
    .replace(/^\.+/, '_')
    .slice(0, 200)
    .trim() || 'attachment'
}
