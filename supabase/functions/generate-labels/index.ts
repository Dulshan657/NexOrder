// generate-labels Edge Function
//
// Renders an N-up A4 sheet of scannable QR labels — for locations (bins, rack
// levels, aisle/zone wayfinding signs), for products, or for handling units —
// stores it in the private `warehouse-labels` bucket (mig 00074), records the
// run in label_print_log, and returns a short-lived signed URL.
//
// The QR payload is BARE TEXT (the locations.code / product SKU / HU code) with
// no URL wrapper and no prefix, so any third-party scanner reads something
// meaningful. Every label also prints the code in large mono type underneath:
// a QR-only label is useless the moment it is scuffed or badly lit, and an
// operator who cannot read the code cannot type it either.
//
// Geometry lives in _shared/labelSheet.ts, which is pure and unit-tested by
// vitest in the frontend — this file only does I/O and drawing.
//
// Two selection modes:
//   * warehouse + kind (original) — ad-hoc runs, products, handling units.
//   * layoutId + sheetGroup (mig 00084) — everything a PUBLISHED layout needs,
//     one call per sheet of stock. Grouping and label wording come from the pure
//     _shared/labels/layoutLabelPlan.ts, shared with the browser.
//
// A layout run NEVER flips locations.label_printed. Generating a PDF is not
// evidence a sticker reached a rack; confirm-label-print records that, per job,
// once the operator says so.

// deno-lint-ignore-file no-explicit-any
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.103.0'
import { z } from 'https://esm.sh/zod@3.23.8'
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'https://esm.sh/pdf-lib@1.17.1'
import QRCode from 'https://esm.sh/qrcode@1.5.4'
import { requireAuth, type UserRole } from '../_shared/auth.ts'
import { EdgeFunctionError, errorResponse, isEdgeFunctionError } from '../_shared/errors.ts'
import { checkRateLimit } from '../_shared/rateLimit.ts'
import { logAuditEvent } from '../_shared/audit.ts'
import { corsHeadersFor } from '../_shared/cors.ts'
import {
  fitFontSize,
  fitText,
  labelArtwork,
  layoutLabels,
  sheetSpec,
  type LabelCell,
  type LabelTextSlot,
  type SheetPresetName,
} from '../_shared/labelSheet.ts'
import {
  planLabelJob,
  type LabelTargetRow,
  type SheetGroup,
} from '../_shared/labels/layoutLabelPlan.ts'
import { requireModule } from '../_shared/modules.ts'

const ALLOWED: ReadonlyArray<UserRole> = ['Admin', 'Manager', 'Warehouse']
const BUCKET = 'warehouse-labels'
const SIGNED_URL_TTL_SECONDS = 600

// A whole-warehouse run is legitimate (MAIN is 189 bays x 5 levels = 945), but
// an unbounded run would let one request render an arbitrarily large PDF.
const MAX_LABELS = 2000

const inputSchema = z.object({
  kind: z.enum(['location', 'product', 'handling_unit']),
  preset: z.enum(['a4-24', 'a4-14', 'a4-8']).default('a4-24'),
  /** Skip N cells on the first page, to reuse a part-used sticker sheet. */
  startOffset: z.number().int().min(0).max(47).default(0),
  /** location kind: restrict to one warehouse subtree. */
  warehouseId: z.number().int().positive().optional(),
  /** location kind: which location kinds to print. Defaults to storable ones. */
  locationKinds: z.array(z.string()).optional(),
  /** Explicit id list, for reprinting a specific handful. */
  ids: z.array(z.number().int().positive()).optional(),

  // ── Layout run (mig 00084) ──
  // With a layoutId the selection comes from wie_layout_label_targets instead of
  // the warehouse+kind query: the layout's placements, its staging areas and
  // their ZONE/AISLE/RACK ancestors. Scoped to the LAYOUT because publishing
  // never retires old bins, so the warehouse subtree contains locations that are
  // no longer on the floor.
  layoutId: z.number().int().positive().optional(),
  /** Which sheet of stock this call renders. Required alongside layoutId. */
  sheetGroup: z.enum(['wayfinding', 'slots', 'staging']).optional(),
  /** Narrow to one subtree — "reprint aisle A3". Includes that root's own sign. */
  rootLocationId: z.number().int().positive().optional(),
  /** Default: only locations with no sticker yet. */
  onlyUnprinted: z.boolean().default(true),
  /** Groups the sheets of one run. Minted by the client, one per job. */
  jobId: z.string().uuid().optional(),
})

