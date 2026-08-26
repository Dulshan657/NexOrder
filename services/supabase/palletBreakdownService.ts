// Pallet break-down at putaway — the client half of `break-down-putaway`.
//
// Two calls into one function, deliberately: `planBreakdownPortions` is the same
// request with `dry_run: true`, so what the sheet shows as the engine's
// suggestion IS what the commit will record as `recommended_location_id`. A
// separate preview endpoint would be a second implementation of the same
// decision with its own way of drifting.

import { supabase } from '@/lib/supabase'
import { extractFunctionErrorDetails, extractFunctionErrorMessage } from '@/lib/functionError'
import type { CountedUnit, BreakdownHuType } from '@/lib/palletBreakdown'

/** One row of the sheet on the wire. `locationId` is null until the operator
 *  has confirmed a bin — legal on a plan, refused on a commit. */
export interface BreakdownPortionRequest {
  baseQty: number
  countedUnit: CountedUnit
  locationId: number | null
}

/** What the engine says about one portion, scored as the container it will
 *  become (`rolesForHuType`, mig 00081) rather than as the pallet it came off. */
export interface PlannedBreakdownPortion {
  index: number
  baseQty: number
  countedUnit: CountedUnit
  huType: BreakdownHuType
  recommendedLocationId: number | null
  alternatives: unknown[]
  explanation: unknown
  locationId: number | null
}

export interface BreakdownPlanResult {
  /** 'legacy' when the site has no published layout: no bin is suggested and
   *  the operator names every destination themselves. */
  mode: 'legacy' | 'engine'
  parentRemaining: number
  parentClosed: boolean
  portions: PlannedBreakdownPortion[]
}

export interface BrokenPlate {
  recommendationId: number
  handlingUnitId: number
  code: string
  huType: BreakdownHuType
  quantity: number
  locationId: number
  locationCode: string | null
}

export interface BreakdownResult {
  parentId: number
  parentRemaining: number
  parentClosed: boolean
  plates: BrokenPlate[]
}

/** A refusal from break-down-putaway, carrying the server's own words plus the
 *  stable marker the sheet branches on ('level_role_mismatch'). Mirrors
 *  CompletePutawayError, and for the same reason: the raw FunctionsHttpError
 *  says only "non-2xx status code". */
export class BreakdownError extends Error {
  readonly reason: string | null
  readonly details: unknown
  constructor(message: string, reason: string | null, details: unknown) {
    super(message)
    this.name = 'BreakdownError'
    this.reason = reason
    this.details = details
  }
}

async function invoke<T>(body: Record<string, unknown>, fallback: string): Promise<T> {
  const { data, error } = await supabase.functions.invoke<T>('break-down-putaway', { body })
  if (error) {
    const [message, details] = await Promise.all([
      extractFunctionErrorMessage(error, fallback),
      extractFunctionErrorDetails(error),
    ])
    throw new BreakdownError(message, (details as { reason?: string } | undefined)?.reason ?? null, details)
  }
  return data as T
}

function toWire(portions: readonly BreakdownPortionRequest[]) {
  return portions.map((p) => ({
    base_qty: p.baseQty,
    counted_unit: p.countedUnit,
    location_id: p.locationId,
  }))
}

/** Score the portions and get a suggested bin for each. Writes nothing. */
export async function planBreakdownPortions(
  recommendationId: number,
  portions: readonly BreakdownPortionRequest[],
): Promise<BreakdownPlanResult> {
  const data = await invoke<{
    mode: 'legacy' | 'engine'
    parentRemaining: number
    parentClosed: boolean
    portions: PlannedBreakdownPortion[]
  }>(
    { recommendation_id: recommendationId, portions: toWire(portions), dry_run: true },
    'Could not plan that break-down',
  )
  return {
    mode: data?.mode ?? 'engine',
    parentRemaining: Number(data?.parentRemaining ?? 0),
    parentClosed: Boolean(data?.parentClosed),
    portions: data?.portions ?? [],
  }
}

/**
 * Commit the break-down.
 *
 * Mints one handling unit per portion, re-plates at the warehouse root and
 * creates one assigned task per plate. NOTHING moves to a bay — each new plate
 * becomes an ordinary walk stop, completed with the usual plate + bin scan.
 */
export async function breakDownPallet(input: {
  recommendationId: number
  portions: readonly BreakdownPortionRequest[]
  roleOverride?: boolean
}): Promise<BreakdownResult> {
  const data = await invoke<{
    parentId: number
    parentRemaining: number
    parentClosed: boolean
    plates: BrokenPlate[]
  }>(
    {
      recommendation_id: input.recommendationId,
      portions: toWire(input.portions),
      role_override: input.roleOverride,
    },
    'Could not break this pallet down',
  )
  return {
    parentId: Number(data?.parentId ?? input.recommendationId),
    parentRemaining: Number(data?.parentRemaining ?? 0),
    parentClosed: Boolean(data?.parentClosed),
    plates: data?.plates ?? [],
  }
}
