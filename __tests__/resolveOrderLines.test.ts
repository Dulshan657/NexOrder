import { describe, expect, it } from 'vitest'

import { resolveOrderLines } from '../lib/newOrder/resolveOrderLines'
import type { Product } from '../types'

const product = (id: number, sku: string, name: string, extra: Partial<Product> = {}) =>
  ({ id, sku, name, price: 10, cartonSize: 1, isActive: true, ...extra }) as Product

const PRODUCTS = [
  product(1, 'AMD-001', 'Basmati Rice 5kg'),
  product(2, 'AMD-002', 'Chickpeas 400g'),
  product(3, 'OLD-009', 'Discontinued Ghee', { isActive: false }),
]

describe('resolveOrderLines', () => {
  it('resolves sku and quantity from a bare two-column paste', () => {
    const r = resolveOrderLines('AMD-001,10\nAMD-002,4', PRODUCTS)
    expect(r.issues).toEqual([])
    expect(r.lines).toEqual([
      { productId: 1, sku: 'AMD-001', name: 'Basmati Rice 5kg', quantity: 10 },
      { productId: 2, sku: 'AMD-002', name: 'Chickpeas 400g', quantity: 4 },
    ])
  })

  it('accepts tabs, because a spreadsheet paste is tab-separated', () => {
    const r = resolveOrderLines('AMD-001\t10', PRODUCTS)
    expect(r.lines).toHaveLength(1)
    expect(r.lines[0].quantity).toBe(10)
  })

  it('skips a header row without reporting it as an error', () => {
    const r = resolveOrderLines('sku,qty\nAMD-001,10', PRODUCTS)
    expect(r.issues).toEqual([])
    expect(r.lines).toHaveLength(1)
  })

  it('matches a sku case-insensitively and ignores surrounding space', () => {
    const r = resolveOrderLines('  amd-001 , 10 ', PRODUCTS)
    expect(r.lines[0].productId).toBe(1)
  })

  it('sums repeated skus into one line', () => {
    // Two lines of the same product on one order is one line of the total —
    // the picker walks to a bin once, not twice.
    const r = resolveOrderLines('AMD-001,10\nAMD-001,5', PRODUCTS)
    expect(r.lines).toHaveLength(1)
    expect(r.lines[0].quantity).toBe(15)
  })

  it('names an unknown sku and the line it was on, and keeps the rest', () => {
    const r = resolveOrderLines('AMD-001,10\nNOPE-1,3\nAMD-002,2', PRODUCTS)
    expect(r.lines).toHaveLength(2)
    expect(r.issues).toHaveLength(1)
    expect(r.issues[0]).toMatchObject({ line: 2, reason: 'unknown_sku' })
    expect(r.issues[0].detail).toContain('NOPE-1')
  })

  it('refuses an inactive product rather than ordering something withdrawn', () => {
    const r = resolveOrderLines('OLD-009,1', PRODUCTS)
    expect(r.lines).toEqual([])
    expect(r.issues[0].reason).toBe('inactive')
  })

  it('rejects a quantity that is not a positive whole number', () => {
    const r = resolveOrderLines('AMD-001,0\nAMD-002,-2\nAMD-001,two\nAMD-002,1.5', PRODUCTS)
    expect(r.lines).toEqual([])
    expect(r.issues.map((i) => i.reason)).toEqual([
      'not_positive',
      'not_positive',
      'bad_quantity',
      'bad_quantity',
    ])
  })

  it('reports a line with no quantity column separately from a bad one', () => {
    const r = resolveOrderLines('AMD-001', PRODUCTS)
    expect(r.issues[0].reason).toBe('missing_quantity')
  })

  it('ignores blank lines entirely, including trailing ones', () => {
    const r = resolveOrderLines('AMD-001,10\n\n   \nAMD-002,1\n', PRODUCTS)
    expect(r.issues).toEqual([])
    expect(r.lines).toHaveLength(2)
  })

  it('counts lines as the operator sees them, blanks included', () => {
    // The number in the message has to match the row they can point at in the
    // box they pasted into, or it helps nobody.
    const r = resolveOrderLines('AMD-001,1\n\nNOPE,1', PRODUCTS)
    expect(r.issues[0].line).toBe(3)
  })

  it('returns nothing for empty input rather than throwing', () => {
    expect(resolveOrderLines('', PRODUCTS)).toEqual({ lines: [], issues: [] })
    expect(resolveOrderLines('   \n  ', PRODUCTS)).toEqual({ lines: [], issues: [] })
  })
})