interface LabelItem {
  /** The exact string encoded into the QR and printed beneath it. */
  code: string
  /** Secondary line: location name, product name, etc. */
  context: string
}

// ── QR rendering ──────────────────────────────────────────────────

interface QrMatrix {
  size: number
  /** Row-major, 1 = dark. */
  data: Uint8Array
}

function qrMatrix(text: string): QrMatrix {
  // 'M' recovery: readable through the scuffing a warehouse label collects,
  // without inflating the module count the way 'H' does on long codes.
  const qr = (QRCode as any).create(text, { errorCorrectionLevel: 'M' })
  return { size: qr.modules.size, data: qr.modules.data }
}

/**
 * Draw a QR by merging horizontal runs of dark modules into single rectangles.
 *
 * A 25x25 QR is 625 modules; drawing one rect per dark module across 24 labels
 * per page is ~7,500 PDF operators per page. Run-merging cuts that by roughly
 * 3-4x and costs ten lines.
 */
function drawQr(page: PDFPage, matrix: QrMatrix, x: number, y: number, size: number): void {
  const module = size / matrix.size
  const ink = rgb(0, 0, 0)

  for (let row = 0; row < matrix.size; row++) {
    let runStart = -1
    for (let col = 0; col <= matrix.size; col++) {
      const dark = col < matrix.size && matrix.data[row * matrix.size + col] === 1
      if (dark && runStart === -1) {
        runStart = col
      } else if (!dark && runStart !== -1) {
        page.drawRectangle({
          x: x + runStart * module,
          // Matrix row 0 is the TOP row; PDF y grows upward.
          y: y + size - (row + 1) * module,
          width: (col - runStart) * module,
          height: module,
          color: ink,
        })
        runStart = -1
      }
    }
  }
}

// ── Item loading ──────────────────────────────────────────────────

/** Location kinds that are worth a sticker by default: storable slots plus the
 *  wayfinding levels an operator uses to find them. */
const DEFAULT_LOCATION_KINDS = ['ZONE', 'AISLE', 'RACK', 'BAY', 'SHELF', 'BIN', 'STAGING']

/**
 * Every label one sheet-group of a layout run needs.
 *
 * The RPC returns raw pieces; grouping and the context wording come from the
 * pure planner, which the browser imports too — so what the operator previews in
 * the modal and what lands on the sticker cannot drift apart.
 *
 * Deliberately re-derives the set server-side rather than accepting a list of
 * ids from the client: the client picks WHICH group to render, never WHAT is in
 * it.
 */
async function loadLayoutItems(
  admin: any,
  input: z.infer<typeof inputSchema>,
): Promise<{ items: LabelItem[]; warehouseId: number | null; preset: SheetPresetName }> {
  const group = input.sheetGroup
  if (!group) {
    throw new EdgeFunctionError('INVALID_INPUT', 'sheetGroup is required when layoutId is given')
  }

  const { data: layout, error: layoutError } = await admin
    .from('warehouse_layouts')
    .select('id, warehouse_id, status')
    .eq('id', input.layoutId)
    .single()
  if (layoutError || !layout) {
    throw new EdgeFunctionError('NOT_FOUND', `Layout ${input.layoutId} not found`)
  }
  // Draft geometry is still being moved around; stickers printed from it would
  // name bins that may not survive to publish.
  if ((layout as any).status !== 'published') {
    throw new EdgeFunctionError(
      'INVALID_INPUT',
      'Labels can only be printed from a published layout.',
    )
  }

  const { data, error } = await admin.rpc('wie_layout_label_targets', {
    p_layout_id: input.layoutId,
    p_root_location_id: input.rootLocationId ?? null,
    p_only_unprinted: input.onlyUnprinted,
  })
  if (error) throw new EdgeFunctionError('INTERNAL', error.message)

  const rows: LabelTargetRow[] = ((data ?? []) as any[]).map((r) => ({
    locationId: r.location_id as number,
    code: r.code as string,
    kind: r.kind as string,
    name: (r.name as string | null) ?? null,
    zoneName: (r.zone_name as string | null) ?? null,
    aisleCode: (r.aisle_code as string | null) ?? null,
    levelRoleName: (r.level_role_name as string | null) ?? null,
    levelIndex: (r.level_index as number | null) ?? null,
    labelPrinted: !!r.label_printed,
  }))

  const sheet = planLabelJob(rows).find((s) => s.group === (group as SheetGroup))

  return {
    items: (sheet?.items ?? []).map((i) => ({ code: i.code, context: i.context })),
    warehouseId: (layout as any).warehouse_id ?? null,
    // The stock a group prints on is a property of the group, never of the
    // request — a bin sticker rendered at aisle-sign size wastes a sheet.
    preset: sheet?.preset ?? 'a4-24',
  }
}

