import { describe, it, expect } from 'vitest'
import {
  combinePutawayStops,
  orderPutawayStops,
  targetBinId,
} from '@/components/inventory/putaway/putawayStops'
import type { PendingPutawayRow } from '@/services/supabase/putawayQueueService'

function row(o: Partial<PendingPutawayRow> & { id: number }): PendingPutawayRow {
  return {
    productId: 1,
    quantity: 5,
    recommendedLocationId: 20,
    explanation: { engineVersion: 'v1', layoutId: 1, candidatesConsidered: 0, hardFilters: [], winner: null, alternatives: [] },
    createdAt: '2026-10-27T00:00:00Z',
    product: null,
    receipt: null,
    huId: null,
    huType: null,
    huCode: null,
    huLabelPrinted: false,
    huStatus: null,
    assignedLocationId: null,
    assignedAt: null,
    status: 'suggested',
    ...o,
  }
}

describe('combinePutawayStops', () => {
  it('merges loose tasks of one product', () => {
    const stops = combinePutawayStops([
      row({ id: 1, quantity: 6 }),
      row({ id: 2, quantity: 4 }),
      // A plate is one specific pallet or carton: never pooled.
      row({ id: 3, quantity: 9, huId: 77, huCode: 'HU-77' }),
      // Same product, different bin (home vs overflow): a different stop.
      row({ id: 4, quantity: 2, recommendedLocationId: 21 }),
      row({ id: 5, quantity: 3, productId: 2 }),
    ])
    expect(stops.map((s) => [s.taskIds, s.lead.quantity])).toEqual([
      [[1, 2], 10],
      [[3], 9],
      [[4], 2],
      [[5], 3],
    ])
  })

  it('aims at the assigned bin on the two-stage path, the suggestion otherwise', () => {
    expect(targetBinId(row({ id: 1 }))).toBe(20)
    expect(targetBinId(row({ id: 1, status: 'assigned', assignedLocationId: 31 }))).toBe(31)
  })

  it('orders by the engine route, then by bin code', () => {
    const stops = combinePutawayStops([
      row({ id: 1, recommendedLocationId: 30 }),
      row({ id: 2, recommendedLocationId: 10, productId: 2 }),
      row({ id: 3, recommendedLocationId: 20, productId: 3, status: 'assigned', assignedLocationId: 20 }),
    ])
    const code = new Map([[10, 'A-01'], [20, 'B-01'], [30, 'A-05']])
    const ordered = orderPutawayStops(stops, {
      sequenceOf: (id) => (id === 3 ? 1 : null),
      codeOf: (binId) => (binId == null ? null : code.get(binId) ?? null),
    })
    expect(ordered.map((s) => s.lead.id)).toEqual([3, 2, 1])
  })
})
