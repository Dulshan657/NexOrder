import { supabase } from '@/lib/supabase'
import {
  planLabelJob,
  type LabelTargetRow,
  type PlannedSheet,
  type SheetGroup,
} from '@/supabase/functions/_shared/labels/layoutLabelPlan'
import type { SheetPresetName } from '@/supabase/functions/_shared/labelSheet'

// Thin client over the generate-labels Edge Function (mig 00074 bucket +
// label_print_log). All the work is server-side; this only shapes the request
// and hands back the signed URL the UI opens for printing.

export type LabelKind = 'location' | 'product' | 'handling_unit'
/**
 * Derived from the preset library, never restated. A hand-written union here
 * silently excluded every stock added to `SHEET_PRESETS` and would do so again.
 */
export type LabelPreset = SheetPresetName

export interface GenerateLabelsInput {
  kind: LabelKind
  preset?: LabelPreset
  /** Skip N cells on the first page so a part-used sticker sheet can be reused. */
  startOffset?: number
  warehouseId?: number
  locationKinds?: string[]
  ids?: number[]
  // Layout run (mig 00084).
  layoutId?: number
  sheetGroup?: SheetGroup
  rootLocationId?: number
  onlyUnprinted?: boolean
  jobId?: string
}

export interface GenerateLabelsResult {
  storagePath: string
  signedUrl: string | null
  labelCount: number
  preset?: LabelPreset
  sheetGroup?: SheetGroup | null
}

export async function generateLabels(input: GenerateLabelsInput): Promise<GenerateLabelsResult> {
  const { data, error } = await supabase.functions.invoke<{
    ok: true
    storagePath: string
    signedUrl: string | null
    labelCount: number
  }>('generate-labels', {
    body: {
      kind: input.kind,
      // Must match the server's own default, or "unspecified" means two
      // different sheet sizes depending on which side you ask.
      preset: input.preset ?? 'a4-14',
      startOffset: input.startOffset ?? 0,
      warehouseId: input.warehouseId,
      locationKinds: input.locationKinds,
      ids: input.ids,
      layoutId: input.layoutId,
      sheetGroup: input.sheetGroup,
      rootLocationId: input.rootLocationId,
      onlyUnprinted: input.onlyUnprinted,
      jobId: input.jobId,
    },
    // Rendering a full-warehouse sheet (MAIN is ~945 levels) encodes a barcode
    // per label and can outrun the global 20s fetch ceiling in lib/supabase.ts.
    // functions-js attaches its own AbortSignal, which bypasses that ceiling
    // and enforces this bound instead (same reasoning as extractFloorplan).
    timeout: 90_000,
  })
  if (error) throw error
  if (!data) throw new Error('Label generation returned no result')
  return {
    storagePath: data.storagePath,
    signedUrl: data.signedUrl,
    labelCount: data.labelCount,
    preset: (data as { preset?: LabelPreset }).preset,
    sheetGroup: (data as { sheetGroup?: SheetGroup | null }).sheetGroup ?? null,
  }
}

// ── Calibration ──────────────────────────────────────────────────────────────

export interface CalibrationSheetResult {
  storagePath: string
  signedUrl: string | null
  /** The code that was printed — the site's longest unless one was given. */
  code: string
  widthsMm: number[]
}

/**
 * One page, one code, printed at a range of bar widths.
 *
 * Every sizing verdict the wizard shows assumes a printer that holds the bar
 * width it is given, and that is the one thing a printer can silently ruin.
 * Print this once, scan down it, and the narrowest row that reads first-time
 * every time is a measured fact rather than an assumption.
 */
export async function generateCalibrationSheet(input: {
  warehouseId?: number
  code?: string
}): Promise<CalibrationSheetResult> {
  const { data, error } = await supabase.functions.invoke<CalibrationSheetResult>(
    'generate-labels',
    { body: { kind: 'calibration', warehouseId: input.warehouseId, code: input.code } },
  )
  if (error) throw error
  if (!data) throw new Error('Calibration sheet returned no result')
  return data
}

// ── Layout runs (mig 00084) ──────────────────────────────────────────────────

// lib/database.types.ts is stale and regenerating it is its own job (it emits
// bare `string` where lib/adapters.ts narrows ~15 unions), so the generated RPC
// name union does not know about these two. Same defensive-cast treatment as
// warehouseReportService / productHomeBinService.
//
// `.bind` is load-bearing: supabase.rpc reads `this.rest` internally, so a bare
// `const rpc = supabase.rpc` detaches the receiver and throws "Cannot read
// properties of undefined (reading 'rest')" before any request goes out. That
// exact mistake silently broke wie_warehouse_report in production once.
type UntypedRpc = (
  name: string,
  args: Record<string, unknown>,
) => Promise<{ data: unknown; error: { message: string } | null }>

const rpc = supabase.rpc.bind(supabase) as unknown as UntypedRpc

/**
 * Every location a published layout still needs a label for.
 *
 * Read straight from the RPC and grouped in the browser with the SAME pure
 * module the Edge Function uses, so the counts in the modal and the contents of
 * the PDF cannot disagree. The server re-derives the set when it renders — this
 * is a preview, never an instruction about what to print.
 */
