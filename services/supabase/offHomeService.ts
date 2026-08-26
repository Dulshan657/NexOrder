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
  /** `expired` means a dismissal that a restore has lifted. It shows in neither
   *  list — it is history, not work. */
  status: 'suggested' | 'accepted' | 'dismissed' | 'expired'
  createdAt: string
  /** Both null until the task is decided. On a dismissed task the reason is the
   *  whole point of the Left alone list: the next person needs to know why this
   *  is still here, and "somebody dismissed it" is not an answer. */
  dismissedReason: string | null
  decidedAt: string | null
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
    dismissedReason: row.dismissed_reason ?? null,
    decidedAt: row.decided_at ?? null,
  }
}

/** The two lists the queue shows. `accepted` and `expired` are history and have
 *  no surface — a task that has been walked, or a dismissal that has been
 *  lifted, is not work anybody can do. */
export type OffHomeListStatus = 'suggested' | 'dismissed'

export async function getOffHomeTasks(
  warehouseId: number,
  status: OffHomeListStatus = 'suggested',
): Promise<OffHomeTask[]> {
  const { data, error } = await supabase
    .from('wie_offhome_tasks')
    .select('*, products(sku, name), locations!wie_offhome_tasks_from_location_id_fkey(code, name)')
    .eq('warehouse_id', warehouseId)
    .eq('status', status)
    // Dismissed rows sort by when they were left, not when they were raised:
    // the newest decision is the one most likely to have been a mis-tap.
    .order(status === 'dismissed' ? 'decided_at' : 'created_at', { ascending: false })
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

export interface RestoreResult {
  /** How many dismissed rows were lifted — all of them for this (product, bin),
   *  because the detector suppresses on the LARGEST quantity refused. */
  restored: number
  /** Whether the sweep that followed put the task back. It may not: the rule
   *  can have changed, or the stock can have moved, since it was left alone. */
  reraised: boolean
  /** Base units on the restored task, re-derived from what is in the bin now
   *  rather than reinstated from when it was raised. */
  quantity?: number
  reason?: 'now_in_block' | 'no_stock' | 'no_rule' | 'still_dismissed'
    | 'no_slotting_rules' | 'no_published_layout'
}

/** Lift a dismissal and look at that product again. The server does the second
 *  half itself — see mutate-offhome-task's `restore` branch for why it re-runs
 *  the sweep rather than flipping the row back. */
export async function restoreOffHome(taskId: number): Promise<RestoreResult> {
  return invoke({ action: 'restore', task_id: taskId })
}
