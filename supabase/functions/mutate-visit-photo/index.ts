// mutate-visit-photo Edge Function
//
// The write half of the private `visit-photos` bucket (mig 00113). Two actions:
//
//   { action: 'upload', mimeType }  → mints a path and returns a signed UPLOAD
//                                     url; the client PUTs the bytes to it.
//   { action: 'delete', key }       → removes one object as service_role.
//
// THE BYTES DO NOT RIDE IN THE BODY, unlike upload-signature. A visit photo
// comes from `capture="environment"` with `multiple` and no compression
// (components/visits/PhotoUpload.tsx:91-99), so it is a phone-camera file up to
// the bucket's 10 MB cap, and up to five at once. Base64 through a function
// would be ~13 MB per file held in the isolate. A signed upload URL costs one
// extra round trip and moves the bytes straight to Storage — the same shape
// create-floorplan-upload-url uses, for the same reason.
//
// THE PATH IS MINTED HERE. The signed upload URL is bound to that one path, so
// the client cannot choose where the object lands, cannot overwrite a
// neighbouring object, and cannot write outside the bucket. That is the whole
// security content of the upload branch.
//
// AUTHORIZING A DELETE IS THE INTERESTING PART, because at the moment the rep
// removes a photo there may be no visit to authorize against. PhotoUpload
// deletes from the WORKING SET, before VisitModal saves anything, so an object
// can be unattached and legitimately deletable. The rule is therefore:
//
//   * if NO visits row references the key, it is an unsaved upload — any role
//     that may create a visit may delete it;
//   * if some row references it, the caller must be able to SEE that row with
//     their own JWT. For a rep that means their own visit (00001:954), and
//     `visits_update_own_or_admin_manager` (00001:969) grants update to exactly
//     the same set, so visibility is a sound proxy for "may edit this".
//
// That closes the real hole `auth_write_visit_photos` left: under STOR-1 any
// authenticated login — including a customer — could delete any rep's
// photographs. Reachability of that hole is what this replaces, not merely the
// policy.
//
// The existence check runs as service_role on purpose. Asking only with the
// caller's JWT cannot tell "no row references this" apart from "a row does, and
// you may not see it", and those two must not both mean yes.

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.103.0'
import { z } from 'https://esm.sh/zod@3.23.8'
import { requireAuth, type UserRole } from '../_shared/auth.ts'
import { EdgeFunctionError, errorResponse, isEdgeFunctionError } from '../_shared/errors.ts'
import { corsHeadersFor } from '../_shared/cors.ts'
import { checkRateLimit } from '../_shared/rateLimit.ts'
import { requireModule } from '../_shared/modules.ts'
import { logAuditEvent } from '../_shared/audit.ts'
import { isSafeStorageKey, toStorageRef } from '../_shared/storageKey.ts'

/** The four roles `visits_insert_staff` permits (00001:962). */
const ALLOWED: ReadonlyArray<UserRole> = ['Admin', 'Manager', 'Field Sales Rep', 'Office Sales Rep']

const BUCKET = 'visit-photos'
const PREFIX = 'visits'

/** The bucket's allowed_mime_types (00004:9). */
const EXT_BY_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
}

const inputSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('upload'),
    mimeType: z.enum(['image/png', 'image/jpeg', 'image/webp']),
  }),
  z.object({
    action: z.literal('delete'),
    // Accepts a bare key or a legacy absolute URL — a photo added before 00113
    // is still removable from the same UI. Normalised below.
    key: z.string().min(1).max(2048),
  }),
])

serve(async (req: Request) => {
  const corsHeaders = corsHeadersFor(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') {
    return errorResponse('INVALID_INPUT', 'POST only', undefined, 405, req)
  }

  try {
    requireModule('field_ops')
    const auth = await requireAuth(req, { allowedRoles: ALLOWED })

    const rl = await checkRateLimit(`mutate-visit-photo:${auth.userId}`, { windowMs: 60_000, max: 30 })
    if (!rl.ok) throw new EdgeFunctionError('TOO_MANY_REQUESTS', 'Too many photo operations')

    const body = await req.json().catch(() => {
      throw new EdgeFunctionError('INVALID_INPUT', 'Request body must be valid JSON')
    })
    const parsed = inputSchema.safeParse(body)
    if (!parsed.success) {
      throw new EdgeFunctionError('INVALID_INPUT', 'Invalid request body', parsed.error.flatten())
    }
    const input = parsed.data

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { persistSession: false } },
    )

    // ── upload: mint a path and a one-shot signed upload URL ────────────────
    if (input.action === 'upload') {
      const key = `${PREFIX}/${crypto.randomUUID()}.${EXT_BY_MIME[input.mimeType]}`
      const { data: signed, error: signErr } = await admin.storage
        .from(BUCKET)
        .createSignedUploadUrl(key)
      if (signErr || !signed) {
        throw new EdgeFunctionError('INTERNAL', `upload URL: ${signErr?.message ?? 'none'}`)
      }

      await logAuditEvent(admin, {
        actorId: auth.userId,
        actorRole: auth.role,
        action: 'create',
        resource: 'visit_photo',
        resourceId: key,
        metadata: { bucket: BUCKET, mimeType: input.mimeType },
      })

      return new Response(JSON.stringify({ key, path: key, token: signed.token, bucket: BUCKET }), {
        status: 201,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // ── delete ──────────────────────────────────────────────────────────────
    const ref = toStorageRef(BUCKET, input.key)
    if (ref.kind !== 'key' || !isSafeStorageKey(ref.key)) {
      throw new EdgeFunctionError('INVALID_INPUT', 'Not a visit-photo object')
    }

    // Match on the stored value as given, since a row written before 00113
    // holds the absolute URL and a row written after holds the key.
    const candidates = Array.from(new Set([input.key, ref.key]))

    const { data: refsAll, error: refErr } = await admin
      .from('visits')
      .select('id')
      .overlaps('photos', candidates)
    if (refErr) throw new EdgeFunctionError('INTERNAL', `visits lookup: ${refErr.message}`)

    if ((refsAll ?? []).length > 0) {
      const { data: refsVisible, error: visErr } = await auth.userClient
        .from('visits')
        .select('id')
        .overlaps('photos', candidates)
      if (visErr) throw new EdgeFunctionError('INTERNAL', `visits lookup: ${visErr.message}`)
      if ((refsVisible ?? []).length === 0) {
        throw new EdgeFunctionError('FORBIDDEN', 'This photo belongs to a visit you cannot edit')
      }
    }

    const { error: rmErr } = await admin.storage.from(BUCKET).remove([ref.key])
    if (rmErr) throw new EdgeFunctionError('INTERNAL', `photo delete: ${rmErr.message}`)

    await logAuditEvent(admin, {
      actorId: auth.userId,
      actorRole: auth.role,
      action: 'delete',
      resource: 'visit_photo',
      resourceId: ref.key,
      metadata: {
        bucket: BUCKET,
        attachedToVisits: (refsAll ?? []).map((r) => (r as { id: string }).id),
      },
    })

    return new Response(JSON.stringify({ ok: true, key: ref.key }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (e) {
    if (isEdgeFunctionError(e)) return e.toResponse(req)
    console.warn('[mutate-visit-photo] unexpected error:', e)
    return errorResponse('INTERNAL', 'Unexpected error', undefined, 500, req)
  }
})
