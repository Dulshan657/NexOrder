// Off-home tasks — stock sitting outside its product's assigned slotting blocks
// (mig 00119). Reads are plain PostgREST (staff SELECT is open); every write
// goes through mutate-offhome-task, which owns the transfer itself because
// transfer-stock is Admin/Manager only and this queue is walked by Warehouse.

import { supabase } from '@/lib/supabase'

export interface OffHomeTask {
  id: number
  warehouseId: number
  productId: number
  productSku: string
  productName: string
  fromLocationId: number
  fromCode: string
  fromName: string | null
  /** AVAILABLE base units — never on_hand. See the table's comment. */
  quantity: number
  ruleId: number | null
  ruleName: string | null
  blockNames: string[]
  suggestedToLocationId: number | null
  status: 'suggested' | 'accepted' | 'dismissed' | 'expired'
  createdAt: string
}

function toTask(row: any): OffHomeTask {
  const explanation = (row.explanation ?? {}) as Record<string, unknown>
  return {
    id: row.id,
    warehouseId: row.warehouse_id,
    productId: row.product_id,
    productSku: row.products?.sku ?? String(row.product_id),
    productName: row.products?.name ?? '',
    fromLocationId: row.from_location_id,
    fromCode: row.locations?.code ?? String(row.from_location_id),
    fromName: row.locations?.name ?? null,
    quantity: Number(row.quantity),
    ruleId: row.rule_id ?? null,
    ruleName: (explanation.ruleName as string) ?? null,
    blockNames: Array.isArray(explanation.blockNames) ? (explanation.blockNames as string[]) : [],
    suggestedToLocationId: row.suggested_to_location_id ?? null,
    status: row.status,
    createdAt: row.created_at,
  }
}

export async function getOffHomeTasks(warehouseId: number): Promise<OffHomeTask[]> {
  const { data, error } = await supabase
    .from('wie_offhome_tasks')
    .select('*, products(sku, name), locations!wie_offhome_tasks_from_location_id_fkey(code, name)')
    .eq('warehouse_id', warehouseId)
    .eq('status', 'suggested')
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []).map(toTask)
}

/** `supabase.functions.invoke` throws "Edge Function returned a non-2xx status
 *  code", which would replace every carefully-worded refusal here with that
 *  string. Read the body and re-throw the real message — the layoutService
 *  lesson, and it matters more on this surface because the operator is standing
 *  at a rack when they read it. */
async function invoke<T>(body: unknown): Promise<T> {
  const { data, error } = await supabase.functions.invoke<T>('mutate-offhome-task', { body })
  if (!error) return data as T
  const res = (error as { context?: Response }).context
  if (res && typeof res.json === 'function') {
    try {
      const parsed = await res.json()
      const message = parsed?.error?.message
      if (typeof message === 'string' && message) throw new Error(message)
    } catch (e) {
      if (e instanceof Error && e.message && !/non-2xx/.test(e.message)) throw e
    }
  }
  throw error
}

export interface DetectResult {
  raised: number
  scanned: number
  truncated?: boolean
  reason?: string
}

export async function detectOffHome(warehouseId: number, dryRun = false): Promise<DetectResult> {
  return invoke({ action: 'detect', warehouse_id: warehouseId, dry_run: dryRun })
}

export async function acceptOffHome(
  taskId: number,
  opts: { toLocationId?: number | null; quantity?: number | null } = {},
): Promise<{ task_id: number; moved: number; to_location_id: number }> {
  return invoke({
    action: 'accept',
    task_id: taskId,
    to_location_id: opts.toLocationId ?? null,
    quantity: opts.quantity ?? null,
  })
}

export async function dismissOffHome(taskId: number, reason: string): Promise<void> {
  await invoke({ action: 'dismiss', task_id: taskId, reason })
}
