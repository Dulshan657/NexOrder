import { supabase } from '@/lib/supabase'
import { toWarehouse } from '@/lib/adapters'
import type { Warehouse, WarehouseType } from '@/types'
import type { CodeOrder, CodeOrigin } from '@/lib/codePattern'

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

// ─────────────────────────────────────── code patterns (migs 00107 / 00108) ──

export interface WarehouseCodePattern {
  template: string
  defaultBlock: string
  start: number
  order: CodeOrder
  origin: CodeOrigin
}

/**
 * This site's code pattern, or null when it is on the built-in default.
 *
 * A read-only table query rather than a function call, exactly like
 * `getWarehouseLabelPrefs`: RLS already limits it to ops roles and there is no
 * decision to make server-side. NO ROW IS THE ANSWER, not a missing one (mig
 * 00107) — which is why this returns null rather than padding out a default here.
 * The caller decides what "no row" means, and the recode wizard and a draw-time
 * mint could legitimately answer that differently.
 */
export async function getWarehouseCodePattern(
  warehouseId: number,
): Promise<WarehouseCodePattern | null> {
  const { data, error } = await supabase
    .from('warehouse_code_patterns')
    .select('template, default_block, start_at, fill_order, origin')
    .eq('warehouse_id', warehouseId)
    .maybeSingle()
  if (error) throw error
  if (!data) return null
  const row = data as {
    template: string; default_block: string; start_at: number
    fill_order: string; origin: string | null
  }
  return {
    template: row.template,
    defaultBlock: row.default_block,
    start: row.start_at,
    order: row.fill_order as CodeOrder,
    // `?? 'nw'` covers the window between deploying this and applying 00108.
    origin: (row.origin ?? 'nw') as CodeOrigin,
  }
}

/**
 * Save this site's pattern, or clear it back to the built-in default with null.
 *
 * On `mutate-warehouse` rather than `mutate-warehouse-location`, and that is
 * deliberate: `warehouse_code_patterns` is keyed by warehouse and is the exact
 * sibling of `warehouse_label_prefs`, which `set_label_prefs` already writes with
 * the same role gate and the same delete-rather-than-sentinel clearing rule.
 * `mutate-warehouse-location`'s rate buckets exist for actions that rewrite
 * hundreds of `locations` rows; a config write does not belong among them.
 */
export async function setWarehouseCodePattern(input: {
  warehouseId: number
  pattern: WarehouseCodePattern | null
}): Promise<void> {
  const { error } = await supabase.functions.invoke('mutate-warehouse', {
    body: { action: 'set_code_pattern', data: input },
  })
  if (error) throw error
}