async function loadItems(
  admin: any,
  input: z.infer<typeof inputSchema>,
): Promise<{ items: LabelItem[]; warehouseId: number | null; markPrintedIds?: number[] }> {
  if (input.kind === 'location') {
    let query = admin
      .from('locations')
      .select('id, code, name, kind, materialized_path')
      .eq('is_active', true)
      .in('kind', input.locationKinds?.length ? input.locationKinds : DEFAULT_LOCATION_KINDS)
      .order('code')
      .limit(MAX_LABELS + 1)

    if (input.ids?.length) query = query.in('id', input.ids)

    // Scope to one warehouse subtree. materialized_path is 'ROOT/child/...',
    // so a prefix match is the whole filter — no recursion needed.
    //
    // This MUST be applied to the query, not to the fetched rows: filtering
    // after a .limit() would silently drop the far end of a large warehouse,
    // which is exactly the failure mode the 200-candidate putaway cap already
    // cost us once (see the WIE gotchas in CLAUDE.md).
    if (input.warehouseId != null) {
      const { data: root, error: rootError } = await admin
        .from('locations')
        .select('id, code, materialized_path')
        .eq('id', input.warehouseId)
        .single()
      if (rootError || !root) {
        throw new EdgeFunctionError('NOT_FOUND', `Warehouse ${input.warehouseId} not found`)
      }
      const rootPath = (root as any).materialized_path ?? (root as any).code ?? ''
      // Escape LIKE metacharacters — a code containing % or _ would otherwise
      // widen the match instead of narrowing it.
      const escaped = rootPath.replace(/([\\%_])/g, '\\$1')
      query = query.like('materialized_path', `${escaped}/%`)
    }

    const { data, error } = await query
    if (error) throw new EdgeFunctionError('INTERNAL', error.message)
    const rows = (data ?? []) as any[]

    return {
      items: rows.map((r) => ({ code: r.code, context: `${r.kind} · ${r.name ?? ''}`.trim() })),
      warehouseId: input.warehouseId ?? null,
    }
  }

  if (input.kind === 'product') {
    let query = admin
      .from('products')
      .select('id, sku, name, is_active')
      .order('sku')
      .limit(MAX_LABELS + 1)
    if (input.ids?.length) query = query.in('id', input.ids)
    else query = query.eq('is_active', true)

    const { data, error } = await query
    if (error) throw new EdgeFunctionError('INTERNAL', error.message)

    return {
      // The SKU is encoded, never the barcode: a supplier EAN identifies the
      // product for *their* catalogue, but our own printed label should carry
      // our own identifier, which is guaranteed present and unique.
      items: ((data ?? []) as any[]).map((r) => ({ code: r.sku, context: r.name ?? '' })),
      warehouseId: null,
    }
  }

  // handling_unit (mig 00075). With no explicit ids this prints the BACKLOG:
  // every plate at this site that has no physical sticker yet — which is the
  // whole point of label_printed, since the 00076 backfill minted plates for
  // stock nobody has ever labelled.
  let huQuery = admin
    .from('handling_units')
    .select('id, code, hu_type, created_at')
    .in('status', ['open', 'stored'])
    .order('created_at')
    .limit(MAX_LABELS + 1)

  if (input.ids?.length) {
    huQuery = huQuery.in('id', input.ids)
  } else {
    huQuery = huQuery.eq('label_printed', false)
    if (input.warehouseId != null) huQuery = huQuery.eq('warehouse_id', input.warehouseId)
  }

  const { data, error } = await huQuery
  if (error) throw new EdgeFunctionError('INTERNAL', error.message)

  const rows = (data ?? []) as any[]
  return {
    items: rows.map((r) => ({
      code: r.code,
      context: r.hu_type === 'carton' ? 'Carton' : 'Pallet',
    })),
    warehouseId: input.warehouseId ?? null,
    // Printing IS the act that makes a plate labelled; flipping the flag here
    // is what stops the backlog from reprinting the same stickers forever.
    markPrintedIds: rows.map((r) => r.id as number),
  }
}

