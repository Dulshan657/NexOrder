// generate-labels Edge Function
//
// Renders an N-up A4 sheet of scannable Code 128 labels — for locations (bins,
// rack levels, aisle/zone wayfinding signs), for products, or for handling units
// — stores it in the private `warehouse-labels` bucket (mig 00074), records the
// run in label_print_log, and returns a short-lived signed URL.
//
// The barcode payload is BARE TEXT (the locations.code / product SKU / HU code)
// with no URL wrapper and no prefix, so any third-party scanner reads something
// meaningful. Every label also prints the code in large mono type underneath:
// a barcode-only label is useless the moment it is scuffed or badly lit, and an
// operator who cannot read the code cannot type it either.
//
// Code 128 rather than a QR because operators scan with a hand-held gun rather
// than a phone — a laser reads a linear symbol faster, further away and at worse
// angles than any camera reads a QR.
//
// Encoding lives in _shared/labels/code128.ts, geometry in _shared/labelSheet.ts
// and the will-it-scan judgement in _shared/labels/sizing.ts. All three are pure
// and unit-tested by vitest in the frontend — this file only does I/O and
// drawing, and is the one place that knows both modules and points.
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
import { requireAuth, type UserRole } from '../_shared/auth.ts'
import { EdgeFunctionError, errorResponse, isEdgeFunctionError } from '../_shared/errors.ts'
import { checkRateLimit } from '../_shared/rateLimit.ts'
import { logAuditEvent } from '../_shared/audit.ts'
import { corsHeadersFor } from '../_shared/cors.ts'
import {
  A4_HEIGHT,
  A4_WIDTH,
  MM,
  QUIET_ZONE_MODULES,
  fitFontSize,
  fitText,
  labelArtwork,
  layoutLabels,
  MAX_START_OFFSET,
  sheetSpec,
  SHEET_PRESETS,
  type BarcodeFit,
  type LabelCell,
  type LabelTextSlot,
  type SheetPresetName,
} from '../_shared/labelSheet.ts'
import {
  Code128EncodeError,
  darkRuns,
  encodeCode128,
  type Code128Symbol,
} from '../_shared/labels/code128.ts'
import {
  CALIBRATION_WIDTHS_MM,
  calibrationRowFits,
  fitRun,
  refuseRun,
} from '../_shared/labels/sizing.ts'
import {
  planLabelJob,
  resolvePreset,
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
  // 'calibration' is not a label run: it prints one code at a range of bar
  // widths so an operator can find where their printer and gun stop agreeing.
  // It writes no stickers and is deliberately kept out of label_print_log.
  kind: z.enum(['location', 'product', 'handling_unit', 'calibration']),
  /** calibration only: which code to print. Defaults to the site's longest. */
  code: z.string().min(1).max(120).optional(),
  // Derived from the preset library rather than restated, so adding a stock is
  // one edit. Default is the 99x38mm sheet: a 13-character location code gets
  // 0.48mm bars there and only 0.31mm on the 24-up.
  preset: z
    .enum(Object.keys(SHEET_PRESETS) as [SheetPresetName, ...SheetPresetName[]])
    .default('a4-14'),
  /**
   * Skip N cells on the first page, to reuse a part-used sticker sheet.
   *
   * The ceiling is DERIVED from the largest sheet in the library, never typed —
   * a fixed 47 was sized for a 24-up sheet and outlived it, and a fixed 64 would
   * go the same way the moment an eleventh preset lands. It is deliberately the
   * library-wide maximum rather than this request's preset: on a layout run the
   * preset is resolved per group from the site's saved stock, after validation.
   * `layoutLabels` clamps to the chosen preset's own capacity anyway; both UI
   * inputs bound themselves to `maxStartOffset(preset)` so that clamp is never
   * the operator's first news of it.
   */
  startOffset: z.number().int().min(0).max(MAX_START_OFFSET).default(0),
  /** location kind: restrict to one warehouse subtree. */
  warehouseId: z.number().int().positive().optional(),
  /** location kind: which location kinds to print. Defaults to storable ones. */
  locationKinds: z.array(z.string()).optional(),
  /** Explicit id list. On the `location` kind it SELECTS the rows; on a layout run
   *  it NARROWS what the RPC already chose (see the filter at the target query).
   *  A recode's label hand-off uses the latter. */
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
  /**
   * Print this run on a different stock, without changing the site's default.
   *
   * Distinct from `preset`, which carries a default and so cannot say whether
   * the caller meant it. A layout run otherwise re-derives its stock the same
   * way it re-derives WHICH locations it covers — the client picks the group,
   * never what is in it — and this is the one deliberate exception.
   */
  presetOverride: z
    .enum(Object.keys(SHEET_PRESETS) as [SheetPresetName, ...SheetPresetName[]])
    .optional(),
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

// ── Barcode rendering ─────────────────────────────────────────────

/**
 * Ink-spread compensation, in points.
 *
 * A laser prints bars slightly wider than nominal, which narrows the spaces and
 * shifts the ratios a decoder measures. If the gun reads marginally at the
 * physical verification pass this is the first knob to turn — but it stays at
 * zero until there is evidence, because guessing at bar-width reduction is how
 * you make a good symbol worse.
 */
const BAR_WIDTH_REDUCTION_PT = 0

/**
 * Draw a Code 128 symbol as one rectangle per dark bar.
 *
 * Each bar is positioned by an exact multiplication from the symbol's left edge
 * rather than by accumulating widths as it goes. A 97-element symbol summed in
 * floating point would place its last bars fractionally off, and the ratio
 * between adjacent bars and spaces is precisely what a decoder measures.
 *
 * No `borderColor`/`borderWidth`: a stroked rectangle adds half the line width
 * to EACH side of every bar, which would destroy those ratios wholesale.
 */
function drawBarcode(page: PDFPage, symbol: Code128Symbol, slot: BarcodeFit): void {
  const ink = rgb(0, 0, 0)
  for (const run of darkRuns(symbol)) {
    page.drawRectangle({
      x: slot.x + run.start * slot.moduleWidth,
      y: slot.y,
      width: run.width * slot.moduleWidth - BAR_WIDTH_REDUCTION_PT,
      height: slot.height,
      color: ink,
    })
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
/**
 * The sticker stock this site chose for this sheet group (mig 00106), or null
 * to fall through to the built-in default.
 *
 * A stored preset that is no longer in the library returns null rather than
 * throwing: a preset can be renamed or dropped in TypeScript while old rows sit
 * in the table, and a stale preference should quietly stop applying rather than
 * block every print run on the site.
 */
async function loadLabelPref(
  admin: any,
  warehouseId: number | null,
  group: SheetGroup,
): Promise<SheetPresetName | null> {
  if (warehouseId == null) return null
  const { data } = await admin
    .from('warehouse_label_prefs')
    .select('preset')
    .eq('warehouse_id', warehouseId)
    .eq('sheet_group', group)
    .maybeSingle()

  const preset = (data as any)?.preset as string | undefined
  if (!preset || !(preset in SHEET_PRESETS)) return null
  return preset as SheetPresetName
}

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

  // `ids` NARROWS the server's own selection; it never supplies one. The RPC still
  // decides what a label target IS -- which kinds, which levels, what context each
  // sticker carries -- so a caller cannot smuggle in a location the layout does not
  // own, and an id that has since been deactivated simply drops out. This is what
  // lets a recode hand off "print exactly the bins I just swept" with no SQL change
  // and no second definition of a print run.
  const narrowed = input.ids && input.ids.length > 0
    ? rows.filter((r) => (input.ids as number[]).includes(r.locationId))
    : rows

  const sheet = planLabelJob(narrowed).find((s) => s.group === (group as SheetGroup))
  const warehouseId = ((layout as any).warehouse_id as number | null) ?? null

  return {
    items: (sheet?.items ?? []).map((i) => ({ code: i.code, context: i.context })),
    warehouseId,
    // The stock a group prints on is a property of the SITE and the group,
    // never of the request — a bin sticker rendered at aisle-sign size wastes a
    // sheet. Resolution order is the site's saved preference (mig 00106), then
    // the built-in default, which derives from SHEET_GROUPS rather than naming
    // a preset so an empty group and a populated one cannot disagree.
    preset:
      input.presetOverride ??
      resolvePreset(group as SheetGroup, {
        [group as SheetGroup]: await loadLabelPref(admin, warehouseId, group as SheetGroup),
      }),
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
): Promise<{ bytes: Uint8Array; warnings: string[] }> {
  // Pre-flight, BEFORE a PDFDocument exists. A sheet of unscannable stickers is
  // worse than no sheet at all: the failure surfaces on a ladder, after four
  // hundred of them are stuck down. Refusing here costs nothing and leaves no
  // half-built document behind.
  const codes = items.map((i) => i.code)
  const refusal = refuseRun({ codes, preset })
  if (refusal) {
    throw new EdgeFunctionError('INVALID_INPUT', refusal.message, {
      codes: refusal.codes,
      suggestedPreset: refusal.suggestion,
    })
  }

  // Anything that will print but sits below what a comfortable scan wants comes
  // back to the operator rather than being swallowed — "check one with the gun
  // before you run the sheet" is a cheap instruction and a costly omission.
  const assessment = fitRun({ codes, preset, distance: 'arms_length' })
  const warnings = assessment.marginal.map((f) => `${f.code} — ${f.reason}`)

  const spec = sheetSpec(preset)
  const pages = layoutLabels(items.length, spec, startOffset)

  const pdf = await PDFDocument.create()
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

  return { bytes: await pdf.save(), warnings }
}

// ── Calibration sheet ─────────────────────────────────────────────

/**
 * One page, one code, printed at a range of bar widths.
 *
 * Bar width is the single thing a printer can silently ruin: a laser that
 * over-inks turns a legal symbol into an unreadable one without changing
 * anything you can see at arm's length. Every threshold in
 * `_shared/labels/sizing.ts` assumes a printer that holds the width it is
 * given, and this is what turns that assumption into a measurement — before
 * anyone starts sticking labels on racking rather than after.
 *
 * Deliberately NOT recorded in label_print_log: no sticker from this sheet goes
 * on a location, and `codes` would be the same code six times. It is a
 * diagnostic, not a label run.
 */
async function buildCalibrationPdf(code: string): Promise<Uint8Array> {
  const symbol = encodeCode128(code)

  const pdf = await PDFDocument.create()
  const page = pdf.addPage([A4_WIDTH, A4_HEIGHT])
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold)
  const body = await pdf.embedFont(StandardFonts.Helvetica)
  const mono = await pdf.embedFont(StandardFonts.CourierBold)

  const margin = 15 * MM
  const ink = rgb(0, 0, 0)
  const grey = rgb(0.42, 0.4, 0.38)
  const printable = A4_WIDTH - 2 * margin

  let y = A4_HEIGHT - margin - 14
  page.drawText('Barcode calibration sheet', { x: margin, y, size: 16, font: bold, color: ink })

  y -= 20
  for (const line of [
    `Code: ${code}  ·  ${symbol.modules} modules  ·  Code 128`,
    'Scan each row with the gun you will use on the floor. Ten times, at arm\u2019s length.',
    'The narrowest row that reads first-time every time is your printer\u2019s real limit.',
    'If a row fails, every label at or below that bar width will fail on the racking too.',
  ]) {
    page.drawText(line, { x: margin, y, size: 9, font: body, color: grey })
    y -= 12
  }

  y -= 10
  const barHeight = 16 * MM
  const skipped: number[] = []

  for (const widthMm of CALIBRATION_WIDTHS_MM) {
    const moduleWidth = widthMm * MM
    const barsWidth = symbol.modules * moduleWidth
    const quiet = QUIET_ZONE_MODULES * moduleWidth

    // A wide bar and a long code can outgrow the page. Skipping is honest;
    // squeezing the row would print a width the row's own label denies.
    if (!calibrationRowFits(symbol.modules, widthMm, printable / MM)) {
      skipped.push(widthMm)
      continue
    }

    const heading = `${widthMm.toFixed(2)} mm bars`
    page.drawText(heading, { x: margin, y: y - 10, size: 11, font: bold, color: ink })
    // Measured rather than a fixed offset: at 11pt Helvetica-Bold the heading is
    // ~62pt and a hard-coded 70 left the two strings touching.
    page.drawText(`symbol ${(barsWidth / MM).toFixed(0)} mm wide`, {
      x: margin + bold.widthOfTextAtSize(heading, 11) + 10,
      y: y - 10,
      size: 9,
      font: body,
      color: grey,
    })

    const barsY = y - 16 - barHeight
    for (const run of darkRuns(symbol)) {
      page.drawRectangle({
        x: margin + quiet + run.start * moduleWidth,
        y: barsY,
        width: run.width * moduleWidth,
        height: barHeight,
        color: ink,
      })
    }

    page.drawText(code, { x: margin + quiet, y: barsY - 11, size: 9, font: mono, color: ink })
    y = barsY - 26
  }

  if (skipped.length > 0) {
    page.drawText(
      `Not shown: ${skipped.map((w) => `${w.toFixed(2)}mm`).join(', ')} — too wide for A4 at this code length.`,
      { x: margin, y: y - 4, size: 8, font: body, color: grey },
    )
  }

  return await pdf.save()
}

/**
 * The code to calibrate against: the LONGEST active location code on the site.
 *
 * The longest code encodes to the widest symbol and therefore the narrowest
 * bars, so it is the one label at risk. Calibrating against a short code would
 * pass a printer that cannot manage the sheet you actually need to run.
 */
async function loadCalibrationCode(admin: any, warehouseId: number | null): Promise<string> {
  let query = admin.from('locations').select('code, materialized_path').eq('is_active', true)

  if (warehouseId != null) {
    const { data: root } = await admin
      .from('locations')
      .select('materialized_path')
      .eq('id', warehouseId)
      .maybeSingle()
    const rootPath = (root as any)?.materialized_path as string | undefined
    if (rootPath) {
      query = query.like('materialized_path', `${rootPath.replace(/([\\%_])/g, '\\$1')}/%`)
    }
  }

  const { data } = await query.limit(5000)
  const codes = ((data ?? []) as any[]).map((r) => r.code as string).filter(Boolean)
  if (codes.length === 0) return 'AMD-B-12-7-L3'

  // Longest by ENCODED width, not character count — Code Set C packs digits, so
  // the longest string is not always the widest symbol.
  return codes.reduce((worst, c) => {
    try {
      return encodeCode128(c).modules > encodeCode128(worst).modules ? c : worst
    } catch {
      return worst
    }
  }, codes[0])
}

function drawLabel(
  page: PDFPage,
  cell: LabelCell,
  item: LabelItem,
  codeFont: PDFFont,
  contextFont: PDFFont,
  measure: (font: PDFFont) => (s: string, size: number) => number,
): void {
  // Safe to encode without a try: the pre-flight already refused the whole run
  // if any code here were un-encodable.
  const symbol = encodeCode128(item.code)
  const art = labelArtwork(cell, { modules: symbol.modules, withContext: !!item.context })

  drawBarcode(page, symbol, art.barcode)

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

    // A calibration sheet answers a different question from every other run —
    // "can this printer hold a bar width", not "which locations need stickers"
    // — so it shares only the auth, the bucket and the signed URL.
    if (input.kind === 'calibration') {
      const code = input.code ?? (await loadCalibrationCode(admin, input.warehouseId ?? null))
      let bytes: Uint8Array
      try {
        bytes = await buildCalibrationPdf(code)
      } catch (e) {
        if (e instanceof Code128EncodeError) {
          throw new EdgeFunctionError('INVALID_INPUT', `Cannot calibrate against ${code}: ${e.message}`)
        }
        throw e
      }

      const storagePath = `calibration/calibration-${Date.now()}.pdf`
      const { error: calUploadError } = await admin.storage
        .from(BUCKET)
        .upload(storagePath, bytes, { contentType: 'application/pdf', upsert: false })
      if (calUploadError) {
        throw new EdgeFunctionError('INTERNAL', `upload failed: ${calUploadError.message}`)
      }

      const { data: calSigned } = await admin.storage
        .from(BUCKET)
        .createSignedUrl(storagePath, SIGNED_URL_TTL_SECONDS)

      await logAuditEvent(admin, {
        actorId: auth.userId,
        actorRole: auth.role,
        action: 'create',
        resource: 'label_calibration_sheet',
        resourceId: storagePath,
        after: { code, warehouse_id: input.warehouseId ?? null, widths_mm: CALIBRATION_WIDTHS_MM },
      })

      return new Response(
        JSON.stringify({
          ok: true,
          storagePath,
          signedUrl: calSigned?.signedUrl ?? null,
          code,
          widthsMm: CALIBRATION_WIDTHS_MM,
        }),
        { status: 201, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

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

    const { bytes, warnings } = await buildLabelPdf(items, preset, input.startOffset)

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
        // Recorded so "why did that bin never scan" is answerable months later
        // from the audit trail rather than from memory.
        marginal_labels: warnings.length,
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
        warnings,
      }),
      { status: 201, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  } catch (e) {
    if (isEdgeFunctionError(e)) return e.toResponse(req)
    return errorResponse('INTERNAL', e instanceof Error ? e.message : 'Unknown error', undefined, undefined, req)
  }
})
