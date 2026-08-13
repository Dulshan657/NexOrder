// extract-floorplan Edge Function
//
// Admin-only. Takes a floorplan_imports job (image already uploaded to the
// private floorplan-scans bucket), runs OpenAI vision over it, and returns a
// normalized DRAFT layout the client feeds into mutate-layout (create_layout +
// save_geometry). It never creates or publishes a layout itself — the human
// reviews and saves in the Layout Designer.
//
// v2.1 spatial-accuracy modes (additive, backward compatible):
//   - `gridWidth`/`gridHeight` (optional): client-computed aspect-fit grid
//     dims (see lib/floorplanGridOverlay.ts computeGridDims). When both are
//     present every pass's prompt PINS the grid instead of letting the model
//     choose it freely. Absent → old-client free-choice behavior.
//   - `reconcile` (optional): a follow-up correction pass. The client renders
//     the previously-returned draft back onto the same labeled grid, uploads
//     it, and calls back with `{ renderPath, extraction }` (the raw extraction
//     it received). This function downloads both the original scan and the
//     rendered draft, shows the model both plus the extraction JSON, and asks
//     for a corrected extraction — adopted only if its confidence isn't
//     meaningfully worse than the echoed one (see ADOPT_CONFIDENCE_SLACK).

// deno-lint-ignore-file no-explicit-any
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.103.0'
import { z } from 'https://esm.sh/zod@3.23.8'
import { requireAuth, type UserRole } from '../_shared/auth.ts'
import { EdgeFunctionError, errorResponse, isEdgeFunctionError } from '../_shared/errors.ts'
import { corsHeadersFor } from '../_shared/cors.ts'
import { checkRateLimit } from '../_shared/rateLimit.ts'
import { extractStructured, type AuditWriter } from '../_shared/poInbox/openai.ts'
import { bytesToBase64 } from '../_shared/base64.ts'
import {
  FLOORPLAN_SCHEMA,
  MAX_GRID_WIDTH,
  MAX_GRID_HEIGHT,
  buildFloorplanSystemPrompt,
  buildFloorplanStructurePrompt,
  floorplanDetailPrompt,
  floorplanReconcilePrompt,
  normalizeFloorplan,
  type FloorplanExtraction,
  type FloorplanObject,
  type NormalizedObject,
  type PinnedGridDims,
} from '../_shared/floorplan/extractionSchema.ts'
import { mergeExtractions, type FidelityMode } from '../_shared/floorplan/multiPass.ts'
import { autoConnectLayout, type ConnectObject, type ConnectPlacement } from '../_shared/wie/autoConnect.ts'
import { requireModule } from '../_shared/modules.ts'

const ALLOWED: ReadonlyArray<UserRole> = ['Admin']
const BUCKET = 'floorplan-scans'
const REVIEW_THRESHOLD = 0.7

// A corrected reconcile pass is adopted even if it self-rates its confidence
// up to 0.15 lower than the echoed (pre-reconcile) extraction — a slightly
// humbler self-assessment on the corrected pass shouldn't discard a draft
// that's genuinely more accurate. Below that slack, keep the echoed draft.
const ADOPT_CONFIDENCE_SLACK = 0.15

const MIME_BY_EXT: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' }

const reconcileSchema = z.object({
  renderPath: z.string().min(1),
  // Leniently validated — the normalizer already clamps/defends against a
  // malformed or partial extraction, so this only needs to be *an object*,
  // not a fully-typed FloorplanExtraction.
  extraction: z.record(z.unknown()),
})

const inputSchema = z.object({
  importId: z.string().uuid(),
  fidelity: z.enum(['standard', 'high']).default('standard'),
  gridWidth: z.number().int().optional(),
  gridHeight: z.number().int().optional(),
  reconcile: reconcileSchema.optional(),
})

/** Compact text summary of pass-1's fixed wall/conveyor cells, handed to pass
 *  2 in the user message so the detail pass doesn't place a rackRow/palletArea
 *  on top of them (normalizeFloorplan's blockedCellKeys would drop it anyway,
 *  but steering the model away from the conflict in the first place gives a
 *  better draft). Capped so the prompt can't blow out on a very busy plan. */