// ── PDF ───────────────────────────────────────────────────────────

async function buildLabelPdf(
  items: LabelItem[],
  preset: SheetPresetName,
  startOffset: number,
): Promise<Uint8Array> {
  const spec = sheetSpec(preset)
  const pages = layoutLabels(items.length, spec, startOffset)

  const pdf = await PDFDocument.create()
  const mono = await pdf.embedFont(StandardFonts.Courier)
  const monoBold = await pdf.embedFont(StandardFonts.CourierBold)
  const body = await pdf.embedFont(StandardFonts.Helvetica)

  const measure = (font: PDFFont) => (s: string, size: number) => font.widthOfTextAtSize(s, size)

  for (const pageLayout of pages) {
    const page = pdf.addPage([spec.pageWidth, spec.pageHeight])

    for (const cell of pageLayout.cells) {
      const item = items[cell.index]
      if (!item) continue
      drawLabel(page, cell, item, monoBold, body, measure)
    }
  }

  return await pdf.save()
}

function drawLabel(
  page: PDFPage,
  cell: LabelCell,
  item: LabelItem,
  codeFont: PDFFont,
  contextFont: PDFFont,
  measure: (font: PDFFont) => (s: string, size: number) => number,
): void {
  const art = labelArtwork(cell, { withContext: !!item.context })

  drawQr(page, qrMatrix(item.code), art.qr.x, art.qr.y, art.qr.size)

  drawCentred(page, art.code, item.code, codeFont, measure(codeFont), rgb(0, 0, 0))

  if (art.context && item.context) {
    drawCentred(
      page,
      art.context,
      item.context,
      contextFont,
      measure(contextFont),
      rgb(0.42, 0.4, 0.38),
    )
  }
}

/**
 * Draw one line centred on its slot, shrinking before it will truncate.
 *
 * The slot carries a centre rather than a left edge because only here — where
 * the font lives — can the string be measured, and centring needs its width.
 */
function drawCentred(
  page: PDFPage,
  slot: LabelTextSlot,
  text: string,
  font: PDFFont,
  measure: (s: string, size: number) => number,
  color: ReturnType<typeof rgb>,
): void {
  const size = fitFontSize(text, slot.maxWidth, slot.fontSize, slot.minFontSize, measure)
  const fitted = fitText(text, slot.maxWidth, size, measure)
  page.drawText(fitted, {
    x: slot.centerX - measure(fitted, size) / 2,
    y: slot.y,
    size,
    font,
    color,
  })
}

// ── Handler ───────────────────────────────────────────────────────

