import { supabase } from '@/lib/supabase'
import { extractFunctionErrorDetails, extractFunctionErrorEnvelope, extractFunctionErrorMessage } from '@/lib/functionError'
import type { PutawayLineRecommendation } from '@/types'
import type { OverrideReason } from '@/supabase/functions/_shared/putawayCompletion'

export interface PutawayLineInput {
  product_id: number
  /** Base units. */
  quantity: number
  /** The plate this quantity arrived on, its type, and whether it is held. The
   *  receive screen's Retry sends back what receive-stock returned as
   *  `putaway_lines`, so a held line is still offered only hold bins and a plate
   *  still drains. Server rule: `hu_id` must be on `goodsReceiptId`. */
  hu_type?: 'pallet' | 'carton'
  hu_id?: number
  quarantine?: boolean
}

export type PutawayResponse =
  | { mode: 'legacy' }
  | { mode: 'engine'; layoutId: number; recommendations: PutawayLineRecommendation[] }

/** A refusal from recommend-putaway, carrying the server's own words plus the
 *  stable markers a caller may branch on (never branch on the prose). */
export class RecommendPutawayError extends Error {
  /** The envelope's `error.code`, e.g. 'CONFLICT'; null when there was no response. */
  readonly code: string | null
  /** `error.details.reason`, e.g. 'putaway_tasks_exist'; null when absent. */
  readonly reason: string | null
  constructor(message: string, code: string | null, reason: string | null) {
    super(message)
    this.name = 'RecommendPutawayError'
    this.code = code
    this.reason = reason
  }
}

/** `details.reason` recommend-putaway sends with the CONFLICT it answers when a
 *  receipt already has open putaway tasks (_shared/putawayReceiptGuards.ts). */
const PUTAWAY_TASKS_EXIST_REASON = 'putaway_tasks_exist'

/** True when the receipt already has open putaway tasks, i.e. a Retry that found
 *  its work already done. The screen treats this as success, not as a failure. */
export function isPutawayTasksExist(e: unknown): boolean {
  return e instanceof RecommendPutawayError && e.code === 'CONFLICT' && e.reason === PUTAWAY_TASKS_EXIST_REASON
}

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
  if (error) {
    // The raw FunctionsHttpError says only "non-2xx status code". Since NX-0032
    // the words matter here: a Retry after "Home bin unavailable, try again."
    // can fail the same way, and a refused plate says which one.
    const [message, envelope] = await Promise.all([
      extractFunctionErrorMessage(error, 'Could not get putaway recommendations'),
      extractFunctionErrorEnvelope(error),
    ])
    const reason = (envelope?.details as { reason?: unknown } | null | undefined)?.reason
    throw new RecommendPutawayError(message, envelope?.code ?? null, typeof reason === 'string' ? reason : null)
  }
  if (!data || data.mode === 'legacy') return { mode: 'legacy' }
  return { mode: 'engine', layoutId: data.layout_id!, recommendations: data.recommendations ?? [] }
}

export interface DecidePutawayInput {
  recommendationId: number
  decision: 'accept' | 'override' | 'unassign' | 'redirect' | 'resolve_short' | 'confirm_overflow'
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
  if (error) {
    // The raw FunctionsHttpError says only "non-2xx status code"; the server's
    // own words are on the response body. Since NX-0032 those words matter: an
    // off-home bin is refused with "Put this in its home bin ..." (or "... is
    // the home bin of ...") and the queue's Place now, Choose bin and the
    // opening-stock import all show whatever message this throws.
    throw new Error(await extractFunctionErrorMessage(error, 'Could not record the putaway decision'))
  }
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

/** The Walk (NX-0033): confirm a loose overflow line (its home was full) by
 *  scanning the bin it names. `bin` is the bin the worker SCANNED: its code as
 *  scanned (`{ locationCode }`, which the walk sends, M1), resolved on the
 *  server, or a bin id. Never the card's own idea of the suggested bin: the
 *  server compares the scanned bin with the line's under its row lock, so a
 *  desk redirect made after the walk loaded cannot be confirmed by a stale scan.
 *  Assigns the whole line to that bin; moves nothing.
 *
 *  A refusal (the desk got there first, the bin changed, the home has room
 *  again) throws the server's own words for the card to show as they are. */
export async function confirmOverflowPutaway(
  recommendationId: number,
  bin: number | { locationCode: string },
): Promise<{ assignedId: number }> {
  const { data, error } = await supabase.functions.invoke<{
    ok: true
    assigned_id: number
    location_id: number
  }>('decide-putaway', {
    body: {
      recommendation_id: recommendationId,
      decision: 'confirm_overflow',
      ...(typeof bin === 'number'
        ? { chosen_location_id: bin }
        : { chosen_location_code: bin.locationCode }),
    },
  })
  if (error) {
    throw new Error(await extractFunctionErrorMessage(error, 'Could not confirm the bin, try again.'))
  }
  return { assignedId: Number(data?.assigned_id ?? recommendationId) }
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
