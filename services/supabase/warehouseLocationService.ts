import { supabase } from '@/lib/supabase'
import { toInventoryLocation } from '@/lib/adapters'
import type { InventoryLocation, LevelRole, LocationKind } from '@/types'

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

export async function deactivateWarehouseLocation(id: number): Promise<void> {
  const { error } = await supabase.functions.invoke<{ ok: true }>('mutate-warehouse-location', {
    body: { action: 'deactivate', id },
  })
  if (error) throw error
}
