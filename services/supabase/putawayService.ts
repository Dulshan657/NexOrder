import { supabase } from '@/lib/supabase'
import { extractFunctionErrorDetails, extractFunctionErrorMessage } from '@/lib/functionError'
import type { PutawayLineRecommendation } from '@/types'

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
  decision: 'accept' | 'override' | 'unassign'
  chosenLocationId?: number
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
    },
  })
  if (error) throw error
  return { remainderQty: Number(data?.remainder_qty ?? 0) }
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

export interface CompletePutawayInput {
  recommendationId: number
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
  }>('complete-putaway', {
    body: {
      recommendation_id: input.recommendationId,
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
  }
}
