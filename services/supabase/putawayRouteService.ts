// The putaway walk: assigned tasks, sequenced into a shortest-travel round.
//
// Mirrors pickRouteService. A warehouse with no published layout answers
// `legacy`, and the caller then lists the tasks in receipt order instead —
// which is the right answer for a bulk site, not a degraded one.

import { supabase } from '@/lib/supabase'
import type { HuType } from '@/supabase/functions/_shared/wie/capacity'

/** One stop on the walk: a bin, and the task waiting to be placed in it. */
export interface PutawayStop {
  sequence: number
  recId: number
  locationId: number
  code: string
  productId: number
  sku: string | null
  productName: string | null
  qtyBase: number
  huCode: string | null
  huType: HuType
  /** Metres walked from the previous stop (or the dock, for the first). */
  legDistanceM: number
  /** False when the bin isn't placed in the published layout, so it couldn't be
   *  sequenced. Still shown — the work exists whether or not the map knows. */
  reachable: boolean
}

export type PutawayRouteResult =
  | { mode: 'legacy' }
  | { mode: 'engine'; stops: PutawayStop[]; totalDistanceM: number; unreachableCount: number }

export async function getPutawayRoute(warehouseId: number): Promise<PutawayRouteResult> {
  const { data, error } = await supabase.functions.invoke<{
    ok: true
    mode: 'legacy' | 'engine'
    route?: {
      stops: Array<Record<string, unknown>>
      totalDistanceM: number
      unreachableCount: number
    }
  }>('recommend-putaway-route', {
    body: { warehouse_id: warehouseId },
  })
  if (error) throw error
  if (!data || data.mode === 'legacy') return { mode: 'legacy' }

  const stops = (data.route?.stops ?? []).map((s) => ({
    sequence: Number(s.sequence),
    recId: Number(s.recId),
    locationId: Number(s.locationId),
    code: String(s.code ?? ''),
    productId: Number(s.productId),
    sku: (s.sku as string) ?? null,
    productName: (s.productName as string) ?? null,
    qtyBase: Number(s.qtyBase) || 0,
    huCode: (s.huCode as string) ?? null,
    huType: (s.huType as HuType) ?? null,
    legDistanceM: Number(s.legDistanceM) || 0,
    reachable: s.reachable !== false,
  }))

  return {
    mode: 'engine',
    stops,
    totalDistanceM: Number(data.route?.totalDistanceM ?? 0),
    unreachableCount: Number(data.route?.unreachableCount ?? 0),
  }
}
