import { supabase } from '@/lib/supabase'
import { toInventoryLocation } from '@/lib/adapters'
import { describeValidationIssues, extractFunctionErrorDetails, extractFunctionErrorMessage } from '@/lib/functionError'
import { packAreaRuns, type AreaPaintSpec } from '@/lib/areaPaint'
import { packSignRuns, type SignSpec } from '@/lib/signPaint'
import type { CodeOrder, CodeOrigin } from '@/lib/codePattern'
import type { InventoryLocation, LevelRole, LocationKind } from '@/types'

/**
 * Rethrow a functions.invoke failure carrying the message the server sent.
 *
 * `functions.invoke` collapses every non-2xx into "Edge Function returned a
 * non-2xx status code" and leaves the real `{ error: { code, message } }` body
 * unread on `.context`. A rename can be refused for several distinct and
 * actionable reasons — no published layout, no area by that name, a placement
 * outside the warehouse, the bulk rate limit — and all of them read identically
 * without this. Same helper as layoutService's.
 */
async function rethrowWithServerMessage(error: unknown, fallback: string): Promise<never> {
  const message = await extractFunctionErrorMessage(error, fallback)
  const issues = describeValidationIssues(await extractFunctionErrorDetails(error))
  throw new Error(issues ? `${message} — ${issues}` : message)
}

export interface CreateLocationInput {
  parent_id: number
  kind: Exclude<LocationKind, 'WAREHOUSE'>
  code: string
  name: string
  capacity_slots?: number
  slot_kind?: 'pallet' | 'carton'
}

export interface UpdateLocationInput {
  name?: string
  capacity_slots?: number | null
  slot_kind?: 'pallet' | 'carton' | null
  is_active?: boolean
}

/** All storage nodes (zones/bins/shelves) under a warehouse, including inactive. */
export async function getWarehouseLocations(warehouseId: number): Promise<InventoryLocation[]> {
  const { data: wh, error: whErr } = await supabase
    .from('locations')
    .select('materialized_path')
    .eq('id', warehouseId)
    .single()
  if (whErr) throw whErr
  const path = (wh as { materialized_path: string }).materialized_path

  const { data, error } = await supabase
    .from('locations')
    .select('*')
    .like('materialized_path', `${path}/%`)
    .order('materialized_path')
  if (error) throw error
  return (data ?? []).map(toInventoryLocation)
}

export async function createWarehouseLocation(input: CreateLocationInput): Promise<InventoryLocation> {
  const { data, error } = await supabase.functions.invoke<{ ok: true; location: unknown }>(
    'mutate-warehouse-location',
    { body: { action: 'create', data: input } },
  )
  if (error) throw error
  return toInventoryLocation((data as any).location)
}

export async function updateWarehouseLocation(id: number, updates: UpdateLocationInput): Promise<InventoryLocation> {
  const { data, error } = await supabase.functions.invoke<{ ok: true; location: unknown }>(
    'mutate-warehouse-location',
    { body: { action: 'update', id, data: updates } },
  )
  if (error) throw error
  return toInventoryLocation((data as any).location)
}

/** One level in a convert/set-levels payload, ascending from L1 (the bottom). */
export interface RackLevelInput {
  level_index: number
  role: LevelRole
  capacity_slots?: number | null
  weight_capacity_kg?: number | null
}

export interface ConvertRackResult {
  rackId: number
  levelLocationIds: number[]
  l1LocationId: number
  /** Base units relocated onto L1 by the conversion. */
  unitsMoved: number
}

/**
 * Convert a flat BIN into a levelled RACK for the FIRST time (mig 00072).
 *
 * This is the only inventory-affecting location mutation: the server moves the
 * bin's entire balance — on_hand AND allocated — onto the new L1 inside one
 * transaction. Use `setRackLevels` instead to reconfigure a rack that already
 * has levels; that path never touches stock.
 */
export async function convertRackToLevels(
  id: number,
  layoutId: number,
  levels: RackLevelInput[],
): Promise<ConvertRackResult> {
  const { data, error } = await supabase.functions.invoke<{ ok: true; result: Record<string, unknown> }>(
    'mutate-warehouse-location',
    { body: { action: 'convert_to_levels', id, layout_id: layoutId, levels } },
  )
  if (error) throw error
  // The RPC returns raw snake_case jsonb; normalise at the boundary so callers
  // stay camelCase like the rest of the frontend.
  const r = (data as any).result ?? {}
  return {
    rackId: Number(r.rack_id),
    levelLocationIds: (r.level_location_ids ?? []) as number[],
    l1LocationId: Number(r.l1_location_id),
    unitsMoved: Number(r.units_moved ?? 0),
  }
}

