// extract-floorplan Edge Function
//
// Admin-only. Takes a floorplan_imports job (image already uploaded to the
// private floorplan-scans bucket), runs OpenAI vision over it, and returns a
// normalized DRAFT layout the client feeds into mutate-layout (create_layout +
// save_geometry). It never creates or publishes a layout itself — the human
// reviews and saves in the Layout Designer.

// deno-lint-ignore-file no-explicit-any
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.103.0'
import { z } from 'https://esm.sh/zod@3.23.8'
import { requireAuth, type UserRole } from '../_shared/auth.ts'
import { EdgeFunctionError, errorResponse, isEdgeFunctionError } from '../_shared/errors.ts'
import { corsHeadersFor } from '../_shared/cors.ts'
import { checkRateLimit } from '../_shared/rateLimit.ts'
import { extractStructured, type AuditWriter, type ChatMessage } from '../_shared/poInbox/openai.ts'
import { bytesToBase64 } from '../_shared/base64.ts'
import {
  FLOORPLAN_SCHEMA,
  FLOORPLAN_SYSTEM_PROMPT,
  normalizeFloorplan,
  type FloorplanExtraction,
} from '../_shared/floorplan/extractionSchema.ts'

const ALLOWED: ReadonlyArray<UserRole> = ['Admin']
const BUCKET = 'floorplan-scans'
const REVIEW_THRESHOLD = 0.7

const MIME_BY_EXT: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' }

const inputSchema = z.object({ importId: z.string().uuid() })

serve(async (req: Request) => {
  const corsHeaders = corsHeadersFor(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false },
  })
  let importId: string | null = null

  try {
    const auth = await requireAuth(req, { allowedRoles: ALLOWED })
    const rl = await checkRateLimit(`extract-floorplan:${auth.userId}`, { windowMs: 60_000, max: 5 })
    if (!rl.ok) throw new EdgeFunctionError('TOO_MANY_REQUESTS', 'Rate limit exceeded')

    const body = await req.json().catch(() => {
      throw new EdgeFunctionError('INVALID_INPUT', 'Request body must be valid JSON')
    })
    const parsed = inputSchema.safeParse(body)
    if (!parsed.success) throw new EdgeFunctionError('INVALID_INPUT', 'Invalid request body', parsed.error.flatten())
    importId = parsed.data.importId

    const { data: job, error: jobErr } = await admin.from('floorplan_imports')
      .select('id, warehouse_id, storage_path, status').eq('id', importId).single()
    if (jobErr || !job) throw new EdgeFunctionError('NOT_FOUND', 'Import not found')
    await admin.from('floorplan_imports').update({ status: 'processing', error_message: null } as any).eq('id', importId)

    const { data: wh, error: whErr } = await admin.from('locations')
      .select('id, code').eq('id', (job as any).warehouse_id).single()
    if (whErr || !wh) throw new EdgeFunctionError('INTERNAL', 'Could not load the import\'s warehouse')
    const warehouseCode = (wh as any).code as string

    // Download the uploaded image.
    const path = (job as any).storage_path as string
    const { data: blob, error: dlErr } = await admin.storage.from(BUCKET).download(path)
    if (dlErr || !blob) throw new EdgeFunctionError('NOT_FOUND', `Could not read the uploaded image: ${dlErr?.message ?? ''}`)
    const bytes = new Uint8Array(await blob.arrayBuffer())
    const ext = path.split('.').pop()?.toLowerCase() ?? 'png'
    const mime = MIME_BY_EXT[ext] ?? 'image/png'
    const dataUrl = `data:${mime};base64,${bytesToBase64(bytes)}`

    // Build catalogue lookups so racks/zones map onto real profiles + types.
    const { data: profiles } = await admin.from('zone_profiles').select('id, zone_type').eq('is_active', true)
    const zoneProfileByType: Record<string, number> = {}
    for (const p of (profiles ?? []) as any[]) {
      const key = String(p.zone_type).toLowerCase()
      if (!(key in zoneProfileByType)) zoneProfileByType[key] = p.id
    }
    const { data: stypes } = await admin.from('storage_types').select('id, code, name').eq('is_active', true)
    const storageTypeByToken: Record<string, number> = {}
    for (const s of (stypes ?? []) as any[]) {
      storageTypeByToken[String(s.name).toLowerCase()] = s.id
      storageTypeByToken[String(s.code).toLowerCase().replace(/_/g, ' ')] = s.id
    }

    const messages: ChatMessage[] = [
      { role: 'system', content: FLOORPLAN_SYSTEM_PROMPT },
      {
        role: 'user',
        content: [
          { type: 'text', text: 'The warehouse floor plan is the attached image. Extract the grid layout.' },
          { type: 'image_url', image_url: { url: dataUrl } },
        ],
      },
    ]

    const result = await extractStructured<FloorplanExtraction>({
      audit: admin as unknown as AuditWriter,
      inboundMessageId: null,
      edgeFunction: 'extract-floorplan',
      purpose: 'extract_floorplan',
      model: 'gpt-4o',
      messages,
      jsonSchema: { name: 'floorplan', schema: FLOORPLAN_SCHEMA, strict: true },
    })

    const draft = normalizeFloorplan(result.data, {
      warehouseId: (job as any).warehouse_id,
      warehouseCode,
      zoneProfileByType,
      storageTypeByToken,
    })

    const confidence = typeof result.data.confidence === 'number' ? result.data.confidence : 0
    const needsReview = confidence < REVIEW_THRESHOLD || draft.rackCount === 0

    await admin.from('floorplan_imports')
      .update({ status: 'succeeded', confidence, needs_review: needsReview } as any).eq('id', importId)

    return new Response(JSON.stringify({
      ok: true,
      importId,
      draft: {
        gridWidth: draft.gridWidth,
        gridHeight: draft.gridHeight,
        floors: draft.floors,
        placements: draft.placements,
        objects: draft.objects,
      },
      counts: { racks: draft.rackCount, objects: draft.objectCount, zones: draft.zoneCount },
      confidence,
      needsReview,
      notes: result.data.notes ?? '',
    }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Unknown error'
    if (importId) {
      await admin.from('floorplan_imports').update({ status: 'failed', error_message: message } as any).eq('id', importId)
    }
    if (isEdgeFunctionError(e)) return e.toResponse(req)
    return errorResponse('INTERNAL', message, undefined, undefined, req)
  }
})
