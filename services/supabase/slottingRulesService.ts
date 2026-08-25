// Slotting Rules — reads via the wie_slotting_rule_rows RPC, writes via the
// mutate-slotting-rule Edge Function (mig 00115/00117).
//
// NAMED *RULES*, NOT slottingService.ts — that file already exists and belongs
// to re-slotting SUGGESTIONS (wie_slotting_suggestions + wie-batch-reoptimize),
// which is a different feature that happens to share the word. The same
// collision waits in warehouseOverlays.ts, where OverlayKind 'slotting' is
// already taken by the reslot arrows; a slotting-BLOCK overlay must pick its
// own key or the two silently fight.
//
// The read is one SECURITY DEFINER RPC rather than four PostgREST selects, the
// wie_replen_config_rows pattern: the counts it returns (bins per block, rules
// per block, products per rule) are aggregates no client query should be
// assembling, and the role check lives in one place with them.

import { supabase } from '@/lib/supabase'

/** `supabase.rpc` detaches `this` when destructured, which silently broke
 *  wie_warehouse_report once. Bind it. */
type SlottingRowsRpc = (
  fn: 'wie_slotting_rule_rows',
  args: { p_warehouse_id: number },
) => Promise<{ data: SlottingRows | null; error: { message: string } | null }>

export interface SlottingBlockRow {
  id: number
  name: string
  sourceKind: 'manual' | 'area'
  sourceAreaName: string | null
  /** Members as stored — a rack counts once however many levels it has. */
  unitCount: number
  /** Leaf bins those members expand to. The number that matters operationally. */
  binCount: number
  ruleCount: number
}

export interface SlottingRuleRow {
  id: number
  name: string
  specificity: number
  matchProductId: number | null
  matchProductSku: string | null
  matchBrand: string | null
  matchCategory: string | null
  matchSupplierId: number | null
  matchSupplierName: string | null
  enforcement: 'hard' | 'soft'
  reserveEmpty: boolean
  isActive: boolean
  /** Products this rule's conditions match right now. A zero is the only
   *  visible symptom of a renamed category (match_category has no FK). */
  matchCount: number
  blocks: Array<{ id: number; rank: number; name: string }>
}

export interface SlottingRows {
  blocks: SlottingBlockRow[]
  rules: SlottingRuleRow[]
}

export async function getSlottingRows(warehouseId: number): Promise<SlottingRows> {
  const rpc = supabase.rpc.bind(supabase) as unknown as SlottingRowsRpc
  const { data, error } = await rpc('wie_slotting_rule_rows', { p_warehouse_id: warehouseId })
  if (error) throw new Error(error.message)
  return { blocks: data?.blocks ?? [], rules: data?.rules ?? [] }
}

export interface BlockMemberInput {
  locationId: number
  unitKind: 'bin' | 'rack' | 'level'
}

export interface SaveBlockInput {
  warehouseId: number
  id?: number | null
  name: string
  sourceKind?: 'manual' | 'area'
  sourceAreaName?: string | null
  members: BlockMemberInput[]
  dryRun?: boolean
}

export interface SaveRuleInput {
  warehouseId: number
  id?: number | null
  name: string
  matchProductId?: number | null
  matchBrand?: string | null
  matchCategory?: string | null
  matchSupplierId?: number | null
  enforcement: 'hard' | 'soft'
  reserveEmpty: boolean
  isActive: boolean
  /** ARRAY ORDER IS THE RANK. There is no rank field on the wire. */
  blockIds: number[]
  dryRun?: boolean
}

/**
 * `supabase.functions.invoke` throws a FunctionsHttpError whose `.message` is
 * the useless "Edge Function returned a non-2xx status code", so every refusal
 * this feature is careful to word well would reach the operator as that string.
 * Read the body and re-throw the real message — the layoutService lesson.
 */
async function invoke<T>(body: unknown): Promise<T> {
  const { data, error } = await supabase.functions.invoke<T>('mutate-slotting-rule', { body })
  if (!error) return data as T

  const res = (error as { context?: Response }).context
  if (res && typeof res.json === 'function') {
    try {
      const parsed = await res.json()
      const message = parsed?.error?.message
      if (typeof message === 'string' && message) {
        const issues = parsed?.error?.details?.issues
        throw new Error(Array.isArray(issues) && issues.length > 0
          ? `${message} (${issues.map((i: { path: string; message: string }) => `${i.path}: ${i.message}`).join('; ')})`
          : message)
      }
    } catch (e) {
      if (e instanceof Error && e.message && !/non-2xx/.test(e.message)) throw e
    }
  }
  throw error
}

export interface BlockDryRun { dryRun: true; added: number; removed: number; unchanged: number }
export interface RuleDryRun { dryRun: true; matchCount: number; warnings: string[] }

export async function saveBlock(input: SaveBlockInput): Promise<{ id: number } | BlockDryRun> {
  return invoke({
    action: 'set_block',
    warehouse_id: input.warehouseId,
    id: input.id ?? null,
    name: input.name,
    source_kind: input.sourceKind ?? 'manual',
    source_area_name: input.sourceAreaName ?? null,
    members: input.members.map((m) => ({ location_id: m.locationId, unit_kind: m.unitKind })),
    dry_run: input.dryRun ?? false,
  })
}

export async function deleteBlock(warehouseId: number, id: number): Promise<void> {
  await invoke({ action: 'delete_block', warehouse_id: warehouseId, id })
}

export async function saveRule(
  input: SaveRuleInput,
): Promise<{ id: number; matchCount: number; warnings: string[] } | RuleDryRun> {
  return invoke({
    action: 'set_rule',
    warehouse_id: input.warehouseId,
    id: input.id ?? null,
    name: input.name,
    // `?? null` on every nullable axis, matching the server's `.nullish()`.
    match_product_id: input.matchProductId ?? null,
    match_brand: input.matchBrand ?? null,
    match_category: input.matchCategory ?? null,
    match_supplier_id: input.matchSupplierId ?? null,
    enforcement: input.enforcement,
    reserve_empty: input.reserveEmpty,
    is_active: input.isActive,
    block_ids: input.blockIds,
    dry_run: input.dryRun ?? false,
  })
}

export async function deleteRule(warehouseId: number, id: number): Promise<void> {
  await invoke({ action: 'delete_rule', warehouse_id: warehouseId, id })
}
