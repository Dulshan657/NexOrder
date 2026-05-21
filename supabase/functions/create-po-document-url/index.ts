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
  /** Resolve the attachment by its stored object name (e.g. "1-order.pdf").
   *  Preferred — points the viewer at the actual chosen PO document rather
   *  than a positional guess. */
  attachmentName?: string
  /** Legacy positional fallback when no attachmentName is supplied. */
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
    const rl = await checkRateLimit(`create-po-document-url:${ctx.userId}`, {
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
      const hasName = typeof body.attachmentName === 'string' && body.attachmentName.length > 0
      const hasIndex = Number.isInteger(body.attachmentIndex) && (body.attachmentIndex as number) >= 0
      if (!hasName && !hasIndex) {
        throw new EdgeFunctionError(
          'INVALID_INPUT',
          'attachmentName (string) or attachmentIndex (non-negative integer) required',
        )
      }
    }

    // Use the CALLER's JWT (not service role) for the authorization load so
    // RLS is the authority on which rows they can see. Admin/Manager SELECT
    // is the policy on pending_pos + inbound_messages.
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: req.headers.get('Authorization')! } },
      auth: { persistSession: false },
    })

    // Storage listing + signed-URL creation require service-role (storage
    // policies permit both only via service_role in our setup).
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const serviceClient = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false },
    })

    const path = await resolvePath(userClient, serviceClient, body)

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
  serviceClient: SupabaseClient,
  body: SignUrlRequest,
): Promise<string> {
  const { data, error } = await userClient
    .from('pending_pos')
    .select('id, inbound_messages:inbound_message_id(storage_path_prefix)')
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

  // Attachments: resolve by LISTING the prefix and picking by index rather
  // than reconstructing the filename. The write-time name went through
  // poll-inbox's attachmentPath sanitizer with an `{index}-` prefix, and
  // extract-po records that already-prefixed object name back into
  // extracted_po.source.original_filename — so any client-side or
  // reader-side filename reconstruction would mismatch (e.g. double the
  // `{index}-` prefix). Listing the bucket is ground truth and mirrors how
  // extract-po itself selects the primary document.
  const { data: listing, error: listError } = await serviceClient.storage
    .from(ARCHIVE_BUCKET)
    .list(inBucketPrefix)
  if (listError) {
    throw new EdgeFunctionError('INTERNAL', `storage list: ${listError.message}`)
  }
  const attachments = (listing ?? [])
    .filter(entry => entry.name && entry.name !== 'original.json')
    .sort((a, b) => a.name.localeCompare(b.name))

  // Preferred: resolve by exact stored name (bound to this row's prefix, so
  // still no arbitrary-path access). Falls back to positional index.
  if (typeof body.attachmentName === 'string' && body.attachmentName.length > 0) {
    const match = attachments.find(entry => entry.name === body.attachmentName)
    if (!match) {
      throw new EdgeFunctionError('NOT_FOUND', `no attachment named ${body.attachmentName}`)
    }
    return `${inBucketPrefix}/${match.name}`
  }

  const entry = attachments[body.attachmentIndex as number]
  if (!entry) {
    throw new EdgeFunctionError('NOT_FOUND', `no attachment at index ${body.attachmentIndex}`)
  }
  return `${inBucketPrefix}/${entry.name}`
}