/** Reconfigure the levels of an ALREADY-levelled rack. Never moves stock, and
 *  the server refuses to remove a level that still holds any. */
export async function setRackLevels(id: number, levels: RackLevelInput[]): Promise<void> {
  const { error } = await supabase.functions.invoke<{ ok: true }>('mutate-warehouse-location', {
    body: { action: 'set_levels', id, levels },
  })
  if (error) throw error
}

// ── Friendly names (mig 00094) ───────────────────────────────────────────────

export interface AreaRenamePreview {
  /** Locations that will actually change name. */
  willRename: number
  racks: number
  levels: number
  /** Hand-named locations inside the area that will be left alone unless the
   *  operator opts in. Reported, never silently skipped. */
  skippedCustom: number
  examples: Array<{ code: string; from: string; to: string }>
}

export interface AreaRenameResult {
  renamed: number
  racks: number
  levels: number
  skippedCustom: number
}

interface AreaRenameArgs {
  warehouseId: number
  from: string
  to: string
  zoneProfileId?: number | null
  includeCustom?: boolean
}

/**
 * What renaming this area would do — computed by the SERVER, running the same
 * pure module the dialog does.
 *
 * A `dry_run` flag on the real action rather than a separate preview endpoint,
 * so the preview and the write cannot drift apart. Writes nothing and audits
 * nothing.
 */
export async function previewAreaRename(args: AreaRenameArgs): Promise<AreaRenamePreview> {
  const { data, error } = await supabase.functions.invoke<{ ok: true; preview: AreaRenamePreview }>(
    'mutate-warehouse-location',
    {
      body: {
        action: 'rename_area',
        warehouse_id: args.warehouseId,
        from: args.from,
        to: args.to,
        include_custom: args.includeCustom ?? false,
        dry_run: true,
      },
    },
  )
  if (error) await rethrowWithServerMessage(error, 'Could not check the rename')
  return (data as any).preview as AreaRenamePreview
}

/** Rename an area and cascade to every auto-named bin inside it. Works on a
 *  LIVE warehouse — the designer cannot, since save_geometry requires a draft. */
export async function renameArea(args: AreaRenameArgs): Promise<AreaRenameResult> {
  const { data, error } = await supabase.functions.invoke<{ ok: true } & AreaRenameResult>(
    'mutate-warehouse-location',
    {
      body: {
        action: 'rename_area',
        warehouse_id: args.warehouseId,
        from: args.from,
        to: args.to,
        ...(args.zoneProfileId === undefined ? {} : { zone_profile_id: args.zoneProfileId }),
        include_custom: args.includeCustom ?? false,
      },
    },
  )
  if (error) await rethrowWithServerMessage(error, 'Could not rename the area')
  return data as AreaRenameResult
}

/** Rename one rack, optionally restamping its levels, in a single round trip. */
export async function renameRack(
  id: number,
  name: string,
  includeLevels = false,
): Promise<number> {
  const { data, error } = await supabase.functions.invoke<{ ok: true; renamed: number }>(
    'mutate-warehouse-location',
    { body: { action: 'rename_rack', id, name, include_levels: includeLevels } },
  )
  if (error) await rethrowWithServerMessage(error, 'Could not rename the location')
  return Number((data as any)?.renamed ?? 0)
}

// ── Live area painting (mig 00095) ───────────────────────────────────────────

export interface AreaPaintPreview {
  created: string[]
  erased: string[]
  resized: Array<{ name: string; before: number; after: number; added: number; removed: number }>
  reprofiled: Array<{ name: string; before: number | null; after: number | null }>
  cellsAfter: number
  unchanged: boolean
  /** Locations that will actually change name. 0 unless the cascade is armed. */
  willRename: number
  racks: number
  levels: number
  /** Hand-named locations the cascade would have taken. Reported, never silent. */
  skippedCustom: number
  /** Locations whose carried pool already disagreed with where they sat. This
   *  paint did not make them inconsistent, so it does not repair them either. */
  skippedForeign: number
  examples: Array<{ code: string; from: string; to: string }>
  /** Zone binding (mig 00096). Not gated by the cascade — an area naming a zone
   *  re-parents its bins whether or not their names change. */
  willBind: number
  bindLevels: number
  unbind: number
  categoryWarnings: ZoneCategoryWarning[]
}

export interface AreaPaintResult {
  fingerprint: string
  cells: number
  areas: number
  renamed: number
  racks: number
  levels: number
  skippedCustom: number
  skippedForeign: number
  /** Rows the re-parent actually wrote — units plus their rack levels (00096). */
  bound: number
  boundUnits: number
  boundLevels: number
  unbound: number
  categoryWarnings: ZoneCategoryWarning[]
}

