import { supabase } from '@/lib/supabase'

/** One replenishment task (mig 00082), camelCased.
 *
 *  Note the asymmetry versus putaway: the SOURCE carries the
 *  recommended/assigned/chosen trio, because the destination is the task's
 *  identity — it is the pick slot that is low. */
export interface ReplenTask {
  id: number
  warehouseId: number
  productId: number
  toLocationId: number
  toCode: string | null
  chosenToLocationId: number | null
  recommendedFromLocationId: number | null
  recommendedFromCode: string | null
  assignedFromLocationId: number | null
  assignedFromCode: string | null
  chosenFromLocationId: number | null
  quantity: number
  handlingUnitId: number | null
  huCode: string | null
  status: 'suggested' | 'assigned' | 'accepted' | 'overridden' | 'expired' | 'cancelled'
  triggerKind: 'min_max' | 'manual'
  minQty: number | null
  maxQty: number | null
  slotOnHand: number | null
  explanation: Record<string, unknown>
  sku: string | null
  productName: string | null
  createdAt: string
}

/** Why a slot that looks short did NOT produce a task. Rendering these is not
 *  optional polish: `source_reserved` in particular ("the pallet is right there
 *  but every unit is spoken for") is the predicted #1 support ticket. */
export type ReplenSkipReason =
  | 'no_source'
  | 'source_reserved'
  | 'slot_full'
  | 'bin_not_pick_zone'
  | 'no_pick_zone_configured'

export interface ReplenDetectResult {
  raised: number
  expired: number
  skipped: Array<{ product_id: number; to_location_id: number; reason: ReplenSkipReason }>
  skipped_all?: string
}

function toTask(row: any): ReplenTask {
  return {
    id: row.id,
    warehouseId: row.warehouse_id,
    productId: row.product_id,
    toLocationId: row.to_location_id,
    toCode: row.to_loc?.code ?? null,
    chosenToLocationId: row.chosen_to_location_id ?? null,
    recommendedFromLocationId: row.recommended_from_location_id ?? null,
    recommendedFromCode: row.rec_from?.code ?? null,
    assignedFromLocationId: row.assigned_from_location_id ?? null,
    assignedFromCode: row.assigned_from?.code ?? null,
    chosenFromLocationId: row.chosen_from_location_id ?? null,
    quantity: Number(row.quantity) || 0,
    handlingUnitId: row.handling_unit_id ?? null,
    huCode: row.handling_units?.code ?? null,
    status: row.status,
    triggerKind: row.trigger_kind,
    minQty: row.min_qty != null ? Number(row.min_qty) : null,
    maxQty: row.max_qty != null ? Number(row.max_qty) : null,
    slotOnHand: row.slot_on_hand != null ? Number(row.slot_on_hand) : null,
    explanation: (row.explanation as Record<string, unknown>) ?? {},
    sku: row.products?.sku ?? null,
    productName: row.products?.name ?? null,
    createdAt: row.created_at,
  }
}

// Named FK joins: three of these point at `locations`, so PostgREST needs the
// constraint name to tell them apart.
const TASK_SELECT = `
  *,
  products(sku, name),
  handling_units(code),
  to_loc:locations!wie_replen_tasks_to_location_id_fkey(code),
  rec_from:locations!wie_replen_tasks_recommended_from_location_id_fkey(code),
  assigned_from:locations!wie_replen_tasks_assigned_from_location_id_fkey(code)
`

/** Open tasks for a warehouse — 'suggested' (the desk queue) and 'assigned'
 *  (out on the floor). */
export async function getReplenTasks(
  warehouseId: number,
  statuses: string[] = ['suggested', 'assigned'],
): Promise<ReplenTask[]> {
  const { data, error } = await supabase
    .from('wie_replen_tasks')
    .select(TASK_SELECT)
    .eq('warehouse_id', warehouseId)
    .in('status', statuses)
    .order('created_at', { ascending: true })
  if (error) throw error
  return (data ?? []).map(toTask)
}

/** Pending counts per warehouse, for the nav badge. */
export async function getPendingReplenCounts(): Promise<Map<number, number>> {
  const { data, error } = await supabase
    .from('wie_replen_tasks')
    .select('warehouse_id')
    .in('status', ['suggested', 'assigned'])
  if (error) throw error
  const counts = new Map<number, number>()
  for (const r of (data ?? []) as Array<{ warehouse_id: number }>) {
    counts.set(r.warehouse_id, (counts.get(r.warehouse_id) ?? 0) + 1)
  }
  return counts
}

export async function detectReplenishment(
  warehouseId: number,
  productId?: number,
): Promise<ReplenDetectResult> {
  const { data, error } = await supabase.functions.invoke<{ ok: true; result: ReplenDetectResult }>(
    'detect-replenishment',
    { body: { warehouse_id: warehouseId, product_id: productId } },
  )
  if (error) throw error
  return (data as any).result as ReplenDetectResult
}

export async function assignReplenishment(input: {
  taskId: number
  fromLocationId: number
  quantity?: number
}): Promise<void> {
  const { error } = await supabase.functions.invoke('assign-replenishment', {
    body: { task_id: input.taskId, from_location_id: input.fromLocationId, quantity: input.quantity },
  })
  if (error) throw error
}

/** A structured failure from complete-replenishment.
 *
 *  `reason` is a stable marker, not prose — the walk card keys its affordances
 *  off it rather than sniffing the message, so rewording an error can never
 *  silently remove the operator's way forward. */
export class CompleteReplenError extends Error {
  reason: string | null
  constructor(message: string, reason: string | null) {
    super(message)
    this.name = 'CompleteReplenError'
    this.reason = reason
  }
}

export async function completeReplenishment(input: {
  taskId: number
  quantity?: number
  scan: {
    fromLocationCode?: string
    toLocationCode?: string
    productCode?: string
    handlingUnitCode?: string
  }
}): Promise<{ status: string; pulledElsewhere: boolean; verified: boolean }> {
  const { data, error } = await supabase.functions.invoke<any>('complete-replenishment', {
    body: { task_id: input.taskId, quantity: input.quantity, scan: input.scan },
  })
  if (error) {
    // functions.invoke buries the JSON body in a FunctionsHttpError; dig the
    // structured detail out so `reason` survives to the UI.
    let message = error.message
    let reason: string | null = null
    try {
      const body = await (error as any).context?.json?.()
      if (body?.error?.message) message = body.error.message
      reason = body?.error?.details?.reason ?? null
    } catch { /* fall back to the raw message */ }
    throw new CompleteReplenError(message, reason)
  }
  return {
    status: (data as any)?.result?.status ?? 'accepted',
    pulledElsewhere: Boolean((data as any)?.pulledElsewhere),
    verified: Boolean((data as any)?.verified),
  }
}

export async function unassignReplenishment(taskId: number, action: 'unassign' | 'cancel' = 'unassign', reason?: string): Promise<void> {
  const { error } = await supabase.functions.invoke('unassign-replenishment', {
    body: { task_id: taskId, action, reason },
  })
  if (error) throw error
}
