import { supabase } from '@/lib/supabase'
import { toLayoutObject, toLayoutPlacement, toWarehouseLayout } from '@/lib/adapters'
import { describeValidationIssues, extractFunctionErrorDetails, extractFunctionErrorMessage } from '@/lib/functionError'
import type { LayoutObject, LayoutObjectType, LayoutPlacement, WarehouseLayout } from '@/types'

/**
 * Rethrow a functions.invoke failure carrying the message the server actually
 * sent.
 *
 * `supabase.functions.invoke` collapses every non-2xx into a FunctionsHttpError
 * whose `.message` is the generic "Edge Function returned a non-2xx status code";
 * the real `{ error: { code, message } }` body sits unread on `.context`. This
 * file used to `throw error` raw, so every layout save/publish failure — a
 * duplicate bin, a bad level role, a code collision, a stale draft — surfaced as
 * that one useless string, and there was no way to tell them apart from the UI.
 * orderService / putawayService / replenService / emailAccountsService already do
 * this; the layout path was the one that never adopted it.
 */
async function rethrowWithServerMessage(error: unknown, fallback: string): Promise<never> {
  const message = await extractFunctionErrorMessage(error, fallback)
  // Append the offending field paths when the failure was schema validation.
  // "Invalid request body" on its own sent us reading zod schemas by hand to find
  // one `null`; the server attaches the paths, and nobody was reading them.
  const issues = describeValidationIssues(await extractFunctionErrorDetails(error))
  throw new Error(issues ? `${message} — ${issues}` : message)
}

export interface LayoutDetail {
  layout: WarehouseLayout
  placements: LayoutPlacement[]
  objects: LayoutObject[]
}

/** Every layout (draft/published/archived) for a warehouse, newest first. */
export async function getLayouts(warehouseId: number): Promise<WarehouseLayout[]> {
  const { data, error } = await supabase
    .from('warehouse_layouts')
    .select('*')
    .eq('warehouse_id', warehouseId)
    .order('version', { ascending: false })
  if (error) throw error
  return (data ?? []).map(toWarehouseLayout)
}

export async function getLayoutDetail(layoutId: number): Promise<LayoutDetail> {
  const [{ data: layout, error: lErr }, { data: placements, error: pErr }, { data: objects, error: oErr }] =
    await Promise.all([
      supabase.from('warehouse_layouts').select('*').eq('id', layoutId).single(),
      supabase.from('layout_placements').select('*').eq('layout_id', layoutId),
      supabase.from('layout_objects').select('*').eq('layout_id', layoutId),
    ])
  if (lErr) throw lErr
  if (pErr) throw pErr
  if (oErr) throw oErr
  return {
    layout: toWarehouseLayout(layout),
    placements: (placements ?? []).map(toLayoutPlacement),
    objects: (objects ?? []).map(toLayoutObject),
  }
}

export interface CreateLayoutInput {
  warehouse_id: number
  name: string
  grid_width?: number
  grid_height?: number
  cell_size_m?: number
  floor_count?: number
}

export async function createLayout(input: CreateLayoutInput): Promise<WarehouseLayout> {
  const { data, error } = await supabase.functions.invoke<{ ok: true; layout: unknown }>('mutate-layout', {
    body: { action: 'create_layout', data: input },
  })
  if (error) await rethrowWithServerMessage(error, 'Could not create the layout')
  return toWarehouseLayout((data as any).layout)
}

export async function cloneLayout(layoutId: number, name: string): Promise<WarehouseLayout> {
  const { data, error } = await supabase.functions.invoke<{ ok: true; layout: unknown }>('mutate-layout', {
    body: { action: 'clone_layout', layout_id: layoutId, name },
  })
  if (error) await rethrowWithServerMessage(error, 'Could not clone the layout')
  return toWarehouseLayout((data as any).layout)
}

export async function archiveLayout(layoutId: number): Promise<WarehouseLayout> {
  const { data, error } = await supabase.functions.invoke<{ ok: true; layout: unknown }>('mutate-layout', {
    body: { action: 'archive_layout', layout_id: layoutId },
  })
  if (error) await rethrowWithServerMessage(error, 'Could not archive the layout')
  return toWarehouseLayout((data as any).layout)
}

/** Hard-delete a draft or archived layout. Published layouts must be archived
 *  first (the server rejects a published delete). */
export async function deleteLayout(layoutId: number): Promise<number> {
  const { data, error } = await supabase.functions.invoke<{ ok: true; layout_id: number }>('mutate-layout', {
    body: { action: 'delete_layout', layout_id: layoutId },
  })
  if (error) await rethrowWithServerMessage(error, 'Could not delete the layout')
  return (data as any).layout_id as number
}

