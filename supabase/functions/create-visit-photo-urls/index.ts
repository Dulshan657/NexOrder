// create-visit-photo-urls Edge Function
//
// Returns short-lived signed URLs for the photographs on one or more visits,
// held in the private `visit-photos` bucket as of mig 00113.
//
// Authorization model (mirrors create-signature-url): the caller supplies VISIT
// IDS, never storage paths, and the visits are read with the CALLER's JWT so
// `visits` RLS is the authority. That matters here because the scope is real: a
// Field or Office Sales Rep sees only their own visits (00001:954
// visits_select_rep, `user_id = auth.uid()`), while Admin and Manager see all
// (00001:949). A visit the caller cannot see simply does not come back, and its
// photos are never signed.
//
// IT IS BATCHED, AND THE BATCH IS THE POINT. VisitTimeline and
// ScheduledVisitTrackingDetail render many visits at once, each with up to five
// photos. One call per URL would mean one audit_events row per thumbnail, which
// would bury the mutations that table exists for. One call, one audit event
// naming the visits — the same shape mutate-product-home-bin's bulkSet uses.
//
// NON-KEY VALUES ARE PASSED THROUGH, NOT DROPPED. `visits.photos` may still
// hold an absolute pre-00113 URL (a row written in the window between the
// frontend deploy and the migration, or restored from demo-export/), and
// classification lives in _shared/storageKey.ts so the client can render each
// element without knowing which shape it got.

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.103.0'
import { z } from 'https://esm.sh/zod@3.23.8'
import { requireAuth, type UserRole } from '../_shared/auth.ts'
import { EdgeFunctionError, errorResponse, isEdgeFunctionError } from '../_shared/errors.ts'
import { corsHeadersFor } from '../_shared/cors.ts'
import { checkRateLimit } from '../_shared/rateLimit.ts'
import { requireModule } from '../_shared/modules.ts'
import { logAuditEvent } from '../_shared/audit.ts'
import { toStorageRef } from '../_shared/storageKey.ts'

/** The four roles `visits` RLS lets read a visit at all (00001:949, :954). */
const ALLOWED: ReadonlyArray<UserRole> = ['Admin', 'Manager', 'Field Sales Rep', 'Office Sales Rep']

const BUCKET = 'visit-photos'
const SIGNED_URL_TTL_SECONDS = 5 * 60
/** A timeline page renders far fewer than this; the cap exists so one call
 *  cannot be turned into an unbounded signing job. */
const MAX_VISITS = 50

const inputSchema = z.object({
  visitIds: z.array(z.string().min(1).max(64)).min(1).max(MAX_VISITS),
})

interface PhotoOut {
  /** The value as stored, so the client can key its React list on it. */
  value: string
  /** Present only for a stored key that was signed. */
  signedUrl?: string
  /** 'key' was signed; 'inline'/'external' render as-is; 'empty' is skipped. */
  kind: 'key' | 'inline' | 'external'
}

serve(async (req: Request) => {
  const corsHeaders = corsHeadersFor(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') {
    return errorResponse('INVALID_INPUT', 'POST only', undefined, 405, req)
  }

  try {
    requireModule('field_ops')
    const auth = await requireAuth(req, { allowedRoles: ALLOWED })

    const rl = await checkRateLimit(`create-visit-photo-urls:${auth.userId}`, {
      windowMs: 60_000,
      max: 120,
    })
    if (!rl.ok) throw new EdgeFunctionError('TOO_MANY_REQUESTS', 'Too many signed-URL requests')

    const body = await req.json().catch(() => {
      throw new EdgeFunctionError('INVALID_INPUT', 'Request body must be valid JSON')
    })
    const parsed = inputSchema.safeParse(body)
    if (!parsed.success) {
      throw new EdgeFunctionError('INVALID_INPUT', `visitIds (1-${MAX_VISITS}) required`, parsed.error.flatten())
    }
    const { visitIds } = parsed.data

    const { data: visits, error: lookupError } = await auth.userClient
      .from('visits')
      .select('id, photos')
      .in('id', visitIds)
    if (lookupError) {
      throw new EdgeFunctionError('INTERNAL', `visits lookup: ${lookupError.message}`)
    }

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { persistSession: false } },
    )

    let signedCount = 0
    const out: Array<{ visitId: string; photos: PhotoOut[] }> = []

    for (const visit of (visits ?? []) as Array<{ id: string; photos: string[] | null }>) {
      const photos: PhotoOut[] = []
      for (const stored of visit.photos ?? []) {
        const ref = toStorageRef(BUCKET, stored)
        if (ref.kind === 'empty') continue
        if (ref.kind !== 'key') {
          photos.push({ value: stored, kind: ref.kind })
          continue
        }
        const { data: signed } = await admin.storage
          .from(BUCKET)
          .createSignedUrl(ref.key, SIGNED_URL_TTL_SECONDS)
        // A missing object is reported as an unsignable entry rather than
        // failing the whole batch: one deleted file must not blank a timeline.
        if (signed?.signedUrl) {
          signedCount++
          photos.push({ value: stored, signedUrl: signed.signedUrl, kind: 'key' })
        }
      }
      out.push({ visitId: visit.id, photos })
    }

    // One event per CALL. See the header.
    if (signedCount > 0) {
      await logAuditEvent(admin, {
        actorId: auth.userId,
        actorRole: auth.role,
        action: 'read',
        resource: 'visit_photos',
        resourceId: null,
        metadata: {
          bucket: BUCKET,
          visitIds: out.map((v) => v.visitId),
          signedCount,
          ttlSeconds: SIGNED_URL_TTL_SECONDS,
        },
      })
    }

    return new Response(
      JSON.stringify({ visits: out, expiresInSeconds: SIGNED_URL_TTL_SECONDS }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  } catch (e) {
    if (isEdgeFunctionError(e)) return e.toResponse(req)
    console.warn('[create-visit-photo-urls] unexpected error:', e)
    return errorResponse('INTERNAL', 'Unexpected error', undefined, 500, req)
  }
})
