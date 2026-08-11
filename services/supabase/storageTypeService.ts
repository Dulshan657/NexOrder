import { supabase } from '@/lib/supabase'
import { toStorageType } from '@/lib/adapters'
import type { RackLevel, SlotUnit, StorageType } from '@/types'

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
  // Storage-forms capacity model (mig 00061).
  levels?: number | null
  positionsPerLevel?: number | null
  weightCapacityKg?: number | null
  lengthCm?: number | null
  widthCm?: number | null
  heightCm?: number | null
  color?: string | null
  isDrawable?: boolean
  // Rack levels (mig 00072). hasLevels opts this form into addressable
  // per-level locations; levelTemplate is its standard layout — every rack
  // drawn with this form inherits it, individual racks may override.
  hasLevels?: boolean
  levelTemplate?: RackLevel[] | null
  // mig 00100. Not derivable from the fields above — see the migration.
  isFloor?: boolean
}

/** [{levelIndex, role, capacitySlots, slotKind, weightCapacityKg}] -> the
 *  positionally-ordered [{role, capacity_slots, slot_kind, weight_capacity_kg}]
 *  the server stores (level_index is implicit = array position; see
 *  toRackLevelTemplate in lib/adapters.ts for the read-side inverse).
 *
 *  `?? null`, never omitted, for the same reason the rest of this file uses it:
 *  the columns are nullable and null is the honest wire value for "no limit" /
 *  "inherit the form's slot_unit". The server declares each field nullish. */
function toLevelTemplateColumn(levels: RackLevel[]): Array<Record<string, unknown>> {
  return [...levels]
    .sort((a, b) => a.levelIndex - b.levelIndex)
    .map((l) => ({
      role: l.role,
      capacity_slots: l.capacitySlots ?? null,
      slot_kind: l.slotKind ?? null,
      weight_capacity_kg: l.weightCapacityKg ?? null,
    }))
}

/** Map camelCase form fields → the snake_case columns the edge fn expects. */
function toFormColumns(input: Partial<StorageTypeInput>): Record<string, unknown> {
  const data: Record<string, unknown> = {}
  if (input.levels !== undefined) data.levels = input.levels
  if (input.positionsPerLevel !== undefined) data.positions_per_level = input.positionsPerLevel
  if (input.weightCapacityKg !== undefined) data.weight_capacity_kg = input.weightCapacityKg
  if (input.lengthCm !== undefined) data.length_cm = input.lengthCm
  if (input.widthCm !== undefined) data.width_cm = input.widthCm
  if (input.heightCm !== undefined) data.height_cm = input.heightCm
  if (input.color !== undefined) data.color = input.color
  if (input.isDrawable !== undefined) data.is_drawable = input.isDrawable
  if (input.hasLevels !== undefined) data.has_levels = input.hasLevels
  if (input.isFloor !== undefined) data.is_floor = input.isFloor
  if (input.levelTemplate !== undefined) {
    data.level_template = input.levelTemplate ? toLevelTemplateColumn(input.levelTemplate) : null
  }
  return data
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
        ...toFormColumns(input),
      },
    },
  })
  if (error) throw error
  return toStorageType((data as any).storage_type)
}

export async function updateStorageType(
  id: number,
  patch: Partial<StorageTypeInput>,
  applyToExisting = false,
): Promise<{ storageType: StorageType; appliedToUnits: number }> {
  const data: Record<string, unknown> = {}
  if (patch.name !== undefined) data.name = patch.name
  if (patch.defaultCapacitySlots !== undefined) data.default_capacity_slots = patch.defaultCapacitySlots
  if (patch.slotUnit !== undefined) data.slot_unit = patch.slotUnit
  if (patch.attributes !== undefined) data.attributes = patch.attributes
  if (patch.sortOrder !== undefined) data.sort_order = patch.sortOrder
  Object.assign(data, toFormColumns(patch))
  const { data: res, error } = await supabase.functions.invoke<{ ok: true; storage_type: unknown; applied_to_units?: number }>(
    'mutate-storage-type',
    { body: { action: 'update', id, data, apply_to_existing: applyToExisting } },
  )
  if (error) throw error
  return { storageType: toStorageType((res as any).storage_type), appliedToUnits: (res as any).applied_to_units ?? 0 }
}

export async function deactivateStorageType(id: number): Promise<StorageType> {
  const { data, error } = await supabase.functions.invoke<{ ok: true; storage_type: unknown }>('mutate-storage-type', {
    body: { action: 'deactivate', id },
  })
  if (error) throw error
  return toStorageType((data as any).storage_type)
}