serve(async (req: Request) => {
  const corsHeaders = corsHeadersFor(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    requireModule('inventory_dispatch')
    const auth = await requireAuth(req, { allowedRoles: ALLOWED })

    // 10/min/user — rendering a 900-label PDF is by far the heaviest thing an
    // ops user can trigger.
    const rl = await checkRateLimit(`generate-labels:${auth.userId}`, { windowMs: 60_000, max: 10 })
    if (!rl.ok) {
      throw new EdgeFunctionError(
        'TOO_MANY_REQUESTS',
        `Rate limit exceeded; try again in ${Math.ceil(rl.resetMs / 1000)}s`,
      )
    }

    const body = await req.json().catch(() => {
      throw new EdgeFunctionError('INVALID_INPUT', 'Request body must be valid JSON')
    })
    const parsed = inputSchema.safeParse(body)
    if (!parsed.success) {
      throw new EdgeFunctionError('INVALID_INPUT', 'Invalid label request', parsed.error.flatten())
    }
    const input = parsed.data

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { persistSession: false } },
    )

    const isLayoutRun = input.layoutId != null
    const { items, warehouseId, markPrintedIds, preset } = isLayoutRun
      ? { ...(await loadLayoutItems(admin, input)), markPrintedIds: undefined }
      : { ...(await loadItems(admin, input)), preset: input.preset }

    if (items.length === 0) {
      throw new EdgeFunctionError('INVALID_INPUT', 'Nothing to print — that selection matched no records.')
    }
    if (items.length > MAX_LABELS) {
      throw new EdgeFunctionError(
        'INVALID_INPUT',
        `That selection is ${items.length} labels; the maximum per sheet run is ${MAX_LABELS}. Narrow it by zone or kind.`,
      )
    }

    const bytes = await buildLabelPdf(items, preset, input.startOffset)

    const stamp = Date.now()
    const storagePath = isLayoutRun
      ? `location/layout-${input.layoutId}-${input.sheetGroup}-${stamp}.pdf`
      : `${input.kind}/${input.kind}-${stamp}.pdf`
    const { error: uploadError } = await admin.storage
      .from(BUCKET)
      .upload(storagePath, bytes, { contentType: 'application/pdf', upsert: false })
    if (uploadError) throw new EdgeFunctionError('INTERNAL', `upload failed: ${uploadError.message}`)

    const { error: logError } = await admin.from('label_print_log').insert({
      label_kind: input.kind,
      codes: items.map((i) => i.code),
      label_count: items.length,
      warehouse_id: warehouseId,
      storage_path: storagePath,
      generated_by: auth.userId,
      job_id: input.jobId ?? null,
      sheet_group: isLayoutRun ? input.sheetGroup : null,
      layout_id: isLayoutRun ? input.layoutId : null,
    })
    if (logError) throw new EdgeFunctionError('INTERNAL', `record failed: ${logError.message}`)

    // Only after the PDF is safely stored: a plate marked printed whose sheet
    // failed to upload would silently drop out of the backlog with no sticker.
    if (markPrintedIds?.length) {
      const { error: markError } = await admin
        .from('handling_units')
        .update({ label_printed: true, updated_at: new Date().toISOString() })
        .in('id', markPrintedIds)
      if (markError) {
        throw new EdgeFunctionError('INTERNAL', `could not mark plates printed: ${markError.message}`)
      }
    }

    const { data: signed } = await admin.storage
      .from(BUCKET)
      .createSignedUrl(storagePath, SIGNED_URL_TTL_SECONDS)

    await logAuditEvent(admin, {
      actorId: auth.userId,
      actorRole: auth.role,
      action: 'create',
      resource: 'label_sheet',
      resourceId: storagePath,
      after: {
        kind: input.kind,
        count: items.length,
        preset,
        warehouse_id: warehouseId,
        layout_id: isLayoutRun ? input.layoutId : null,
        sheet_group: isLayoutRun ? input.sheetGroup : null,
        job_id: input.jobId ?? null,
      },
    })

    return new Response(
      JSON.stringify({
        ok: true,
        storagePath,
        signedUrl: signed?.signedUrl ?? null,
        labelCount: items.length,
        preset,
        sheetGroup: isLayoutRun ? input.sheetGroup : null,
        jobId: input.jobId ?? null,
      }),
      { status: 201, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  } catch (e) {
    if (isEdgeFunctionError(e)) return e.toResponse(req)
    return errorResponse('INTERNAL', e instanceof Error ? e.message : 'Unknown error', undefined, undefined, req)
  }
})
