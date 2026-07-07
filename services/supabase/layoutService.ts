import { supabase } from '@/lib/supabase'
import { toLayoutObject, toLayoutPlacement, toWarehouseLayout } from '@/lib/adapters'
import type { LayoutObject, LayoutObjectType, LayoutPlacement, WarehouseLayout } from '@/types'

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
  if (error) throw error
  return toWarehouseLayout((data as any).layout)
}

export async function cloneLayout(layoutId: number, name: string): Promise<WarehouseLayout> {
  const { data, error } = await supabase.functions.invoke<{ ok: true; layout: unknown }>('mutate-layout', {
    body: { action: 'clone_layout', layout_id: layoutId, name },
  })
  if (error) throw error
  return toWarehouseLayout((data as any).layout)
}

export async function archiveLayout(layoutId: number): Promise<WarehouseLayout> {
  const { data, error } = await supabase.functions.invoke<{ ok: true; layout: unknown }>('mutate-layout', {
    body: { action: 'archive_layout', layout_id: layoutId },
  })
  if (error) throw error
  return toWarehouseLayout((data as any).layout)
}

/** Hard-delete a draft or archived layout. Published layouts must be archived
 *  first (the server rejects a published delete). */
export async function deleteLayout(layoutId: number): Promise<number> {
  const { data, error } = await supabase.functions.invoke<{ ok: true; layout_id: number }>('mutate-layout', {
    body: { action: 'delete_layout', layout_id: layoutId },
  })
  if (error) throw error
  return (data as any).layout_id as number
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
    capacity_slots?: number
    slot_kind?: 'pallet' | 'carton'
    zone_profile_id?: number
    storage_type_id?: number
  }
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
}

export interface SaveGeometryResult {
  layout_id: number
  ref_map: Array<{ client_ref: string; location_id: number }>
}

export async function saveGeometry(
  layoutId: number,
  placements: SavePlacementInput[],
  objects: SaveObjectInput[],
): Promise<SaveGeometryResult> {
  const { data, error } = await supabase.functions.invoke<SaveGeometryResult & { ok: true }>('mutate-layout', {
    body: { action: 'save_geometry', layout_id: layoutId, placements, objects },
  })
  if (error) throw error
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
  if (error) throw error
  return data as PublishResult
}
