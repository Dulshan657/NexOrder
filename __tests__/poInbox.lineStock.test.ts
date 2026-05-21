import { describe, it, expect } from 'vitest'

import { lineStockStatus } from '../components/admin/poInboxStock'

describe('lineStockStatus', () => {
  it('flags out_of_stock when inventory is zero or below, regardless of ordered qty', () => {
    expect(lineStockStatus(0, 2, 10).kind).toBe('out_of_stock')
    expect(lineStockStatus(-3, 1, 10).kind).toBe('out_of_stock')
  })

  it('flags insufficient when there is some stock but less than ordered', () => {
    const s = lineStockStatus(5, 20, 10)
    expect(s.kind).toBe('insufficient')
    expect(s).toEqual({ kind: 'insufficient', available: 5, ordered: 20 })
  })

  it('insufficient takes priority over the low-stock band', () => {
    // 8 in stock, below the 10 low threshold AND below the 20 ordered.
    expect(lineStockStatus(8, 20, 10).kind).toBe('insufficient')
  })

  it('flags low_stock when stock covers the order but sits under the threshold', () => {
    expect(lineStockStatus(8, 5, 10).kind).toBe('low_stock')
  })

  it('returns ok when stock covers the order and is at/above the threshold', () => {
    expect(lineStockStatus(50, 2, 10).kind).toBe('ok')
    expect(lineStockStatus(10, 2, 10).kind).toBe('ok') // exactly at threshold is fine
  })

  it('defaults the low threshold to 10', () => {
    expect(lineStockStatus(9, 1).kind).toBe('low_stock')
    expect(lineStockStatus(11, 1).kind).toBe('ok')
  })
})
