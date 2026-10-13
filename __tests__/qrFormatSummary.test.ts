import { describe, expect, it } from 'vitest'
import { requestEstimateSummary, requestItemsSummary } from '@/lib/qr/qrFormat'
import type { QrOrderRequestItem } from '@/types'

const line = (over: Partial<QrOrderRequestItem> = {}): QrOrderRequestItem => ({
  productId: 1,
  quantity: 2,
  packSize: null,
  uomId: null,
  ...over,
})

describe('requestItemsSummary', () => {
  it('names each line with its quantity, from the snapshot taken at submit', () => {
    expect(
      requestItemsSummary([
        line({ productName: 'Tomato Paste', quantity: 3 }),
        line({ productId: 2, productName: 'Chilli Oil', quantity: 1 }),
      ]),
    ).toBe('Tomato Paste × 3, Chilli Oil × 1')
  })

  it('folds a long order into "and N more" after three lines', () => {
    const items = [1, 2, 3, 4, 5].map((n) => line({ productId: n, productName: `P${n}`, quantity: n }))
    expect(requestItemsSummary(items)).toBe('P1 × 1, P2 × 2, P3 × 3 and 2 more')
  })

  it('falls back to the product number for a row written before names were snapshotted', () => {
    expect(requestItemsSummary([line({ productId: 42, quantity: 5 })])).toBe('Product #42 × 5')
  })

  it('is empty for no lines rather than throwing', () => {
    expect(requestItemsSummary([])).toBe('')
  })

  it('does not mutate what it is given', () => {
    const items = [line({ productName: 'A' }), line({ productName: 'B' })]
    const copy = JSON.parse(JSON.stringify(items))
    requestItemsSummary(items)
    expect(items).toEqual(copy)
  })
})

describe('requestEstimateSummary', () => {
  it('reads "$48.20 est. · 3 items" -- the line the pending banner already shows', () => {
    expect(requestEstimateSummary({ quotedTotal: 48.2, items: [line(), line(), line()] })).toBe('$48.20 est. · 3 items')
    expect(requestEstimateSummary({ quotedTotal: 5, items: [line()] })).toBe('$5.00 est. · 1 item')
  })
})
