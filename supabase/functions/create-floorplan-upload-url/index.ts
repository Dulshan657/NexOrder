// create-floorplan-upload-url Edge Function
//
// Admin-only. Three modes:
//   { warehouseId, mimeType }     → creates a floorplan_imports job row and
//                                   returns a signed UPLOAD url for the
//                                   private floorplan-scans bucket (client
//                                   PUTs the image).
//   { importId, kind:'preview' }   → short-lived signed READ url for the modal.
//   { importId, kind:'reconcile' } → signed UPLOAD url (same shape as the
//                                    warehouseId branch) at a deterministic
//                                    path, for the client-rendered draft image
//                                    used by extract-floorplan's reconcile pass.
//
// The bucket is private; all access is via these service-role signed URLs.

// deno-lint-ignore-file no-explicit-any
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.103.0'
import { z } from 'https://esm.sh/zod@3.23.8'
import { requireAuth, type UserRole } from '../_shared/auth.ts'
import { EdgeFunctionError, errorResponse, isEdgeFunctionError } from '../_shared/errors.ts'
import { corsHeadersFor } from '../_shared/cors.ts'
import { checkRateLimit } from '../_shared/rateLimit.ts'

const ALLOWED: ReadonlyArray<UserRole> = ['Admin']
const BUCKET = 'floorplan-scans'
const READ_TTL_SECONDS = 5 * 60

const EXT_BY_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
}

const inputSchema = z.union([
  z.object({ warehouseId: z.number().int().positive(), mimeType: z.enum(['image/png', 'image/jpeg', 'image/webp']) }),
  z.object({ importId: z.string().uuid(), kind: z.literal('preview') }),
  z.object({ importId: z.string().uuid(), kind: z.literal('reconcile') }),
])

serve(async (req: Request) => {
  const corsHeaders = corsHeadersFor(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const auth = await requireAuth(req, { allowedRoles: ALLOWED })
    const rl = await checkRateLimit(`create-floorplan-upload-url:${auth.userId}`, { windowMs: 60_000, max: 60 })
    if (!rl.ok) throw new EdgeFunctionError('TOO_MANY_REQUESTS', 'Rate limit exceeded')

    const body = await req.json().catch(() => {
      throw new EdgeFunctionError('INVALID_INPUT', 'Request body must be valid JSON')
    })
    const parsed = inputSchema.safeParse(body)
    if (!parsed.success) throw new EdgeFunctionError('INVALID_INPUT', 'Invalid request body', parsed.error.flatten())
    const input = parsed.data

    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
      auth: { persistSession: false },
    })

    // ── preview: signed read URL for an existing import ──────────────────────
    if ('importId' in input && input.kind === 'preview') {
      const { data: row, error } = await admin.from('floorplan_imports')
        .select('storage_path').eq('id', input.importId).single()
      if (error || !row) throw new EdgeFunctionError('NOT_FOUND', 'Import not found')
      const { data: signed, error: sErr } = await admin.storage
        .from(BUCKET).createSignedUrl((row as any).storage_path, READ_TTL_SECONDS)
      if (sErr || !signed?.signedUrl) throw new EdgeFunctionError('NOT_FOUND', `signed URL: ${sErr?.message ?? 'none'}`)
      return new Response(JSON.stringify({ signedUrl: signed.signedUrl, expiresInSeconds: READ_TTL_SECONDS }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // ── reconcile: signed UPLOAD url for the client-rendered draft, at a
    // deterministic path mirroring the new-import convention below (same
    // bucket, `<warehouseId>/<importId>-reconcile.webp`). Response shape
    // mirrors the new-import branch (signed upload URL + storage path), NOT
    // the preview branch (signed read URL) — the client PUTs a render here,
    // it doesn't read one back. ──────────────────────────────────────────────
    if ('importId' in input && input.kind === 'reconcile') {
      const { data: row, error } = await admin.from('floorplan_imports')
        .select('warehouse_id').eq('id', input.importId).single()
      if (error || !row) throw new EdgeFunctionError('NOT_FOUND', 'Import not found')
      const warehouseId = (row as any).warehouse_id as number
      const path = `${warehouseId}/${input.importId}-reconcile.webp`
      const { data: signed, error: sErr } = await admin.storage.from(BUCKET).createSignedUploadUrl(path)
      if (sErr || !signed) throw new EdgeFunctionError('INTERNAL', `upload URL: ${sErr?.message ?? 'none'}`)
      return new Response(JSON.stringify({ importId: input.importId, path, token: signed.token, bucket: BUCKET }), {
        status: 201, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // ── new import: create the row + a signed upload URL ─────────────────────
    // Confirm the warehouse exists (and is a WAREHOUSE-kind location).
    const { data: wh, error: whErr } = await admin.from('locations')
      .select('id, kind').eq('id', input.warehouseId).single()
    if (whErr || !wh || (wh as any).kind !== 'WAREHOUSE') {
      throw new EdgeFunctionError('INVALID_INPUT', `Warehouse ${input.warehouseId} not found`)
    }

    const ext = EXT_BY_MIME[input.mimeType]
    const { data: created, error: insErr } = await admin.from('floorplan_imports')
      .insert({ warehouse_id: input.warehouseId, storage_path: 'pending', status: 'queued', created_by: auth.userId } as any)
      .select('id').single()
    if (insErr || !created) throw new EdgeFunctionError('INTERNAL', insErr?.message ?? 'Failed to create import')

    const importId = (created as any).id as string
    const path = `${input.warehouseId}/${importId}.${ext}`
    await admin.from('floorplan_imports').update({ storage_path: path } as any).eq('id', importId)

    const { data: signed, error: sErr } = await admin.storage.from(BUCKET).createSignedUploadUrl(path)
    if (sErr || !signed) throw new EdgeFunctionError('INTERNAL', `upload URL: ${sErr?.message ?? 'none'}`)

    return new Response(JSON.stringify({ importId, path, token: signed.token, bucket: BUCKET }), {
      status: 201, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (e) {
    if (isEdgeFunctionError(e)) return e.toResponse(req)
    return errorResponse('INTERNAL', e instanceof Error ? e.message : 'Unknown error', undefined, undefined, req)
  }
})
