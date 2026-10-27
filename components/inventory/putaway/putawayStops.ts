// The putaway screen's list logic (NX-0007): which bin a task aims at, which
// tasks the floor works as ONE stop, and the order they are walked in. Pure and
// IO-free so it is testable without mounting the walk.

import type { PendingPutawayRow } from '@/services/supabase/putawayQueueService'

export interface PutawayStop {
  /** Stable React key: the lead task's id. */
  key: number
  /** The oldest task of the stop, with `quantity` replaced by the stop's total.
   *  It is what the card renders and what its scan check is measured against. */
  lead: PendingPutawayRow
  /** Every task in the stop, oldest first. One id = an ordinary stop. */
  taskIds: number[]
}

/** Where the operator is sent: the desk's bin on the two-stage path (a task
 *  still ASSIGNED from before NX-0006), otherwise the suggestion itself. */
export function targetBinId(row: PendingPutawayRow): number | null {
  if (row.status === 'assigned' && row.assignedLocationId != null) return row.assignedLocationId
  return row.recommendedLocationId ?? row.assignedLocationId ?? null
}

/** The code of `targetBinId`, as joined with the row, when it was. */
export function targetBinCode(row: PendingPutawayRow): string | null {
  const id = targetBinId(row)
  if (id == null) return null
  if (id === row.assignedLocationId && row.status === 'assigned') return row.assignedLocationCode ?? null
  if (id === row.recommendedLocationId) return row.recommendedLocationCode ?? null
  return row.assignedLocationCode ?? null
}

/**
 * Loose tasks of one product going to the same bin become one stop with the
 * summed quantity, completed together (complete-putaway `task_ids`).
 *
 * A task on a plate is never pooled: a plate is one specific pallet or carton,
 * and the server refuses to pool it (`allocateAcrossTasks`). Two tasks of one
 * product bound for DIFFERENT bins (a home fill and its overflow) stay apart,
 * because they are two trips. Stops keep the order of their first task.
 */
export function combinePutawayStops(rows: readonly PendingPutawayRow[]): PutawayStop[] {
  const stops: PutawayStop[] = []
  const looseByKey = new Map<string, PutawayStop>()

  for (const row of rows) {
    const poolable = row.huId == null && row.status !== 'assigned'
    const key = `${row.productId}:${targetBinId(row) ?? 'none'}`
    const existing = poolable ? looseByKey.get(key) : undefined
    if (existing) {
      existing.taskIds.push(row.id)
      existing.lead = { ...existing.lead, quantity: existing.lead.quantity + row.quantity }
      continue
    }
    const stop: PutawayStop = { key: row.id, lead: { ...row }, taskIds: [row.id] }
    stops.push(stop)
    if (poolable) looseByKey.set(key, stop)
  }
  return stops
}

/**
 * One scan matched several stops of the SAME product: a home fill and its
 * overflow, or a product queued twice. There is nothing to choose, so the
 * operator is sent to them in turn, the home bin first (its share is the one
 * replenishment would otherwise have to fetch), then in walk order. Several
 * products (a mixed plate) still return null: that is a real choice.
 */
export function sameProductRun(stops: readonly PutawayStop[]): PutawayStop[] | null {
  if (stops.length < 2) return null
  const productId = stops[0].lead.productId
  if (stops.some((s) => s.lead.productId !== productId)) return null
  const isHome = (s: PutawayStop) => s.lead.suggestionSource === 'home'
  return [...stops.filter(isHome), ...stops.filter((s) => !isHome(s))]
}

export interface StopOrdering {
  /** The engine's walk sequence for a task, when it has one. The route
   *  (wie_putaway_stops) covers ASSIGNED tasks only. */
  sequenceOf: (taskId: number) => number | null
  /** The destination bin's code, for everything the route does not cover.
   *  Codes run by aisle and bay, so code order is a walkable order. */
  codeOf: (binId: number | null) => string | null
}

/** Routed stops first in route order, then the rest by bin code, then by age. */
export function orderPutawayStops(stops: readonly PutawayStop[], { sequenceOf, codeOf }: StopOrdering): PutawayStop[] {
  return stops
    .map((stop, i) => ({
      stop,
      i,
      seq: sequenceOf(stop.lead.id),
      code: codeOf(targetBinId(stop.lead)),
    }))
    .sort((a, b) => {
      if (a.seq != null || b.seq != null) {
        if (a.seq == null) return 1
        if (b.seq == null) return -1
        if (a.seq !== b.seq) return a.seq - b.seq
      }
      if (a.code !== b.code) {
        if (a.code == null) return 1
        if (b.code == null) return -1
        return a.code.localeCompare(b.code, 'en-AU', { numeric: true })
      }
      return a.i - b.i
    })
    .map(({ stop }) => stop)
}