export async function getLayoutLabelTargets(
  layoutId: number,
  opts: { rootLocationId?: number | null; onlyUnprinted?: boolean } = {},
): Promise<PlannedSheet[]> {
  const { data, error } = await rpc('wie_layout_label_targets', {
    p_layout_id: layoutId,
    p_root_location_id: opts.rootLocationId ?? null,
    p_only_unprinted: opts.onlyUnprinted ?? true,
  })
  if (error) throw new Error(error.message)

  const rows: LabelTargetRow[] = ((data ?? []) as Record<string, unknown>[]).map((r) => ({
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

  return planLabelJob(rows)
}

export interface LayoutLabelStatusRow {
  kind: string
  total: number
  printed: number
  outstanding: number
}

/** Per-kind label counts for the backlog badge. */
export async function getLayoutLabelStatus(layoutId: number): Promise<LayoutLabelStatusRow[]> {
  const { data, error } = await rpc('wie_layout_label_status', { p_layout_id: layoutId })
  if (error) throw new Error(error.message)
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    kind: r.kind as string,
    total: Number(r.total ?? 0),
    printed: Number(r.printed ?? 0),
    outstanding: Number(r.outstanding ?? 0),
  }))
}

export interface LayoutLabelSheet {
  group: SheetGroup
  preset: LabelPreset
  labelCount: number
  signedUrl: string | null
  storagePath: string
}

export interface LayoutLabelSheetFailure {
  group: SheetGroup
  message: string
}

export interface LayoutLabelJob {
  jobId: string
  sheets: LayoutLabelSheet[]
  /** Groups that failed to render. Empty on a clean run. */
  failures: LayoutLabelSheetFailure[]
}

export interface PrintLayoutLabelsInput {
  layoutId: number
  rootLocationId?: number | null
  onlyUnprinted?: boolean
  startOffset?: number
}

/**
 * Render every sheet one layout run needs, as one job.
 *
 * SEQUENTIAL on purpose. Three concurrent calls would each render up to a
 * thousand barcodes, which finds the per-user rate limit (10/min) and the 90s
 * invoke ceiling at the same time — and a job that fails halfway leaves the
 * operator holding two of three sheets with no way to tell which.
 *
 * The groups are discovered from the same preview the modal shows, so empty
 * groups cost nothing: a warehouse with no staging area never calls for a
 * staging sheet.
 *
 * A failing group does NOT abandon the ones already rendered. Those PDFs exist
 * in the bucket and are logged against this job, so throwing them away would
 * leave the operator re-rendering a thousand barcodes to recover work that is
 * already done. Only a job where nothing rendered is an outright failure.
 */
export async function printLayoutLabels(input: PrintLayoutLabelsInput): Promise<LayoutLabelJob> {
  const onlyUnprinted = input.onlyUnprinted ?? true
  const planned = await getLayoutLabelTargets(input.layoutId, {
    rootLocationId: input.rootLocationId,
    onlyUnprinted,
  })
  if (planned.length === 0) {
    throw new Error('Nothing to print — every location in that selection already has a label.')
  }

  const jobId = crypto.randomUUID()
  const sheets: LayoutLabelSheet[] = []
  const failures: LayoutLabelSheetFailure[] = []

  for (const sheet of planned) {
    try {
      const result = await generateLabels({
        kind: 'location',
        layoutId: input.layoutId,
        sheetGroup: sheet.group,
        rootLocationId: input.rootLocationId ?? undefined,
        onlyUnprinted,
        jobId,
        // Only the FIRST sheet honours a part-used stock offset: each group
        // prints onto its own fresh sheet of a different die-cut, so carrying
        // the offset across would blank cells on stock never part-used.
        // Keyed on sheets.length, so a failed first sheet passes the offset on
        // to whichever sheet actually reaches that part-used stock first.
        startOffset: sheets.length === 0 ? (input.startOffset ?? 0) : 0,
      })
      sheets.push({
        group: sheet.group,
        preset: (result.preset ?? sheet.preset) as LabelPreset,
        labelCount: result.labelCount,
        signedUrl: result.signedUrl,
        storagePath: result.storagePath,
      })
    } catch (err) {
      failures.push({
        group: sheet.group,
        message: err instanceof Error ? err.message : 'Could not render that sheet.',
      })
    }
  }

  if (sheets.length === 0) {
    throw new Error(failures[0]?.message ?? 'Could not render any label sheets.')
  }

  return { jobId, sheets, failures }
}

/** Record that a job's stickers are physically on the floor (or undo that). */
export async function confirmLabelPrint(
  jobId: string,
  opts: { undo?: boolean } = {},
): Promise<{ locationsUpdated: number }> {
  const { data, error } = await supabase.functions.invoke<{
    ok: true
    locationsUpdated: number
  }>('confirm-label-print', { body: { jobId, undo: opts.undo ?? false } })
  if (error) throw error
  return { locationsUpdated: data?.locationsUpdated ?? 0 }
}

export interface LabelPrintLogRow {
  id: number
  labelKind: LabelKind
  labelCount: number
  warehouseId: number | null
  storagePath: string
  createdAt: string
}

/** Recent label runs, so a sheet can be re-downloaded rather than regenerated. */
export async function listLabelPrintLog(limit = 20): Promise<LabelPrintLogRow[]> {
  const { data, error } = await supabase
    .from('label_print_log')
    .select('id, label_kind, label_count, warehouse_id, storage_path, created_at')
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw error
  return (data ?? []).map((r: Record<string, unknown>) => ({
    id: r.id as number,
    labelKind: r.label_kind as LabelKind,
    labelCount: r.label_count as number,
    warehouseId: (r.warehouse_id as number | null) ?? null,
    storagePath: r.storage_path as string,
    createdAt: r.created_at as string,
  }))
}

/** Fresh signed URL for a previously generated sheet. */
export async function signLabelSheet(storagePath: string): Promise<string | null> {
  const { data, error } = await supabase.storage
    .from('warehouse-labels')
    .createSignedUrl(storagePath, 600)
  if (error) throw error
  return data?.signedUrl ?? null
}