export interface PaintAreasArgs {
  warehouseId: number
  /** The layout the operator was looking at. Refused if a publish has landed. */
  layoutId: number
  /** areaCellsFingerprint over the rows this working set was built from. */
  baseFingerprint: string
  /** The COMPLETE set. An area left out is erased; `[]` erases every area. */
  areas: AreaPaintSpec[]
  cascadeNames?: boolean
  includeCustom?: boolean
}

/** One body builder for both the preview and the write, so they cannot drift. */
function paintAreasBody(args: PaintAreasArgs, dryRun: boolean) {
  return {
    action: 'paint_areas',
    warehouse_id: args.warehouseId,
    layout_id: args.layoutId,
    base_fingerprint: args.baseFingerprint,
    // An area with no cells has been erased, and the wire schema requires at
    // least one run per area — dropping it here IS how an erase is expressed.
    areas: args.areas
      .filter((a) => a.cells.length > 0)
      .map((a) => ({
        name: a.name,
        // `?? null`, never omitted: the server declares this .nullish() and null
        // is the honest wire value for "no profile".
        zone_profile_id: a.zoneProfileId ?? null,
        runs: packAreaRuns(a.cells),
      })),
    cascade_names: args.cascadeNames === true,
    include_custom: args.includeCustom === true,
    ...(dryRun ? { dry_run: true } : {}),
  }
}

/**
 * What this paint would do — computed by the SERVER, running the same pure
 * module the summary panel does.
 *
 * A `dry_run` flag on the real action rather than a separate preview endpoint,
 * so the count in the button is the count that moves. Writes nothing, audits
 * nothing, and still charges the rate bucket because it does the whole read.
 */
export async function previewPaintAreas(args: PaintAreasArgs): Promise<AreaPaintPreview> {
  const { data, error } = await supabase.functions.invoke<{ ok: true; preview: AreaPaintPreview }>(
    'mutate-warehouse-location',
    { body: paintAreasBody(args, true) },
  )
  if (error) await rethrowWithServerMessage(error, 'Could not check the areas')
  return (data as any).preview as AreaPaintPreview
}

/** Replace every named area on a LIVE warehouse, optionally cascading names. */
export async function paintAreas(args: PaintAreasArgs): Promise<AreaPaintResult> {
  const { data, error } = await supabase.functions.invoke<{ ok: true } & AreaPaintResult>(
    'mutate-warehouse-location',
    { body: paintAreasBody(args, false) },
  )
  if (error) await rethrowWithServerMessage(error, 'Could not save the areas')
  return data as AreaPaintResult
}

// ── Floor signs (mig 00097) ──────────────────────────────────────────────────
//
// The same shape as paint_areas — full replace, fingerprint, dry_run on the real
// action — minus the cascade and the binding, because a sign names nothing and
// re-parents nothing. Keep the two apart: folding signs into PaintAreasArgs
// would put a `cascadeNames` flag within reach of a call that must never have one.

export interface SignPaintPreview {
  created: string[]
  erased: string[]
  resized: Array<{ name: string; before: number; after: number; added: number; removed: number }>
  cellsAfter: number
  unchanged: boolean
}

export interface SignPaintResult {
  fingerprint: string
  cells: number
  signs: number
}

export interface PaintSignsArgs {
  warehouseId: number
  /** The layout the operator was looking at. Refused if a publish has landed. */
  layoutId: number
  /** signCellsFingerprint over the rows this working set was built from. Its own
   *  stamp, never the area one — the two pictures move independently. */
  baseFingerprint: string
  /** The COMPLETE set. A sign left out is erased; `[]` erases every sign. */
  signs: SignSpec[]
}

/** One body builder for both the preview and the write, so they cannot drift. */
function paintSignsBody(args: PaintSignsArgs, dryRun: boolean) {
  return {
    action: 'paint_labels',
    warehouse_id: args.warehouseId,
    layout_id: args.layoutId,
    base_fingerprint: args.baseFingerprint,
    // A sign with no cells has been erased, and the wire schema requires at
    // least one run — dropping it here IS how an erase is expressed.
    signs: args.signs
      .filter((s) => s.cells.length > 0)
      .map((s) => ({ name: s.name, runs: packSignRuns(s.cells) })),
    ...(dryRun ? { dry_run: true } : {}),
  }
}

/** What this sign edit would do, computed by the SERVER running the same pure
 *  module the summary panel does. Writes nothing, audits nothing. */
