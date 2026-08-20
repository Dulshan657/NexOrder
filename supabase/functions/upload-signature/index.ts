// upload-signature Edge Function
//
// Takes the PNG a rep captured on the order-verification canvas and puts it in
// the private `signatures` bucket as service_role, returning the bare storage
// key for OrderVerificationModal to hand to place-order.
//
// WHY THIS EXISTS. Until mig 00113 the browser uploaded straight into the
// bucket, because `auth_write_signatures` was `FOR ALL TO authenticated` on the
// bucket name alone (00004:57). That is security-audit finding STOR-1: the same
// policy that permitted the upload permitted any customer login to list() every
// signature path and remove() them. 00113 removes every client policy from this
// bucket, so this function is now the only way in.
//
// THE BYTES RIDE IN THE BODY, and that is a considered choice rather than the
// obvious one. `mutate-visit-photo` mints a signed UPLOAD url instead, because a
// visit photo is a phone-camera file up to the bucket's 10 MB cap. A signature
// is a canvas toDataURL('image/png') — a few tens of kB against a 2 MB bucket
// limit — so one round trip is cheaper than two, and having the bytes here is
// what lets this function verify they really are a PNG before anything is
// stored. Do not "simplify" the two into one shape; the sizes are what differ.
//
// THE PATH IS MINTED HERE, never supplied by the caller. That is the same
// argument create-po-document-url:10-15 makes about read paths, in the write
// direction: a caller-chosen path is a caller-chosen overwrite.
//
// NOT BOUND TO AN ORDER, deliberately, because it cannot be. The canvas is in
// the cart (components/OrderVerificationModal.tsx) and the order does not exist
// until place-order runs, several steps later. An abandoned cart therefore
// leaves an object no row references — 8 of the 16 objects in dev's bucket are
// exactly that, and they were orphans before this change too. Retention is
// Compliance/_src/08-data-retention-policy.md's problem, not this function's.

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.103.0'
import { z } from 'https://esm.sh/zod@3.23.8'
import { requireAuth, type UserRole } from '../_shared/auth.ts'
import { EdgeFunctionError, errorResponse, isEdgeFunctionError } from '../_shared/errors.ts'
import { corsHeadersFor } from '../_shared/cors.ts'
import { checkRateLimit } from '../_shared/rateLimit.ts'
import { requireModule } from '../_shared/modules.ts'
import { logAuditEvent } from '../_shared/audit.ts'

// Every role except `Restaurant/Hotel Customer`. A customer never sees this
// screen — context/OrderContext.tsx:315-319 skips verification entirely for
// them — so a customer calling this is not a legitimate path.
const ALLOWED: ReadonlyArray<UserRole> = [
  'Admin',
  'Manager',
  'Field Sales Rep',
  'Office Sales Rep',
  'Warehouse',
]

const BUCKET = 'signatures'
const PREFIX = 'orders'
/** The bucket's own file_size_limit (00004:11). Checked here so an oversized
 *  body is refused before it is decoded, not after Storage rejects it. */
const MAX_BYTES = 2 * 1024 * 1024
/** \x89 P N G \r \n \x1a \n — the PNG signature, RFC 2083 §3.1. */
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

const inputSchema = z.object({
  // Accepts either a bare base64 payload or the whole `data:image/png;base64,…`
  // string, because the caller has a canvas data URL in hand and making it
  // split that itself would be a second place to get the split wrong.
  pngBase64: z.string().min(1).max(4 * 1024 * 1024),
})

function decodePng(input: string): Uint8Array {
  const comma = input.indexOf(',')
  const payload = input.startsWith('data:') ? input.slice(comma + 1) : input
  if (input.startsWith('data:') && !/^data:image\/png;base64,/i.test(input)) {
    throw new EdgeFunctionError('INVALID_INPUT', 'Signature must be a PNG data URL')
  }

  let binary: string
  try {
    binary = atob(payload.trim())
  } catch {
    throw new EdgeFunctionError('INVALID_INPUT', 'Signature is not valid base64')
  }

  if (binary.length === 0) throw new EdgeFunctionError('INVALID_INPUT', 'Signature is empty')
  if (binary.length > MAX_BYTES) {
    throw new EdgeFunctionError('INVALID_INPUT', `Signature exceeds ${MAX_BYTES} bytes`)
  }

  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)

  // The bucket's allowed_mime_types would catch a non-PNG, but only by the
  // Content-Type we ourselves declare — which proves nothing about the bytes.
  // This checks the bytes.
  if (PNG_MAGIC.some((b, i) => bytes[i] !== b)) {
    throw new EdgeFunctionError('INVALID_INPUT', 'Signature is not a PNG')
  }
  return bytes
}

serve(async (req: Request) => {
  const corsHeaders = corsHeadersFor(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') {
    return errorResponse('INVALID_INPUT', 'POST only', undefined, 405, req)
  }

  try {
    requireModule('shop')
    const auth = await requireAuth(req, { allowedRoles: ALLOWED })

    const rl = await checkRateLimit(`upload-signature:${auth.userId}`, { windowMs: 60_000, max: 20 })
    if (!rl.ok) throw new EdgeFunctionError('TOO_MANY_REQUESTS', 'Too many signature uploads')

    const body = await req.json().catch(() => {
      throw new EdgeFunctionError('INVALID_INPUT', 'Request body must be valid JSON')
    })
    const parsed = inputSchema.safeParse(body)
    if (!parsed.success) {
      throw new EdgeFunctionError('INVALID_INPUT', 'pngBase64 required', parsed.error.flatten())
    }

    const bytes = decodePng(parsed.data.pngBase64)
    const key = `${PREFIX}/${crypto.randomUUID()}.png`

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { persistSession: false } },
    )

    const { error: upErr } = await admin.storage.from(BUCKET).upload(key, bytes, {
      contentType: 'image/png',
      // A fresh uuid cannot collide, so upsert would only ever mask a bug —
      // and an upsert on this bucket is precisely the overwrite STOR-1 allowed.
      upsert: false,
    })
    if (upErr) throw new EdgeFunctionError('INTERNAL', `signature upload: ${upErr.message}`)

    await logAuditEvent(admin, {
      actorId: auth.userId,
      actorRole: auth.role,
      action: 'create',
      resource: 'signature',
      resourceId: key,
      metadata: { bucket: BUCKET, bytes: bytes.length },
    })

    return new Response(JSON.stringify({ key, bucket: BUCKET }), {
      status: 201,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (e) {
    if (isEdgeFunctionError(e)) return e.toResponse(req)
    console.warn('[upload-signature] unexpected error:', e)
    return errorResponse('INTERNAL', 'Unexpected error', undefined, 500, req)
  }
})
