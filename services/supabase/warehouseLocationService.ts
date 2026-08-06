import { supabase } from '@/lib/supabase'
import { toInventoryLocation } from '@/lib/adapters'
import { describeValidationIssues, extractFunctionErrorDetails, extractFunctionErrorMessage } from '@/lib/functionError'
import { packAreaRuns, type AreaPaintSpec } from '@/lib/areaPaint'
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

export async function deactivateWarehouseLocation(id: number): Promise<void> {
  const { error } = await supabase.functions.invoke<{ ok: true }>('mutate-warehouse-location', {
    body: { action: 'deactivate', id },
  })
  if (error) throw error
}
