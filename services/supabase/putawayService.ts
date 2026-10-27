import { supabase } from '@/lib/supabase'
import { extractFunctionErrorDetails, extractFunctionErrorMessage } from '@/lib/functionError'
import type { PutawayLineRecommendation } from '@/types'
import type { OverrideReason } from '@/supabase/functions/_shared/putawayCompletion'

export interface PutawayLineInput {
  product_id: number
  quantity: number
}

export type PutawayResponse =
  | { mode: 'legacy' }
  | { mode: 'engine'; layoutId: number; recommendations: PutawayLineRecommendation[] }

/** Ask the engine for putaway recommendations for freshly-received lines. A
 *  warehouse without a published layout returns { mode: 'legacy' } and the caller
 *  keeps today's home-bin behavior. */
export async function recommendPutaway(
  warehouseId: number,
  lines: PutawayLineInput[],
  goodsReceiptId?: number,
  dryRun?: boolean,
  /** Re-run: the pending recommendation these lines replace. The server expires
   *  it in the same request, so the queue never shows two live rows for the
   *  same stock. */
  replacesRecommendationId?: number,
): Promise<PutawayResponse> {
  const { data, error } = await supabase.functions.invoke<{
    ok: true
    mode: 'legacy' | 'engine'
    layout_id?: number
    recommendations?: PutawayLineRecommendation[]
  }>('recommend-putaway', {
    body: {
      warehouse_id: warehouseId,
      lines,
      goods_receipt_id: goodsReceiptId,
      dry_run: dryRun,
      replaces_recommendation_id: replacesRecommendationId,
    },
  })
  if (error) throw error
  if (!data || data.mode === 'legacy') return { mode: 'legacy' }
  return { mode: 'engine', layoutId: data.layout_id!, recommendations: data.recommendations ?? [] }
}

export interface DecidePutawayInput {
  recommendationId: number
  decision: 'accept' | 'override' | 'unassign' | 'redirect' | 'resolve_short'
  chosenLocationId?: number
  /** resolve_short only (NX-0006). */
  resolution?: 'found' | 'write_off'
  /** resolve_short: required for a write-off. */
  reason?: string
  /** Base units to put away. Omitted = the whole remaining quantity; anything
   *  less leaves the remainder queued (mig 00071). */
  quantity?: number
  /** Place into a level whose role this SKU isn't allowed on (mig 00072).
   *  The hard never-mix rule can wedge the queue when every compatible level is
   *  full; this is the operator's escape hatch, and the server audits it. */
  roleOverride?: boolean
  /** Two-stage putaway (mig 00080): decide the bin and move NOTHING. The line
   *  becomes an `assigned` task on the Walk run and the stock stays at the
   *  dock, where it physically is, until `completePutaway` records someone
   *  carrying it there. Omitted/false keeps the one-step "place it now" path. */
  assignOnly?: boolean
}

export interface DecidePutawayResult {
  /** Base units still queued on the original recommendation after a partial. */
  remainderQty: number
}

export async function decidePutaway(input: DecidePutawayInput): Promise<DecidePutawayResult> {
  const { data, error } = await supabase.functions.invoke<{
    ok: true
    remainder_qty?: number
  }>('decide-putaway', {
    body: {
      recommendation_id: input.recommendationId,
      decision: input.decision,
      chosen_location_id: input.chosenLocationId,
      quantity: input.quantity,
      role_override: input.roleOverride,
      assign_only: input.assignOnly,
      resolution: input.resolution,
      reason: input.reason,
    },
  })
  if (error) throw error
  return { remainderQty: Number(data?.remainder_qty ?? 0) }
}

/** Desk (Admin/Manager): send a suggested line to another bin before anyone
 *  walks it (NX-0006). Moves nothing. */
export function redirectPutaway(recommendationId: number, chosenLocationId: number): Promise<DecidePutawayResult> {
  return decidePutaway({ recommendationId, decision: 'redirect', chosenLocationId })
}

/** Desk (Admin/Manager): close a shortage. `found` puts it back on the floor's
 *  list; `write_off` adjusts the missing units off at the dock (reason required). */
export function resolveShortPutaway(
  recommendationId: number,
  resolution: 'found' | 'write_off',
  reason?: string,
): Promise<DecidePutawayResult> {
  return decidePutaway({ recommendationId, decision: 'resolve_short', resolution, reason })
}

