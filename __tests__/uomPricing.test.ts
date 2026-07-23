import { describe, it, expect } from 'vitest'

import { resolveUomLineUnitPrice } from '../supabase/functions/_shared/pricing'
import { resolveUomLinePrice } from '../pricing'
import type { ProductUom } from '../types'

// Server-side Product shape (subset used by pricing)
const serverProduct = { id: 1, price: 10, category: 'Other' as const, inventory: 100 }
const user = { id: 0, role: 'Admin' }

function uom(p: Partial<ProductUom>): ProductUom {
  return {
    id: 1, productId: 1, code: 'each', factorToBase: 1, isBase: true,
    price: 10, isOrderable: true, isReceivable: true, sortOrder: 0, ...p,
  }
}

describe('resolveUomLineUnitPrice (server, explicit UOM)', () => {
  const base = uom({ id: 1, code: 'each', factorToBase: 1, isBase: true, price: 10 })
  const pallet = uom({ id: 3, code: 'pallet', factorToBase: 480, isBase: false, price: 4200 })

  it('base UOM resolves to the per-unit price', () => {
    expect(resolveUomLineUnitPrice(serverProduct, null, user, [], base).unitPrice).toBe(10)
  })

  it('non-base UOM uses its own explicit list price (no promo/discount)', () => {
    expect(resolveUomLineUnitPrice(serverProduct, null, user, [], pallet).unitPrice).toBe(4200)
  })

  it('scales the explicit UOM price by a HoReCa blanket discount', () => {
    const customer = { id: 5, discountPercent: 10, tier: null, pricing: {} }
    // base unit 10 → 9 (10% off) ⇒ ratio 0.9 ⇒ pallet 4200 → 3780
    expect(resolveUomLineUnitPrice(serverProduct, customer, user, [], pallet).unitPrice).toBe(3780)
  })

  it('scales the explicit UOM price by a percentage promotion', () => {
    const promo = {
      id: 'p1', name: '20% off', type: 'percentage' as const, percentOff: 20,
      scope: { kind: 'storewide' as const }, targeting: { kind: 'all' as const },
      stackWithHoReCaPricing: false, isActive: true, priority: 1,
    }
    // 20% off ⇒ ratio 0.8 ⇒ pallet 4200 → 3360
    const res = resolveUomLineUnitPrice(serverProduct, null, user, [promo], pallet)
    expect(res.unitPrice).toBe(3360)
    expect(res.appliedPromotionId).toBe('p1')
  })

  it('falls back to per-unit × factor when the product list price is 0', () => {
    const freeProduct = { ...serverProduct, price: 0 }
    // perUnit 0 ⇒ 0 (explicit price ignored when no ratio can form)
    expect(resolveUomLineUnitPrice(freeProduct, null, user, [], pallet).unitPrice).toBe(0)
  })
})

describe('resolveUomLinePrice (client, mirrors server)', () => {
  const clientProduct = {
    id: 1, sku: 'X', name: 'X', description: '', price: 10, category: 'Other',
    inventory: 100, available: 100, unit: 'each', cartonSize: 12, supplierId: 1,
  } as any
  const base = uom({ id: 1, isBase: true, price: 10 })
  const pallet = uom({ id: 3, code: 'pallet', factorToBase: 480, isBase: false, price: 4200 })

  it('base UOM → promotion-adjusted unit price', () => {
    expect(resolveUomLinePrice(clientProduct, base, null, null, [])).toBe(10)
  })

  it('non-base UOM → explicit price', () => {
    expect(resolveUomLinePrice(clientProduct, pallet, null, null, [])).toBe(4200)
  })

  it('matches the server under a blanket discount', () => {
    const customer = { id: 5, discountPercent: 10, tier: null, pricing: {} } as any
    const client = resolveUomLinePrice(clientProduct, pallet, customer, null, [])
    const server = resolveUomLineUnitPrice(serverProduct, customer, user, [], pallet).unitPrice
    expect(client).toBe(server)
    expect(client).toBe(3780)
  })
})