const STRUCTURE_SUMMARY_MAX_LINES = 200
function summarizeFixedStructure(objects: FloorplanObject[]): string {
  const fixed = objects.filter((o) => o.type === 'wall' || o.type === 'conveyor')
  if (fixed.length === 0) return 'No fixed structure detected in pass 1.'
  const lines = fixed
    .slice(0, STRUCTURE_SUMMARY_MAX_LINES)
    .map((o) => `${o.type} floor=${o.floor} x=${o.x} y=${o.y} w=${o.w} h=${o.h}`)
  const truncated = fixed.length > STRUCTURE_SUMMARY_MAX_LINES ? ` (+${fixed.length - STRUCTURE_SUMMARY_MAX_LINES} more)` : ''
  return `Fixed structure occupies these cells — do not place a rackRow or palletArea there:\n${lines.join('\n')}${truncated}`
}

/** Clamp an unknown/possibly-invalid dimension value into [lo, hi], falling
 *  back to `lo` when it isn't a finite number. Used both for the client's
 *  optional gridWidth/gridHeight and for the echoed extraction's dims in the
 *  reconcile branch (which arrive as `unknown` via z.record). */
function clampGridDim(v: unknown, lo: number, hi: number): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : lo
  return Math.max(lo, Math.min(hi, Math.round(n)))
}

// The reconcile round trip echoes back whatever extraction this function
// itself returned on the prior pass, but nothing server-side enforces that a
// client actually does so faithfully — a modified or replayed client could
// inflate it before echoing it back. Cap each array to what the extractor
// could legitimately produce (mirrors FLOORPLAN_SCHEMA's own bounds) before
// it's re-embedded in the reconcile prompt or handed to normalizeFloorplan.
const RECONCILE_MAX_JSON_LENGTH = 200_000
const RECONCILE_ARRAY_CAPS: Record<string, number> = {
  objects: 500,
  zones: 100,
  rackRows: 300,
  palletAreas: 100,
  racks: 2000,
}

/** Defensively cap the echoed `reconcile.extraction` before use: reject
 *  outright if the whole payload is implausibly large, then truncate any
 *  array field beyond what a real extraction could contain. */
function sanitizeEchoedExtraction(extraction: Record<string, unknown>): Record<string, unknown> {
  if (JSON.stringify(extraction).length > RECONCILE_MAX_JSON_LENGTH) {
    throw new EdgeFunctionError('INVALID_INPUT', 'reconcile.extraction exceeds the maximum allowed size')
  }
  const sanitized: Record<string, unknown> = { ...extraction }
  for (const [key, cap] of Object.entries(RECONCILE_ARRAY_CAPS)) {
    const value = sanitized[key]
    if (Array.isArray(value) && value.length > cap) sanitized[key] = value.slice(0, cap)
  }
  return sanitized
}

