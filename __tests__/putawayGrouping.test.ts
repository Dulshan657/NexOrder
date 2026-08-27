import { describe, it, expect } from 'vitest'
import {
  filterQueue,
  groupByReceipt,
  placeableRows,
} from '@/components/inventory/putaway/putawayGrouping'
import type { PendingPutawayRow } from '@/services/supabase/putawayQueueService'
import type { Product } from '@/types'

function row(over: Partial<PendingPutawayRow> = {}): PendingPutawayRow {
  return {
    id: 1,
    productId: 1,
    quantity: 10,
    recommendedLocationId: 100,
    explanation: { engineVersion: 'v1', layoutId: 1, candidatesConsidered: 3, hardFilters: [], winner: null, alternatives: [] },
    createdAt: '2026-07-20T00:00:00Z',
    product: { id: 1, name: 'Fish Sauce', sku: 'FS-1' } as Product,
    receipt: { id: 9, reference: 'GRN-9', receivedDate: '2026-07-20', supplierName: 'Acme' },
    huId: null,
    huType: null,
    huCode: null,
    huLabelPrinted: false,
    huStatus: null,
    assignedLocationId: null,
    assignedAt: null,
    ...over,
  }
}

const binById = new Map([
  [100, { code: 'A-01-01', name: 'Chiller · Rack 1' }],
  [200, { code: 'B-02-02', name: 'Bulk · Rack 4' }],
])

describe('filterQueue', () => {
  const rows = [
    row({ id: 1, product: { id: 1, name: 'Fish Sauce', sku: 'FS-1' } as Product }),
    row({ id: 2, recommendedLocationId: null, product: { id: 2, name: 'Rice Noodles', sku: 'RN-2' } as Product }),
    row({ id: 3, recommendedLocationId: 200, product: { id: 3, name: 'Chilli Oil', sku: 'CO-3' } as Product,
          receipt: { id: 4, reference: 'GRN-4', receivedDate: '2026-07-19', supplierName: 'Zesty' } }),
  ]

  it('returns everything when unfiltered', () => {
    expect(filterQueue(rows)).toHaveLength(3)
  })

  it('matches on product name, case-insensitively', () => {
    expect(filterQueue(rows, { query: 'fish' }).map((r) => r.id)).toEqual([1])
  })

  it('matches on SKU', () => {
    expect(filterQueue(rows, { query: 'RN-2' }).map((r) => r.id)).toEqual([2])
  })

  it('matches on supplier and receipt reference', () => {
    expect(filterQueue(rows, { query: 'zesty' }).map((r) => r.id)).toEqual([3])
    expect(filterQueue(rows, { query: 'grn-4' }).map((r) => r.id)).toEqual([3])
  })

  it('matches on the destination bin code when one is supplied', () => {
    expect(filterQueue(rows, { query: 'B-02', binById }).map((r) => r.id)).toEqual([3])
  })

  // Operators read "Chiller · Rack 1" off the card, so that is what they type
  // into the search box (mig 00094).
  it('matches the destination bin by NAME as well as by code', () => {
    expect(filterQueue(rows, { query: 'chiller', binById }).map((r) => r.id)).toEqual([1])
    expect(filterQueue(rows, { query: 'rack 4', binById }).map((r) => r.id)).toEqual([3])
  })

  it('falls back to the #id for a row with no product join', () => {
    const orphan = [row({ id: 7, productId: 42, product: null, receipt: null })]
    expect(filterQueue(orphan, { query: '#42' }).map((r) => r.id)).toEqual([7])
  })

  it('splits placeable from unplaceable', () => {
    expect(filterQueue(rows, { state: 'placeable' }).map((r) => r.id)).toEqual([1, 3])
    expect(filterQueue(rows, { state: 'unplaceable' }).map((r) => r.id)).toEqual([2])
  })

  it('applies the query and the state filter together', () => {
    expect(filterQueue(rows, { query: 'o', state: 'unplaceable' }).map((r) => r.id)).toEqual([2])
  })

  it('ignores surrounding whitespace in the query', () => {
    expect(filterQueue(rows, { query: '  fish  ' }).map((r) => r.id)).toEqual([1])
  })

  it('preserves the incoming (newest-first) order', () => {
    expect(filterQueue(rows, { state: 'all' }).map((r) => r.id)).toEqual([1, 2, 3])
  })
})

describe('groupByReceipt', () => {
  it('buckets rows by their receipt and keeps first-appearance order', () => {
    const groups = groupByReceipt([
      row({ id: 1, receipt: { id: 9, reference: 'GRN-9', receivedDate: '2026-07-20', supplierName: 'Acme' } }),
      row({ id: 2, receipt: { id: 4, reference: 'GRN-4', receivedDate: '2026-07-19', supplierName: 'Zesty' } }),
      row({ id: 3, receipt: { id: 9, reference: 'GRN-9', receivedDate: '2026-07-20', supplierName: 'Acme' } }),
    ])
    expect(groups.map((g) => g.receiptId)).toEqual([9, 4])
    expect(groups[0].rows.map((r) => r.id)).toEqual([1, 3])
    expect(groups[0].supplierName).toBe('Acme')
  })

  it('sorts the unlinked bucket last, whatever order it arrived in', () => {
    const groups = groupByReceipt([
      row({ id: 1, receipt: null }),
      row({ id: 2 }),
    ])
    expect(groups.map((g) => g.receiptId)).toEqual([9, null])
    expect(groups[1].label).toBe('Not from a delivery')
  })

  it('labels a receipt with no reference by its id', () => {
    const groups = groupByReceipt([
      row({ receipt: { id: 12, reference: null, receivedDate: null, supplierName: null } }),
    ])
    expect(groups[0].label).toBe('Receipt #12')
  })

  it('treats a blank reference as missing rather than rendering an empty header', () => {
    const groups = groupByReceipt([
      row({ receipt: { id: 12, reference: '   ', receivedDate: null, supplierName: null } }),
    ])
    expect(groups[0].label).toBe('Receipt #12')
  })
})

describe('placeableRows', () => {
  it('keeps only rows the engine found a bin for', () => {
    expect(placeableRows([
      row({ id: 1 }),
      row({ id: 2, recommendedLocationId: null }),
    ]).map((r) => r.id)).toEqual([1])
  })
})