/** Send a queued line to the Walk run without moving any stock. */
export function assignPutaway(input: Omit<DecidePutawayInput, 'assignOnly'>): Promise<DecidePutawayResult> {
  return decidePutaway({ ...input, assignOnly: true })
}

/** Put an assigned task back on the queue — for a run someone abandons. */
export function unassignPutaway(recommendationId: number): Promise<DecidePutawayResult> {
  return decidePutaway({ recommendationId, decision: 'unassign' })
}

/** Physical evidence for a completed putaway. Every field optional: the server
 *  refuses anything supplied-and-wrong, but accepts no-evidence and records it
 *  as unverified (see _shared/putawayScanCheck.ts). */
export interface PutawayScanEvidence {
  locationCode?: string
  productCode?: string
  handlingUnitCode?: string
}

/** One list, owned by the server rules (_shared/putawayCompletion.ts). */
export type PutawayOverrideReason = OverrideReason

export interface CompletePutawayInput {
  /** One task. Give this or `taskIds`. */
  recommendationId?: number
  /** Several loose tasks of one product, put away as one count (NX-0006). */
  taskIds?: number[]
  /** Required when a SUGGESTED task goes to a different bin (NX-0006). */
  overrideReason?: PutawayOverrideReason
  /** The count came up short: the remainder becomes a shortage for a manager. */
  short?: boolean
  /** Make this bin the product's home — only when it has none. */
  makeHome?: boolean
  /** Where it was actually put. Optional when `scan.locationCode` names it —
   *  the server resolves the scanned code and treats it as authoritative. */
  actualLocationId?: number
  quantity?: number
  roleOverride?: boolean
  scan?: PutawayScanEvidence
}

export interface CompletePutawayResult {
  /** 'accepted' when it landed in the assigned bin, 'overridden' otherwise. */
  status: 'accepted' | 'overridden'
  placedElsewhere: boolean
  scanVerified: boolean
  actualLocationCode: string | null
  remainderQty: number
  /** What the remainder became: still a task, or a shortage (NX-0006). */
  remainderStatus: 'suggested' | 'assigned' | 'short' | null
  /** The bin was made the product's home. */
  homeSet: boolean
}

/** A refusal from complete-putaway, carrying the server's own words plus the
 *  stable marker the Walk card branches on. */
export class CompletePutawayError extends Error {
  /** 'level_role_mismatch' when the operator can force it through. */
  readonly reason: string | null
  constructor(message: string, reason: string | null) {
    super(message)
    this.name = 'CompletePutawayError'
    this.reason = reason
  }
}

/** Record that a putaway task was physically placed. THIS is the call that
 *  moves the stock (mig 00080 wie_complete_putaway_tx). */
export async function completePutaway(input: CompletePutawayInput): Promise<CompletePutawayResult> {
  const { data, error } = await supabase.functions.invoke<{
    ok: true
    status: 'accepted' | 'overridden'
    placedElsewhere: boolean
    scanVerified: boolean
    actualLocationCode: string | null
    remainder_qty?: number
    remainder_status?: 'suggested' | 'assigned' | 'short' | null
    homeSet?: boolean
  }>('complete-putaway', {
    body: {
      recommendation_id: input.taskIds ? undefined : input.recommendationId,
      task_ids: input.taskIds,
      override_reason: input.overrideReason,
      short: input.short,
      make_home: input.makeHome,
      actual_location_id: input.actualLocationId,
      quantity: input.quantity,
      role_override: input.roleOverride,
      scan: input.scan,
    },
  })
  if (error) {
    // The raw FunctionsHttpError says only "non-2xx status code"; everything
    // useful is in the response body (see lib/functionError.ts).
    const [message, details] = await Promise.all([
      extractFunctionErrorMessage(error, 'Could not record the putaway'),
      extractFunctionErrorDetails(error),
    ])
    const reason = (details as { reason?: string } | undefined)?.reason ?? null
    throw new CompletePutawayError(message, reason)
  }
  return {
    status: data?.status ?? 'accepted',
    placedElsewhere: Boolean(data?.placedElsewhere),
    scanVerified: Boolean(data?.scanVerified),
    actualLocationCode: data?.actualLocationCode ?? null,
    remainderQty: Number(data?.remainder_qty ?? 0),
    remainderStatus: data?.remainder_status ?? null,
    homeSet: Boolean(data?.homeSet),
  }
}