serve(async (req: Request) => {
  const corsHeaders = corsHeadersFor(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false },
  })
  let importId: string | null = null

  try {
    requireModule('inventory_dispatch')
    const auth = await requireAuth(req, { allowedRoles: ALLOWED })
    const rl = await checkRateLimit(`extract-floorplan:${auth.userId}`, { windowMs: 60_000, max: 5 })
    if (!rl.ok) throw new EdgeFunctionError('TOO_MANY_REQUESTS', 'Rate limit exceeded')

    const body = await req.json().catch(() => {
      throw new EdgeFunctionError('INVALID_INPUT', 'Request body must be valid JSON')
    })
    const parsed = inputSchema.safeParse(body)
    if (!parsed.success) throw new EdgeFunctionError('INVALID_INPUT', 'Invalid request body', parsed.error.flatten())
    importId = parsed.data.importId
    const fidelity: FidelityMode = parsed.data.fidelity

    // Client-computed aspect-fit grid, clamped, pinned into every prompt when
    // both dims are present. Absent (old client) → free-choice prompts.
    const pinned: PinnedGridDims | undefined =
      parsed.data.gridWidth !== undefined && parsed.data.gridHeight !== undefined
        ? {
            width: clampGridDim(parsed.data.gridWidth, 10, MAX_GRID_WIDTH),
            height: clampGridDim(parsed.data.gridHeight, 10, MAX_GRID_HEIGHT),
          }
        : undefined

    const { data: job, error: jobErr } = await admin.from('floorplan_imports')
      .select('id, warehouse_id, storage_path, status').eq('id', importId).single()
    if (jobErr || !job) throw new EdgeFunctionError('NOT_FOUND', 'Import not found')
    await admin.from('floorplan_imports').update({ status: 'processing', error_message: null } as any).eq('id', importId)

    const { data: wh, error: whErr } = await admin.from('locations')
      .select('id, code').eq('id', (job as any).warehouse_id).single()
    if (whErr || !wh) throw new EdgeFunctionError('INTERNAL', 'Could not load the import\'s warehouse')
    const warehouseCode = (wh as any).code as string

    // Download the uploaded (source) image — needed in every mode, including
    // reconcile (it's "image 1" there).
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

    const runPass = (systemPrompt: string, userText: string) =>
      extractStructured<FloorplanExtraction>({
        audit: admin as unknown as AuditWriter,
        inboundMessageId: null,
        edgeFunction: 'extract-floorplan',
        // Reused for every pass (standard, structure, detail, reconcile) so
        // all rows land in the same audit bucket — cheap to tell apart later
        // via model/latency, and it keeps the audit schema untouched.
        purpose: 'extract_floorplan',
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: systemPrompt },
          {
            role: 'user',
            content: [
              { type: 'text', text: userText },
              { type: 'image_url', image_url: { url: dataUrl, detail: 'high' } },
            ],
          },
        ],
        jsonSchema: { name: 'floorplan', schema: FLOORPLAN_SCHEMA, strict: true },
      })

    let extraction: FloorplanExtraction
    let combinedConfidence: number

    if (parsed.data.reconcile) {
      // ── Reconcile pass: show the model the source scan (image 1) + a
      // client-rendered draft on the same labeled grid (image 2) + the
      // extraction JSON it produced, and ask for the corrected full extraction.
      const { renderPath, extraction: echoedRaw } = parsed.data.reconcile
      const sanitizedEchoedRaw = sanitizeEchoedExtraction(echoedRaw)
      const echoed = sanitizedEchoedRaw as unknown as FloorplanExtraction

      // Derive the render's storage path server-side rather than trusting the
      // client-supplied `renderPath` verbatim into `storage.download` — this
      // must match create-floorplan-upload-url's `kind:'reconcile'` branch
      // exactly (`${warehouseId}/${importId}-reconcile.webp`). `renderPath`
      // stays in the schema for contract compat; a mismatch is logged but the
      // derived path is what's actually read.
      const expectedRenderPath = `${(job as any).warehouse_id}/${importId}-reconcile.webp`
      if (renderPath !== expectedRenderPath) {
        console.warn(`extract-floorplan: reconcile.renderPath mismatch (client="${renderPath}", using="${expectedRenderPath}")`)
      }

      const { data: renderBlob, error: renderErr } = await admin.storage.from(BUCKET).download(expectedRenderPath)
      if (renderErr || !renderBlob) {
        throw new EdgeFunctionError('NOT_FOUND', `Could not read the reconcile render: ${renderErr?.message ?? ''}`)
      }
      const renderBytes = new Uint8Array(await renderBlob.arrayBuffer())
      const renderExt = expectedRenderPath.split('.').pop()?.toLowerCase() ?? 'webp'
      const renderMime = MIME_BY_EXT[renderExt] ?? 'image/webp'
      const renderDataUrl = `data:${renderMime};base64,${bytesToBase64(renderBytes)}`

      const gw = clampGridDim(echoed?.gridWidth, 10, MAX_GRID_WIDTH)
      const gh = clampGridDim(echoed?.gridHeight, 10, MAX_GRID_HEIGHT)

      const correctedResult = await extractStructured<FloorplanExtraction>({
        audit: admin as unknown as AuditWriter,
        inboundMessageId: null,
        edgeFunction: 'extract-floorplan',
        purpose: 'extract_floorplan',
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: floorplanReconcilePrompt(gw, gh) },
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: `Source plan is image 1; current draft render is image 2. Current extraction JSON:\n${JSON.stringify(sanitizedEchoedRaw)}`,
              },
              { type: 'image_url', image_url: { url: dataUrl, detail: 'high' } },
              { type: 'image_url', image_url: { url: renderDataUrl, detail: 'high' } },
            ],
          },
        ],
        jsonSchema: { name: 'floorplan', schema: FLOORPLAN_SCHEMA, strict: true },
      })

      const echoedConfidence = typeof echoed?.confidence === 'number' ? echoed.confidence : 0
      const correctedConfidence = typeof correctedResult.data.confidence === 'number' ? correctedResult.data.confidence : 0

      if (correctedConfidence >= echoedConfidence - ADOPT_CONFIDENCE_SLACK) {
        extraction = correctedResult.data
        combinedConfidence = correctedConfidence
      } else {
        extraction = echoed
        combinedConfidence = echoedConfidence
      }
    } else if (fidelity === 'high') {
      // High fidelity runs two SEQUENTIAL gpt-4o vision calls (structure, then
      // detail) — call it ~2x the latency and cost of standard, run serially
      // because pass 2 needs pass 1's pinned grid dimensions. This is a real
      // wall-clock risk on Edge Functions' request timeout; if that becomes a
      // problem in practice, split this into two client-initiated requests
      // (persist pass 1 on floorplan_imports, let the client kick off pass 2)
      // rather than raising the function timeout.
      const structureResult = await runPass(
        buildFloorplanStructurePrompt(pinned),
        'The warehouse floor plan is the attached image. Extract the fixed structure (pass 1 of 2).',
      )
      const structureConfidence = typeof structureResult.data.confidence === 'number' ? structureResult.data.confidence : 0
      const detailResult = await runPass(
        floorplanDetailPrompt(structureResult.data.gridWidth, structureResult.data.gridHeight),
        `The warehouse floor plan is the attached image. Extract rackRows and palletAreas only (pass 2 of 2).\n\n${summarizeFixedStructure(structureResult.data.objects ?? [])}`,
      )
      extraction = mergeExtractions(structureResult.data, detailResult.data)
      const detailConfidence = typeof detailResult.data.confidence === 'number' ? detailResult.data.confidence : 0
      combinedConfidence = Math.min(structureConfidence, detailConfidence)
    } else {
      const result = await runPass(buildFloorplanSystemPrompt(pinned), 'The warehouse floor plan is the attached image. Extract the grid layout.')
      extraction = result.data
      combinedConfidence = typeof result.data.confidence === 'number' ? result.data.confidence : 0
    }

    const draft = normalizeFloorplan(extraction, {
      warehouseId: (job as any).warehouse_id,
      warehouseCode,
      zoneProfileByType,
      storageTypeByToken,
      // Fold this import's id into rack codes so they can't collide with the
      // warehouse's existing (published) `-B-x-y` racks or a prior import.
      codeSlug: importId,
    })

    const confidence = combinedConfidence
    const needsReview = confidence < REVIEW_THRESHOLD || draft.rackCount === 0

    // Auto-connect: carve docks free of overlapping walls and thread 1×1
    // walkway cells to every rack that would otherwise be an orphaned island,
    // so a plausible draft arrives publish-ready instead of failing the
    // designer's unreachable-bins gate on first load.
    const connectObjects: ConnectObject[] = draft.objects.map((o) => ({
      objectType: o.object_type,
      floor: o.floor,
      x: o.x,
      y: o.y,
      w: o.w,
      h: o.h,
      meta: o.meta,
    }))
    const connectPlacements: ConnectPlacement[] = draft.placements.map((p) => ({
      id: p.client_ref,
      floor: p.floor,
      x: p.x,
      y: p.y,
      w: p.w,
      h: p.h,
    }))
    const repair = autoConnectLayout({
      objects: connectObjects,
      placements: connectPlacements,
      gridWidth: draft.gridWidth,
      gridHeight: draft.gridHeight,
      floors: draft.floors,
      // cellSizeM defaults to 1: the layout doesn't exist yet, so it has no
      // scale — and the repair works in cells regardless.
    })
    // ConnectObject is structurally identical to NormalizedObject bar the
    // objectType/object_type field name — adapt back, preserving meta.
    const repairedObjects: NormalizedObject[] = repair.objects.map((o) => ({
      object_type: o.objectType as NormalizedObject['object_type'],
      floor: o.floor,
      x: o.x,
      y: o.y,
      w: o.w,
      h: o.h,
      ...(o.meta ? { meta: o.meta } : {}),
    }))

    await admin.from('floorplan_imports')
      .update({ status: 'succeeded', confidence, needs_review: needsReview } as any).eq('id', importId)

    return new Response(JSON.stringify({
      ok: true,
      importId,
      draft: {
        gridWidth: draft.gridWidth,
        gridHeight: draft.gridHeight,
        // What the drawing said the building measures, or null. The import modal
        // shows these for confirmation and derives cell_size_m from the width
        // over the (already fixed) grid — it is never applied unreviewed.
        floorWidthM: draft.floorWidthM,
        floorHeightM: draft.floorHeightM,
        floors: draft.floors,
        placements: draft.placements,
        objects: repairedObjects,
        palletAreas: draft.palletAreas,
      },
      counts: {
        racks: draft.rackCount,
        objects: draft.objectCount,
        zones: draft.zoneCount,
        palletAreas: draft.palletAreaCount,
        addedWalkways: repair.addedWalkwayCells.length,
        removedWallCells: repair.removedWallCells.length,
        unreachable: repair.stillUnreachable.length,
      },
      confidence,
      needsReview,
      notes: extraction.notes ?? '',
      fidelity,
      // Raw (pre-normalization) merged extraction — echoed back by the client
      // in a follow-up `reconcile` call so the server stays stateless about it.
      extraction,
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
