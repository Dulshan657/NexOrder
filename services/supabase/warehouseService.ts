import { supabase } from '@/lib/supabase'
import { toWarehouse } from '@/lib/adapters'
import type { Warehouse, WarehouseType } from '@/types'

export interface WarehouseCreateInput {
  code: string
  name: string
  location_type: WarehouseType
  lat?: number
  lng?: number
  address?: string
  contact?: string
  hours?: string
  notes?: string
}

export type WarehouseUpdateInput = Partial<Omit<WarehouseCreateInput, 'code'>> & {
  is_active?: boolean
}

/** All warehouses (active + inactive), nearest-name-first for admin display. */
export async function getWarehouses(): Promise<Warehouse[]> {
  const { data, error } = await supabase
    .from('locations')
    .select('*')
    .eq('kind', 'WAREHOUSE')
    .order('name')
  if (error) throw error
  return (data ?? []).map(toWarehouse)
}

export async function createWarehouse(input: WarehouseCreateInput): Promise<Warehouse> {
  const { data, error } = await supabase.functions.invoke<{ ok: true; warehouse: unknown }>(
    'mutate-warehouse',
    { body: { action: 'create', data: input } },
  )
  if (error) throw error
  return toWarehouse((data as any).warehouse)
}

export async function updateWarehouse(id: number, updates: WarehouseUpdateInput): Promise<Warehouse> {
  const { data, error } = await supabase.functions.invoke<{ ok: true; warehouse: unknown }>(
    'mutate-warehouse',
    { body: { action: 'update', id, data: updates } },
  )
  if (error) throw error
  return toWarehouse((data as any).warehouse)
}

export async function deactivateWarehouse(id: number): Promise<Warehouse> {
  const { data, error } = await supabase.functions.invoke<{ ok: true; warehouse: unknown }>(
    'mutate-warehouse',
    { body: { action: 'deactivate', id } },
  )
  if (error) throw error
  return toWarehouse((data as any).warehouse)
}

export interface TransferStockInput {
  productId: number
  fromLocationId: number
  toLocationId: number
  qty: number
  reason?: string
}

export async function transferStock(input: TransferStockInput): Promise<void> {
  const { error } = await supabase.functions.invoke<{ ok: true }>('transfer-stock', {
    body: input,
  })
  if (error) throw error
}