export async function previewPaintSigns(args: PaintSignsArgs): Promise<SignPaintPreview> {
  const { data, error } = await supabase.functions.invoke<{ ok: true; preview: SignPaintPreview }>(
    'mutate-warehouse-location',
    { body: paintSignsBody(args, true) },
  )
  if (error) await rethrowWithServerMessage(error, 'Could not check the signs')
  return (data as any).preview as SignPaintPreview
}

/** Replace every floor sign on a LIVE warehouse. Touches no location row. */
export async function paintSigns(args: PaintSignsArgs): Promise<SignPaintResult> {
  const { data, error } = await supabase.functions.invoke<{ ok: true } & SignPaintResult>(
    'mutate-warehouse-location',
    { body: paintSignsBody(args, false) },
  )
  if (error) await rethrowWithServerMessage(error, 'Could not save the signs')
  return data as SignPaintResult
}

// ── Zone binding (mig 00096) ─────────────────────────────────────────────────

/** An area whose zone profile would refuse stock its bins already hold. Advisory
 *  — the server warns and binds anyway, because refusing would not move it. */
export interface ZoneCategoryWarning {
  areaName: string
  profileId: number
  bins: number
  categories: string[]
}

export interface ZoneBindingPreview {
  /** Racks and flat bins that will be re-parented. */
  willBind: number
  /** SHELF rows whose path rides along with their rack. */
  levels: number
  /** Bins returning to the warehouse root because their area names no zone. */
  unbind: number
  /** Already in the right place. */
  unchanged: number
  byArea: Array<{
    areaName: string
    profileId: number | null
    zoneId: number | null
    units: number
    moved: number
  }>
  categoryWarnings: ZoneCategoryWarning[]
  examples: Array<{ code: string; from: string; to: string }>
}

export interface ZoneBindingResult {
  /** Rows the RPC actually wrote — units plus their levels. */
  bound: number
  boundUnits: number
  boundLevels: number
  unbound: number
  unchanged: number
  categoryWarnings: ZoneCategoryWarning[]
}

/**
 * What binding this site's areas to their zones would do.
 *
 * A `dry_run` on the real action, never a separate preview endpoint — the same
 * discipline as previewAreaRename and previewPaintAreas, and it matters more
 * here: this is the only surface that shows a 1100-row re-parent before it
 * happens. Writes nothing, audits nothing.
 */
export async function previewZoneBinding(warehouseId: number): Promise<ZoneBindingPreview> {
  const { data, error } = await supabase.functions.invoke<{ ok: true; preview: ZoneBindingPreview }>(
    'mutate-warehouse-location',
    { body: { action: 'bind_zones', warehouse_id: warehouseId, dry_run: true } },
  )
  if (error) await rethrowWithServerMessage(error, 'Could not check the zone binding')
  return (data as any).preview as ZoneBindingPreview
}

/**
 * Bind every drawn bin to the ZONE its area names.
 *
 * Painting and saving already bind as a side effect, so this is for a site
 * painted before mig 00096 — the alternative being to ask an operator to
 * re-paint an area they already painted correctly.
 */
export async function bindZones(warehouseId: number): Promise<ZoneBindingResult> {
  const { data, error } = await supabase.functions.invoke<{ ok: true } & ZoneBindingResult>(
    'mutate-warehouse-location',
    { body: { action: 'bind_zones', warehouse_id: warehouseId } },
  )
  if (error) await rethrowWithServerMessage(error, 'Could not bind the areas to their zones')
  return data as ZoneBindingResult
}

// ── Code sweeps (mig 00107) ──────────────────────────────────────────────────
//
// One body builder shared by the preview and the write, for the reason
// paintAreasBody exists: the previewed count has to be the count that moves, and
// two builders drift.

export interface RecodeRefusalRow {
  id: number
  from: string
  to: string
  kind: string
  detail: string
  heldBy?: number
}

export interface RecodePreview {
  willRecode: number
  units: number
  levels: number
  unchanged: number
  nextCounter: number
  /** Where the counter actually started — the block's high-water + 1 unless the
   *  operator typed one. Worth showing: it is the surprising half. */
  startedAt: number
  block: string
  template: string
  examples: Array<{ from: string; to: string }>
  refusals: RecodeRefusalRow[]
  refusedTotal: number
  /** Locations whose sticker is already on the racking. The sweep resets their
   *  label_printed, putting them back in the print backlog. */
  labelPrinted: number
  holdingStock: number
  /** Every code the sweep would produce — fed to the label sizing wizard so the
   *  physical cost of a longer pattern is visible BEFORE it is paid. */
  codes: string[]
  // ── growth reporting (mig 00108) ──
  /** How deep and wide the frame ran. */
  frame: { rows: number; cols: number }
  /** Block members this framing would MOVE. Non-empty means the batch is refused:
   *  growing a block must never renumber bins already labelled for it. */
  drift: Array<{ id: number; code: string; would: string }>
  driftTotal: number
  /** How many bins are already in this block and are not in the selection. */
  incumbents: number
  origin: CodeOrigin
  order: CodeOrder
  /** The framing that DOES reproduce the incumbents' codes, recovered from the
   *  floor. Null when none does, or when there was no drift to explain. */
  suggestedFraming: { origin: CodeOrigin; order: CodeOrder } | null
}

