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
  fitText,
  labelArtwork,
  layoutLabels,
  sheetSpec,
  type LabelCell,
  type SheetPresetName,
} from '../_shared/labelSheet.ts'

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

  const codeText = fitText(item.code, art.code.maxWidth, art.code.fontSize, measure(codeFont))
  page.drawText(codeText, {
    x: art.code.x,
    y: art.code.y,
    size: art.code.fontSize,
    font: codeFont,
    color: rgb(0, 0, 0),
  })

  if (art.context && item.context) {
    const contextText = fitText(
      item.context,
      art.context.maxWidth,
      art.context.fontSize,
      measure(contextFont),
    )
    page.drawText(contextText, {
      x: art.context.x,
      y: art.context.y,
      size: art.context.fontSize,
      font: contextFont,
      color: rgb(0.42, 0.4, 0.38),
    })
  }
}

// ── Handler ───────────────────────────────────────────────────────

serve(async (req: Request) => {
  const corsHeaders = corsHeadersFor(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
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

    const { items, warehouseId, markPrintedIds } = await loadItems(admin, input)

    if (items.length === 0) {
      throw new EdgeFunctionError('INVALID_INPUT', 'Nothing to print — that selection matched no records.')
    }
    if (items.length > MAX_LABELS) {
      throw new EdgeFunctionError(
        'INVALID_INPUT',
        `That selection is ${items.length} labels; the maximum per sheet run is ${MAX_LABELS}. Narrow it by zone or kind.`,
      )
    }

    const bytes = await buildLabelPdf(items, input.preset, input.startOffset)

    const stamp = Date.now()
    const storagePath = `${input.kind}/${input.kind}-${stamp}.pdf`
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
      after: { kind: input.kind, count: items.length, preset: input.preset, warehouse_id: warehouseId },
    })

    return new Response(
      JSON.stringify({
        ok: true,
        storagePath,
        signedUrl: signed?.signedUrl ?? null,
        labelCount: items.length,
      }),
      { status: 201, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  } catch (e) {
    if (isEdgeFunctionError(e)) return e.toResponse(req)
    return errorResponse('INTERNAL', e instanceof Error ? e.message : 'Unknown error', undefined, undefined, req)
  }
})
