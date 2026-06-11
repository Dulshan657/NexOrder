import { supabase } from '@/lib/supabase'
import { toInventoryLocation } from '@/lib/adapters'
import type { InventoryLocation, LocationKind } from '@/types'

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

export async function deactivateWarehouseLocation(id: number): Promise<void> {
  const { error } = await supabase.functions.invoke<{ ok: true }>('mutate-warehouse-location', {
    body: { action: 'deactivate', id },
  })
  if (error) throw error
}