export interface RecodeResult {
  recoded: number
  units: number
  levels: number
  unchanged: number
  nextCounter: number
  labelPrintedReset: number
  /** False when the sweep applied but its before/after record could not be kept —
   *  the write is not undone by that, so the panel simply withholds Revert rather
   *  than offering one that would fail. */
  canRevert?: boolean
}

export interface RecodeArgs {
  warehouseId: number
  /** Each id with the code the operator was looking at. A per-row
   *  compare-and-swap, not a fingerprint — see the note on recodeSchema. */
  units: Array<{ locationId: number; expectedCode: string }>
  block: string
  /** Null lets the server continue past the block's high-water mark. */
  startAt?: number | null
  templateOverride?: string | null
  order?: CodeOrder | null
  /** Which corner of the painted block is 1-1 (mig 00108). */
  origin?: CodeOrigin | null
  /** Relay the WHOLE block rather than appending to it. The operator's explicit
   *  second answer to a drift refusal, never a default. */
  renumberBlock?: boolean
}

function recodeBody(args: RecodeArgs, dryRun: boolean) {
  return {
    action: 'recode_locations',
    warehouse_id: args.warehouseId,
    units: args.units.map((u) => ({ location_id: u.locationId, expected_code: u.expectedCode })),
    block: args.block,
    // `?? null`, never omitted: the server declares these .nullish() and null is
    // the honest wire value for "let the server decide".
    start_at: args.startAt ?? null,
    template_override: args.templateOverride ?? null,
    order: args.order ?? null,
    origin: args.origin ?? null,
    // Omitted rather than sent false: the server reads it as `.optional()`, and a
    // flag that only ever means "yes, deliberately" should not appear otherwise.
    ...(args.renumberBlock ? { renumber_block: true } : {}),
    ...(dryRun ? { dry_run: true } : {}),
  }
}

/**
 * What this sweep would do — computed by the SERVER, running the same pure module
 * the summary modal renders.
 *
 * Unlike the paint previews this can come back with a populated `refusals` list
 * and still be a 200: the refusals are a list the operator has to work through,
 * and one per round trip would be a bad tool.
 */
export async function previewRecode(args: RecodeArgs): Promise<RecodePreview> {
  const { data, error } = await supabase.functions.invoke<{ ok: true; preview: RecodePreview }>(
    'mutate-warehouse-location',
    { body: recodeBody(args, true) },
  )
  if (error) await rethrowWithServerMessage(error, 'Could not check the new codes')
  return (data as any).preview as RecodePreview
}

/** Rewrite the codes of a selected block of bins on a LIVE warehouse. */
export async function recodeLocations(args: RecodeArgs): Promise<RecodeResult> {
  const { data, error } = await supabase.functions.invoke<{ ok: true } & RecodeResult>(
    'mutate-warehouse-location',
    { body: recodeBody(args, false) },
  )
  if (error) await rethrowWithServerMessage(error, 'Could not apply the new codes')
  return data as RecodeResult
}

/**
 * Put the most recent sweep back.
 *
 * No sweep id: only the newest un-reverted one is reachable, because reverting an
 * older sweep would collide with every newer one. Letting the client name one would
 * only create a way to ask for the wrong answer.
 */
export async function revertCodeSweep(warehouseId: number): Promise<{ reverted: number; block: string }> {
  const { data, error } = await supabase.functions.invoke<{ ok: true; reverted: number; block: string }>(
    'mutate-warehouse-location',
    { body: { action: 'revert_code_sweep', warehouse_id: warehouseId } },
  )
  if (error) await rethrowWithServerMessage(error, 'Could not revert the sweep')
  return data as { reverted: number; block: string }
}

export async function deactivateWarehouseLocation(id: number): Promise<void> {
  const { error } = await supabase.functions.invoke<{ ok: true }>('mutate-warehouse-location', {
    body: { action: 'deactivate', id },
  })
  if (error) throw error
}
