// Who is worth a call, before any of it is turned into spoken rows.
//
// Reps are shown customers they have sold to who have gone quiet or are
// ordering less (getAtRiskCustomersForRep). Managers also see customers whose
// usual reorder is due inside a week or already late (getReorderPredictions),
// merged with the same at-risk and declining test over every customer.
//
// Callers pass non-cancelled orders; a rep's are already their own.

import {
  getAtRiskCustomersForRep,
  getCustomerOrders,
  getReorderPredictions,
  segmentCustomer,
} from '@/services/buyingPatternsService'
import type { HoReCa, HoReCaSegment, Order } from '@/types'
import { daysSince } from './common'

/** A reorder due this soon, or sooner, is worth a call. */
export const REORDER_HORIZON_DAYS = 7

export interface FollowUpCandidate {
  horecaId: number
  name: string
  segment: HoReCaSegment
  daysSinceLastOrder: number
  /** Negative when the usual reorder is late. Null when the customer has no pattern yet. */
  daysUntilReorder: number | null
}

function lastOrderAge(orders: readonly Order[], customerId: number, now: Date): number {
  const own = getCustomerOrders(orders, customerId)
  return own.length === 0 ? 0 : daysSince(own[own.length - 1].orderDate, now)
}

export function repCandidates(
  orders: readonly Order[],
  hoReCas: readonly HoReCa[],
  repId: number,
  now: Date,
): FollowUpCandidate[] {
  return getAtRiskCustomersForRep(orders, hoReCas, repId, now).map((row) => ({
    horecaId: row.hoReCaId,
    name: row.hoReCaName,
    segment: row.segment,
    daysSinceLastOrder: row.daysSinceLastOrder,
    daysUntilReorder: null,
  }))
}

export function managerCandidates(orders: readonly Order[], hoReCas: readonly HoReCa[], now: Date): FollowUpCandidate[] {
  const byId = new Map<number, FollowUpCandidate>()

  for (const p of getReorderPredictions(orders, hoReCas, now)) {
    if (p.daysUntil > REORDER_HORIZON_DAYS) continue
    byId.set(p.hoReCaId, {
      horecaId: p.hoReCaId,
      name: p.hoReCaName,
      segment: p.segment,
      daysSinceLastOrder: lastOrderAge(orders, p.hoReCaId, now),
      daysUntilReorder: p.daysUntil,
    })
  }

  for (const customer of hoReCas) {
    if (byId.has(customer.id)) continue
    const own = getCustomerOrders(orders, customer.id)
    if (own.length === 0) continue
    const segment = segmentCustomer(own, orders, now)
    if (segment !== 'at_risk' && segment !== 'declining') continue
    byId.set(customer.id, {
      horecaId: customer.id,
      name: customer.name,
      segment,
      daysSinceLastOrder: daysSince(own[own.length - 1].orderDate, now),
      daysUntilReorder: null,
    })
  }

  return [...byId.values()]
}