/** One level of a new_bin.levels array (mig 00072). */
export interface NewBinLevelInput {
  level_index: number
  /** A level_roles.key (mig 00081) — operator-managed, so not a closed union.
   *  mutate-layout validates it against the table.
   *
   *  `null` is legal and means UNCONSTRAINED (a nullable `locations.level_role`).
   *  Send null rather than '' — the editor represents "no stored role" as an empty
   *  string so it can't fake a Pick Zone, and an empty string is not a role. */
  role: string | null
  /** `null` = no limit; the server folds it into the storage form's default.
   *  Typed nullable deliberately — the designer sends `?? null` and, with
   *  `strict` off, declaring these `?: number` let a null through unnoticed while
   *  mutate-layout's schema still rejected it. That mismatch is what made every
   *  save of a Shelving / Cold Room rack fail with "Invalid request body". */
  capacity_slots?: number | null
  slot_kind?: 'pallet' | 'carton' | null
  weight_capacity_kg?: number | null
}

/** One level of an ALREADY-SAVED rack, sent alongside `location_id`.
 *
 *  A levelled rack round-trips as ONE placement whose `location_id` is the RACK
 *  PARENT, so without this the second save of any levelled rack sent the parent
 *  alone and save_geometry (a full replace) dropped the levels and GC'd them.
 *  `location_id` is omitted for a level the operator just added. */
export interface ExistingLevelInput extends NewBinLevelInput {
  location_id?: number
}

/** One placement to save. Existing bins carry location_id; new bins carry new_bin. */
export interface SavePlacementInput {
  client_ref: string
  location_id?: number
  new_bin?: {
    parent_id: number
    kind: 'ZONE' | 'AISLE' | 'RACK' | 'BAY' | 'SHELF' | 'BIN'
    code: string
    name: string
    capacity_slots?: number | null
    slot_kind?: 'pallet' | 'carton' | null
    weight_capacity_kg?: number | null
    zone_profile_id?: number
    storage_type_id?: number
    /** Per-level config (mig 00072; kind must be 'RACK' when present). When
     *  set, save_geometry creates the RACK parent + one SHELF child + one
     *  co-located layout_placements row per level, instead of a single flat
     *  BIN — see ref_map's level_location_ids on the result. */
    levels?: NewBinLevelInput[]
  }
  /** The levels of an EXISTING rack (`location_id` set). Mutually exclusive with
   *  `new_bin`, which carries a brand-new rack's levels instead. */
  levels?: ExistingLevelInput[]
  floor: number
  x: number
  y: number
  w: number
  h: number
  rotation: 0 | 90 | 180 | 270
}

export interface SaveObjectInput {
  object_type: LayoutObjectType
  floor: number
  x: number
  y: number
  w: number
  h: number
  meta?: Record<string, unknown>
  staging_location_id?: number
  /** Ask the server to find-or-create a STAGING location and link it to this
   *  object (and, per the dock-backfill rule, to any dock lacking one). */
  new_staging?: { code: string; name: string }
}

export interface SaveGeometryResult {
  layout_id: number
  ref_map: Array<{
    client_ref: string
    /** For a new_bin.levels rack, this is the RACK PARENT's own id — the
     *  parent has no placement row of its own, but it's still a real
     *  locations row the client may want to reference (e.g. selection). */
    location_id: number
    /** Present only when this placement's new_bin carried levels: level_index
     *  -> the created SHELF (level) location id (mig 00072). */
    level_location_ids?: Record<number, number>
  }>
}

export async function saveGeometry(
  layoutId: number,
  placements: SavePlacementInput[],
  objects: SaveObjectInput[],
): Promise<SaveGeometryResult> {
  const { data, error } = await supabase.functions.invoke<SaveGeometryResult & { ok: true }>('mutate-layout', {
    body: { action: 'save_geometry', layout_id: layoutId, placements, objects },
  })
  if (error) await rethrowWithServerMessage(error, 'Could not save the layout')
  return data as SaveGeometryResult
}

export interface PublishRejection {
  code: string
  message: string
  locationIds?: number[]
}

export interface PublishResult {
  ok: boolean
  result?: unknown
  rejections?: PublishRejection[]
}

/** Publish a draft. Validation failures come back as { ok:false, rejections }
 *  (HTTP 200) so the caller can render the fix-it list without a throw. */
export async function publishLayout(layoutId: number): Promise<PublishResult> {
  const { data, error } = await supabase.functions.invoke<PublishResult>('publish-layout', {
    body: { layout_id: layoutId },
  })
  if (error) await rethrowWithServerMessage(error, 'Could not publish the layout')
  return data as PublishResult
}
