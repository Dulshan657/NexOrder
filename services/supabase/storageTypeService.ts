import { supabase } from '@/lib/supabase'
import { toStorageType } from '@/lib/adapters'
import type { SlotUnit, StorageType } from '@/types'

/** All active storage-unit types, in display order. */
export async function getStorageTypes(): Promise<StorageType[]> {
  const { data, error } = await supabase
    .from('storage_types')
    .select('*')
    .eq('is_active', true)
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true })
  if (error) throw error
  return (data ?? []).map(toStorageType)
}

export interface StorageTypeInput {
  code: string
  name: string
  defaultCapacitySlots?: number | null
  slotUnit: SlotUnit
  attributes?: Record<string, unknown>
  sortOrder?: number
}

export async function createStorageType(input: StorageTypeInput): Promise<StorageType> {
  const { data, error } = await supabase.functions.invoke<{ ok: true; storage_type: unknown }>('mutate-storage-type', {
    body: {
      action: 'create',
      data: {
        code: input.code,
        name: input.name,
        default_capacity_slots: input.defaultCapacitySlots ?? null,
        slot_unit: input.slotUnit,
        attributes: input.attributes ?? {},
        sort_order: input.sortOrder,
      },
    },
  })
  if (error) throw error
  return toStorageType((data as any).storage_type)
}

export async function updateStorageType(id: number, patch: Partial<StorageTypeInput>): Promise<StorageType> {
  const data: Record<string, unknown> = {}
  if (patch.name !== undefined) data.name = patch.name
  if (patch.defaultCapacitySlots !== undefined) data.default_capacity_slots = patch.defaultCapacitySlots
  if (patch.slotUnit !== undefined) data.slot_unit = patch.slotUnit
  if (patch.attributes !== undefined) data.attributes = patch.attributes
  if (patch.sortOrder !== undefined) data.sort_order = patch.sortOrder
  const { data: res, error } = await supabase.functions.invoke<{ ok: true; storage_type: unknown }>('mutate-storage-type', {
    body: { action: 'update', id, data },
  })
  if (error) throw error
  return toStorageType((res as any).storage_type)
}

export async function deactivateStorageType(id: number): Promise<StorageType> {
  const { data, error } = await supabase.functions.invoke<{ ok: true; storage_type: unknown }>('mutate-storage-type', {
    body: { action: 'deactivate', id },
  })
  if (error) throw error
  return toStorageType((data as any).storage_type)
}
